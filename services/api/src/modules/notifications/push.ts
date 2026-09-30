import { Logger } from "@nestjs/common";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";
import type { AppConfig } from "../../config";

/** A device that can receive push notifications (the token is decrypted only for sending). */
export interface PushTarget {
  deviceId: string;
  token: string;
  environment: "sandbox" | "production";
}

/** What a push shows. Generic by design: no health details (see PushService). */
export interface PushMessage {
  notificationId: string;
  category: string;
  title: string;
  body: string;
  link: string | null;
}

export type PushOutcome = { status: "sent" } | { status: "invalid_token"; reason: string } | { status: "failed"; reason: string };

/**
 * Delivery channel. `LogPushProvider` (development: logs, sends nothing),
 * `NoPushProvider` (push off) and `ApnsPushProvider` (Apple Push Notification
 * service — needs the paid Apple Developer Program; only built when
 * PUSH_PROVIDER=apns).
 */
export interface PushProvider {
  readonly name: "log" | "apns" | "none";
  /** false: nothing is delivered, so dispatch is skipped entirely. */
  readonly enabled: boolean;
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

export const PUSH_PROVIDER = Symbol("PUSH_PROVIDER");

export class NoPushProvider implements PushProvider {
  readonly name = "none";
  readonly enabled = false;
  async send(): Promise<PushOutcome> {
    return { status: "failed", reason: "push_disabled" };
  }
}

/**
 * Development adapter: records and logs what would be sent — ids and the
 * category only, never the text — and sends nothing.
 */
export class LogPushProvider implements PushProvider {
  readonly name = "log";
  readonly enabled = true;
  /** The most recent deliveries (for tests and local inspection). */
  readonly delivered: { target: PushTarget; message: PushMessage }[] = [];
  private readonly logger = new Logger("Push");

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.delivered.push({ target, message });
    if (this.delivered.length > 100) this.delivered.shift();
    this.logger.log(`[log adapter, not sent] notification ${message.notificationId} (${message.category}) → device ${target.deviceId}`);
    return { status: "sent" };
  }
}

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  bundleId: string;
  /** The .p8 key (PEM, PKCS#8). */
  privateKey: string;
}

/** One HTTP/2 request to APNs. Swappable so the adapter is testable without Apple. */
export interface ApnsTransport {
  post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }>;
  close?(): void;
}

const APNS_ORIGIN = { production: "https://api.push.apple.com", sandbox: "https://api.sandbox.push.apple.com" } as const;
/** APNs reasons that mean the token will never work again. */
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

/**
 * Apple Push Notification service with token-based auth (ES256 JWT from a
 * .p8 key, refreshed every 50 minutes). Built only when PUSH_PROVIDER=apns
 * and every APNS_* value is set; see docs/phase2d-plan.md for what's needed.
 */
export class ApnsPushProvider implements PushProvider {
  readonly name = "apns";
  readonly enabled = true;
  private jwt: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly credentials: ApnsCredentials,
    private readonly transport: ApnsTransport = new Http2ApnsTransport(),
    private readonly now: () => number = Date.now,
  ) {}

  async send(target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    const payload = {
      aps: { alert: { title: message.title, body: message.body }, sound: "default", "thread-id": message.category },
      notificationId: message.notificationId,
      link: message.link,
    };
    const headers = {
      authorization: `bearer ${await this.token()}`,
      "apns-topic": this.credentials.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(this.now() / 1000) + 86_400),
      "apns-collapse-id": message.notificationId.slice(0, 64),
      "content-type": "application/json",
    };
    let response: { status: number; body: string };
    try {
      response = await this.transport.post(APNS_ORIGIN[target.environment], `/3/device/${target.token}`, headers, JSON.stringify(payload));
    } catch (error) {
      return { status: "failed", reason: error instanceof Error ? error.name : "network" };
    }
    if (response.status === 200) return { status: "sent" };
    const reason = parseReason(response.body);
    if (response.status === 410 || DEAD_TOKEN_REASONS.has(reason)) return { status: "invalid_token", reason };
    if (response.status === 403 && reason === "ExpiredProviderToken") this.jwt = null;
    return { status: "failed", reason: reason || `http_${response.status}` };
  }

  private async token(): Promise<string> {
    const now = this.now();
    if (this.jwt && now - this.jwt.issuedAt < 50 * 60_000) return this.jwt.value;
    const key = await importPKCS8(this.credentials.privateKey, "ES256");
    const value = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.credentials.keyId })
      .setIssuer(this.credentials.teamId)
      .setIssuedAt(Math.floor(now / 1000))
      .sign(key);
    this.jwt = { value, issuedAt: now };
    return value;
  }
}

function parseReason(body: string): string {
  try {
    const reason = (JSON.parse(body) as { reason?: unknown }).reason;
    return typeof reason === "string" ? reason : "";
  } catch {
    return "";
  }
}

/** node:http2 client, one session per APNs origin. */
export class Http2ApnsTransport implements ApnsTransport {
  private readonly sessions = new Map<string, ClientHttp2Session>();

  post(origin: string, path: string, headers: Record<string, string>, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      let session = this.sessions.get(origin);
      if (!session || session.closed || session.destroyed) {
        session = connect(origin);
        session.on("error", () => this.sessions.delete(origin));
        session.on("close", () => this.sessions.delete(origin));
        this.sessions.set(origin, session);
      }
      const request = session.request({ [constants.HTTP2_HEADER_METHOD]: "POST", [constants.HTTP2_HEADER_PATH]: path, ...headers });
      let status = 0;
      let data = "";
      request.setEncoding("utf8");
      request.setTimeout(10_000, () => request.close(constants.NGHTTP2_CANCEL));
      request.on("response", (h) => (status = Number(h[constants.HTTP2_HEADER_STATUS])));
      request.on("data", (chunk: string) => (data += chunk));
      request.on("end", () => resolve({ status, body: data }));
      request.on("error", reject);
      request.end(body);
    });
  }

  close() {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }
}

/** PUSH_PROVIDER: log (development default), none (production default), apns (explicit, fully configured). */
export function pushProviderFor(config: AppConfig): PushProvider {
  switch (config.pushProvider) {
    case "apns":
      return new ApnsPushProvider({
        keyId: config.APNS_KEY_ID!,
        teamId: config.APNS_TEAM_ID!,
        bundleId: config.APNS_BUNDLE_ID!,
        privateKey: config.APNS_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      });
    case "log":
      return new LogPushProvider();
    default:
      return new NoPushProvider();
  }
}

// ── Device tokens at rest ────────────────────────────────────────────────────

/** Lookup key for a token (unique per device), so the token itself is never queried. */
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** AES-256-GCM: "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** null when the value can't be decrypted with this key (e.g. a development key from an earlier run). */
export function decryptToken(value: string, key: Buffer): string | null {
  const [version, iv, tag, ciphertext] = value.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Quiet hours ──────────────────────────────────────────────────────────────

/** Whether `now` falls in the person's quiet hours ("22:00"–"07:00" wraps midnight; equal times mean none). */
export function inQuietHours(now: Date, timeZone: string, start: string, end: string): boolean {
  if (start === end) return false;
  let local: string;
  try {
    local = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  } catch {
    local = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  }
  return start < end ? local >= start && local < end : local >= start || local < end;
}

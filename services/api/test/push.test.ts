import { createHash, randomBytes } from "node:crypto";
import { exportPKCS8, generateKeyPair, jwtVerify, decodeProtectedHeader } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "../src/common/audit";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { InProcessJobQueue, JobQueue } from "../src/modules/documents/job-queue";
import { NotificationsService } from "../src/modules/notifications/notifications.controller";
import {
  ApnsPushProvider,
  decryptToken,
  encryptToken,
  inQuietHours,
  LogPushProvider,
  NoPushProvider,
  pushProviderFor,
  type ApnsTransport,
  type PushMessage,
  type PushOutcome,
  type PushProvider,
  type PushTarget,
} from "../src/modules/notifications/push";
import { PRIVATE_PUSH, PushService } from "../src/modules/notifications/push.service";
import { createTestContext, signUp, type TestContext } from "./helpers";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const deviceToken = () => randomBytes(32).toString("hex");

describe("device tokens at rest", () => {
  it("are encrypted with AES-256-GCM and unreadable without the key", () => {
    const key = randomBytes(32);
    const token = deviceToken();
    const stored = encryptToken(token, key);
    expect(stored).not.toContain(token);
    expect(stored).not.toBe(encryptToken(token, key)); // fresh IV each time
    expect(decryptToken(stored, key)).toBe(token);
    expect(decryptToken(stored, randomBytes(32))).toBeNull();
    const [v, iv, tag, ct] = stored.split(".");
    const tampered = [v, iv, tag, Buffer.from(Buffer.from(ct!, "base64url").map((b, i) => (i === 0 ? b ^ 1 : b))).toString("base64url")].join(".");
    expect(decryptToken(tampered, key)).toBeNull();
    expect(decryptToken("garbage", key)).toBeNull();
  });
});

describe("quiet hours", () => {
  it("wrap midnight, follow the person's time zone, and are off when start equals end", () => {
    const at = (iso: string) => new Date(iso);
    expect(inQuietHours(at("2026-09-30T23:30:00Z"), "UTC", "22:00", "07:00")).toBe(true);
    expect(inQuietHours(at("2026-09-30T06:59:00Z"), "UTC", "22:00", "07:00")).toBe(true);
    expect(inQuietHours(at("2026-09-30T07:00:00Z"), "UTC", "22:00", "07:00")).toBe(false);
    expect(inQuietHours(at("2026-09-30T12:00:00Z"), "UTC", "22:00", "07:00")).toBe(false);
    // 14:00 UTC is 23:00 in Tokyo.
    expect(inQuietHours(at("2026-09-30T14:00:00Z"), "Asia/Tokyo", "22:00", "07:00")).toBe(true);
    expect(inQuietHours(at("2026-09-30T13:00:00Z"), "UTC", "12:00", "14:00")).toBe(true);
    expect(inQuietHours(at("2026-09-30T13:00:00Z"), "UTC", "09:00", "09:00")).toBe(false);
    expect(inQuietHours(at("2026-09-30T23:30:00Z"), "Not/AZone", "22:00", "07:00")).toBe(true); // falls back to UTC
  });
});

describe("push configuration", () => {
  it("logs instead of sending in development and is off in production", () => {
    const dev = loadConfig(env({ NODE_ENV: "development" }));
    expect(dev.pushProvider).toBe("log");
    expect(pushProviderFor(dev)).toBeInstanceOf(LogPushProvider);
    expect(dev.pushTokenKey).toHaveLength(32); // random per process
    const prod = loadConfig(env({ NODE_ENV: "production", DATABASE_URL: "postgres://x", SUPABASE_URL: "https://p.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p", SUPABASE_SECRET_KEY: "s" }));
    expect(prod.pushProvider).toBe("none");
    expect(prod.pushTokenKey).toBeNull(); // no key: devices can't be stored
    const none = pushProviderFor(prod);
    expect(none).toBeInstanceOf(NoPushProvider);
    expect(none.enabled).toBe(false);
  });

  it("keeps APNs disabled unless it is explicitly selected and fully configured", async () => {
    // Not selected: never built, whatever else is set.
    const withKeys = loadConfig(env({ NODE_ENV: "development", APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456", APNS_BUNDLE_ID: "app.healthmate.ios" }));
    expect(pushProviderFor(withKeys)).not.toBeInstanceOf(ApnsPushProvider);
    // Selected without credentials: refused at startup.
    expect(() => loadConfig(env({ NODE_ENV: "development", PUSH_PROVIDER: "apns" }))).toThrow(/APNS_KEY_ID/);
    const { privateKey } = await generateKeyPair("ES256", { extractable: true });
    const apns = { PUSH_PROVIDER: "apns", APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "TEAM123456", APNS_BUNDLE_ID: "app.healthmate.ios", APNS_PRIVATE_KEY: (await exportPKCS8(privateKey)).replace(/\n/g, "\\n") };
    expect(() => loadConfig(env({ NODE_ENV: "development", ...apns }))).toThrow(/PUSH_TOKEN_KEY/);
    const config = loadConfig(env({ NODE_ENV: "development", ...apns, PUSH_TOKEN_KEY: randomBytes(32).toString("base64") }));
    expect(pushProviderFor(config)).toBeInstanceOf(ApnsPushProvider);
    expect(() => loadConfig(env({ NODE_ENV: "development", PUSH_TOKEN_KEY: randomBytes(16).toString("base64") }))).toThrow(/32 bytes/);
  });
});

describe("APNs adapter (fake transport — nothing is sent to Apple)", () => {
  const message: PushMessage = { notificationId: "7b1f6a2e-0000-4000-8000-000000000001", category: "report", title: PRIVATE_PUSH.title, body: PRIVATE_PUSH.body, link: "/reports/x" };

  async function setup(respond: () => { status: number; body: string } | Promise<never>) {
    const { privateKey, publicKey } = await generateKeyPair("ES256", { extractable: true });
    const requests: { origin: string; path: string; headers: Record<string, string>; body: string }[] = [];
    const transport: ApnsTransport = {
      post: async (origin, path, headers, body) => {
        requests.push({ origin, path, headers, body });
        return respond();
      },
    };
    let clock = Date.parse("2026-09-30T10:00:00Z");
    const provider = new ApnsPushProvider({ keyId: "ABC123DEFG", teamId: "TEAM123456", bundleId: "app.healthmate.ios", privateKey: await exportPKCS8(privateKey) }, transport, () => clock);
    return { provider, requests, publicKey, advance: (ms: number) => (clock += ms) };
  }

  it("sends an alert with token auth to the device's environment", async () => {
    const { provider, requests, publicKey } = await setup(() => ({ status: 200, body: "" }));
    const token = deviceToken();
    expect(await provider.send({ deviceId: "d1", token, environment: "sandbox" }, message)).toEqual({ status: "sent" });
    await provider.send({ deviceId: "d2", token, environment: "production" }, message);
    expect(requests.map((r) => r.origin)).toEqual(["https://api.sandbox.push.apple.com", "https://api.push.apple.com"]);
    const [first] = requests;
    expect(first!.path).toBe(`/3/device/${token}`);
    expect(first!.headers).toMatchObject({ "apns-topic": "app.healthmate.ios", "apns-push-type": "alert", "apns-priority": "10" });
    const jwt = first!.headers.authorization!.replace(/^bearer /, "");
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: "ES256", kid: "ABC123DEFG" });
    await expect(jwtVerify(jwt, publicKey, { issuer: "TEAM123456", currentDate: new Date("2026-09-30T10:00:00Z") })).resolves.toBeDefined();
    expect(JSON.parse(first!.body)).toEqual({ aps: { alert: { title: "HealthMate", body: PRIVATE_PUSH.body }, sound: "default", "thread-id": "report" }, notificationId: message.notificationId, link: "/reports/x" });
  });

  it("reuses its signing token for 50 minutes, then signs a new one", async () => {
    const { provider, requests, advance } = await setup(() => ({ status: 200, body: "" }));
    const target: PushTarget = { deviceId: "d", token: deviceToken(), environment: "sandbox" };
    await provider.send(target, message);
    advance(10 * 60_000);
    await provider.send(target, message);
    advance(45 * 60_000);
    await provider.send(target, message);
    const auth = requests.map((r) => r.headers.authorization);
    expect(auth[0]).toBe(auth[1]);
    expect(auth[2]).not.toBe(auth[1]);
  });

  it("reports dead tokens separately from other failures", async () => {
    const target: PushTarget = { deviceId: "d", token: deviceToken(), environment: "sandbox" };
    expect(await (await setup(() => ({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) }))).provider.send(target, message)).toEqual({ status: "invalid_token", reason: "Unregistered" });
    expect(await (await setup(() => ({ status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) }))).provider.send(target, message)).toEqual({ status: "invalid_token", reason: "BadDeviceToken" });
    expect(await (await setup(() => ({ status: 500, body: "" }))).provider.send(target, message)).toEqual({ status: "failed", reason: "http_500" });
    expect(await (await setup(() => Promise.reject(new TypeError("network down")))).provider.send(target, message)).toEqual({ status: "failed", reason: "TypeError" });
  });
});

/** Records deliveries and lets a test choose the outcome. */
class ScriptedPushProvider implements PushProvider {
  readonly name = "log" as const;
  readonly enabled = true;
  readonly delivered: { target: PushTarget; message: PushMessage }[] = [];
  outcome: PushOutcome = { status: "sent" };
  async send(target: PushTarget, message: PushMessage) {
    this.delivered.push({ target, message });
    return this.outcome;
  }
}

describe("device registration and push dispatch", () => {
  let ctx: TestContext;
  const provider = new ScriptedPushProvider();
  beforeAll(async () => {
    ctx = await createTestContext({ pushProvider: provider });
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    provider.delivered.length = 0;
    provider.outcome = { status: "sent" };
    await ctx.app.get(RateLimiter).reset();
  });

  const register = (auth: Record<string, string>, token: string, extra: Record<string, unknown> = {}) =>
    ctx.http.post("/v1/me/devices").set(auth).send({ platform: "ios", token, environment: "sandbox", appVersion: "1.0 (1)", ...extra });
  const notify = async (userId: string) => {
    const notifications = ctx.app.get(NotificationsService);
    const id = await notifications.notify(userId, { category: "report", title: "Your report summary is ready", body: "Open it to see the summary.", link: "/reports/abc" });
    await notifications.deliver(userId, id);
    await ctx.drainJobs();
    return id;
  };

  it("registers a device without ever returning or storing the plain token", async () => {
    const user = await signUp(ctx, []);
    const token = deviceToken();
    const res = await register(user.auth, token.toUpperCase()).expect(201);
    expect(res.body).toMatchObject({ platform: "ios", environment: "sandbox", appVersion: "1.0 (1)", active: true });
    expect(JSON.stringify(res.body)).not.toContain(token);
    const listed = (await ctx.http.get("/v1/me/devices").set(user.auth).expect(200)).body.devices;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(token);
    const row = (await ctx.db.query<{ token_hash: string; token_ciphertext: string }>(`SELECT token_hash, token_ciphertext FROM push_devices WHERE id = $1`, [res.body.id])).rows[0]!;
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.token_ciphertext).not.toContain(token);
    // Registering again updates the same device.
    const again = await register(user.auth, token).expect(201);
    expect(again.body.id).toBe(res.body.id);
    // The export lists devices without tokens.
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.pushDevices).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toContain(token);
  });

  it("validates input and requires a session", async () => {
    const user = await signUp(ctx, []);
    await ctx.http.post("/v1/me/devices").send({ platform: "ios", token: deviceToken(), environment: "sandbox" }).expect(401);
    await register(user.auth, "not-hex").expect(400);
    await register(user.auth, deviceToken(), { platform: "android" }).expect(400);
    await register(user.auth, deviceToken(), { environment: "staging" }).expect(400);
  });

  it("moves a token to whoever signs in on the device, and unregisters it", async () => {
    const alice = await signUp(ctx, []);
    const bob = await signUp(ctx, []);
    const token = deviceToken();
    const device = (await register(alice.auth, token).expect(201)).body;
    await register(bob.auth, token).expect(201);
    expect((await ctx.http.get("/v1/me/devices").set(alice.auth).expect(200)).body.devices).toEqual([]);
    expect((await ctx.http.get("/v1/me/devices").set(bob.auth).expect(200)).body.devices).toHaveLength(1);
    // Alice can't remove Bob's device, by id or by token.
    await ctx.http.delete(`/v1/me/devices/${device.id}`).set(alice.auth).expect(404);
    await ctx.http.delete("/v1/me/devices").set(alice.auth).send({ token }).expect(204);
    expect((await ctx.http.get("/v1/me/devices").set(bob.auth).expect(200)).body.devices).toHaveLength(1);
    // Bob signs out on the device.
    await ctx.http.delete("/v1/me/devices").set(bob.auth).send({ token }).expect(204);
    expect((await ctx.http.get("/v1/me/devices").set(bob.auth).expect(200)).body.devices).toEqual([]);
    const second = (await register(bob.auth, deviceToken()).expect(201)).body;
    await ctx.http.delete(`/v1/me/devices/${second.id}`).set(bob.auth).expect(204);
  });

  it("pushes a notification to every active device, private by default", async () => {
    const user = await signUp(ctx, []);
    const tokens = [deviceToken(), deviceToken()];
    for (const token of tokens) await register(user.auth, token).expect(201);
    const enqueue = vi.spyOn(ctx.app.get(JobQueue), "enqueue");
    const id = await notify(user.userId);
    expect(provider.delivered.map((d) => d.target.token).sort()).toEqual([...tokens].sort());
    // Ids only in the job, and a job id Redis/BullMQ accepts (no ":").
    expect(enqueue).toHaveBeenCalledWith("push-notification", { userId: user.userId, notificationId: id }, expect.objectContaining({ jobId: expect.not.stringContaining(":") }));
    enqueue.mockRestore();
    // Health details stay off the lock screen unless the person turned them on.
    expect(provider.delivered[0]!.message).toEqual({ notificationId: id, category: "report", link: "/reports/abc", ...PRIVATE_PUSH });
  });

  it("follows the person's preferences: details, category switches and quiet hours", async () => {
    const user = await signUp(ctx, []);
    await register(user.auth, deviceToken()).expect(201);
    const prefs = (await ctx.http.get("/v1/me/notification-preferences").set(user.auth).expect(200)).body;
    await ctx.http.put("/v1/me/notification-preferences").set(user.auth).send({ ...prefs, showDetails: true }).expect(200);
    await notify(user.userId);
    expect(provider.delivered.at(-1)!.message).toMatchObject({ title: "Your report summary is ready", body: "Open it to see the summary." });

    provider.delivered.length = 0;
    await ctx.http.put("/v1/me/notification-preferences").set(user.auth).send({ ...prefs, report: false }).expect(200);
    await notify(user.userId);
    expect(provider.delivered).toHaveLength(0);

    await ctx.http.put("/v1/me/notification-preferences").set(user.auth).send({ ...prefs, quietHours: { enabled: true, start: "00:00", end: "23:59" } }).expect(200);
    const id = await ctx.app.get(NotificationsService).notify(user.userId, { category: "report", title: "Ready", body: "" });
    const push = ctx.app.get(PushService);
    expect(await push.dispatch(user.userId, id!, new Date("2026-09-30T12:00:00Z"))).toEqual({ skipped: "quiet_hours" });
    await ctx.http.put("/v1/me/notification-preferences").set(user.auth).send({ ...prefs, quietHours: { enabled: false, start: "22:00", end: "07:00" } }).expect(200);
    expect(await push.dispatch(user.userId, id!)).toEqual({ sent: 1, failed: 0, invalidated: 0 });
    // Nothing is pushed for another person's notification or one already read.
    const other = await signUp(ctx, []);
    expect(await push.dispatch(other.userId, id!)).toEqual({ skipped: "not_found" });
    await ctx.http.patch(`/v1/notifications/${id}`).set(user.auth).send({ read: true }).expect(200);
    expect(await push.dispatch(user.userId, id!)).toEqual({ skipped: "already_read" });
  });

  it("disables devices whose token the push service rejects, until they register again", async () => {
    const user = await signUp(ctx, []);
    const token = deviceToken();
    await register(user.auth, token).expect(201);
    provider.outcome = { status: "invalid_token", reason: "Unregistered" };
    await notify(user.userId);
    expect((await ctx.http.get("/v1/me/devices").set(user.auth).expect(200)).body.devices[0].active).toBe(false);
    provider.delivered.length = 0;
    provider.outcome = { status: "sent" };
    await notify(user.userId);
    expect(provider.delivered).toHaveLength(0); // disabled devices get nothing
    await register(user.auth, token).expect(201);
    expect((await ctx.http.get("/v1/me/devices").set(user.auth).expect(200)).body.devices[0].active).toBe(true);
  });

  it("does nothing when push is off, and can't store tokens without a key", async () => {
    const user = await signUp(ctx, []);
    const config = { ...loadConfig(env({ NODE_ENV: "test" })), pushTokenKey: null };
    const service = new PushService(ctx.db, config, new NoPushProvider(), new InProcessJobQueue(), ctx.app.get(AuditService));
    await expect(service.register(user.userId, { platform: "ios", token: deviceToken(), environment: "sandbox" })).rejects.toMatchObject({ status: 501, code: "not_available" });
    expect(await service.dispatch(user.userId, "7b1f6a2e-0000-4000-8000-000000000001")).toEqual({ skipped: "push_disabled" });
  });
});

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Private buckets (created by migration 0005 on Supabase). */
export type Bucket = "medical-reports" | "health-images" | "avatars";
export const BUCKETS: readonly Bucket[] = ["medical-reports", "health-images", "avatars"];

/** An object location. Paths are always `<user id>/<record id>`. */
export interface ObjectRef {
  bucket: Bucket;
  path: string;
}

/**
 * Private object storage for uploaded reports and photos. Clients upload and
 * download only through short-lived signed URLs issued by the API after its
 * ownership checks; there are no public URLs.
 */
export interface ObjectStorage {
  createUploadUrl(ref: ObjectRef, contentType: string, byteSize: number, ttlSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  createDownloadUrl(ref: ObjectRef, ttlSeconds: number): Promise<string>;
  read(ref: ObjectRef): Promise<Buffer | null>;
  delete(ref: ObjectRef): Promise<void>;
  /** Removes every object under `<userId>/` in every bucket (account deletion). */
  deleteUserFiles(userId: string): Promise<void>;
}

export const STORAGE = Symbol("STORAGE");

type Grant = { op: "put" | "get"; key: string; contentType?: string; byteSize?: number; expires: number };

/**
 * Development/single-server storage on local disk. Signed URLs point at
 * `/v1/uploads/:token` (PUT to upload, GET to download); the token is an
 * HMAC-signed, expiring grant for exactly one object (and, for uploads, one size).
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(
    root: string,
    private readonly publicBaseUrl: string,
    private readonly secret: string,
  ) {
    this.root = resolve(root);
  }

  async createUploadUrl(ref: ObjectRef, contentType: string, byteSize: number, ttlSeconds: number) {
    const token = this.sign({ op: "put", key: keyOf(ref), contentType, byteSize, expires: Math.floor(Date.now() / 1000) + ttlSeconds });
    return { url: `${this.publicBaseUrl.replace(/\/$/, "")}/v1/uploads/${token}`, headers: { "Content-Type": contentType } };
  }

  async createDownloadUrl(ref: ObjectRef, ttlSeconds: number) {
    const token = this.sign({ op: "get", key: keyOf(ref), expires: Math.floor(Date.now() / 1000) + ttlSeconds });
    return `${this.publicBaseUrl.replace(/\/$/, "")}/v1/uploads/${token}`;
  }

  /** Verifies a signed token for the given operation; null when invalid or expired. */
  verifyToken(token: string, op: Grant["op"]): Grant | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.hmac(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Grant;
      if (grant.op !== op || grant.expires < Math.floor(Date.now() / 1000)) return null;
      return grant;
    } catch {
      return null;
    }
  }

  async write(key: string, data: Buffer) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { mode: 0o600 });
  }

  async readKey(key: string) {
    const path = this.pathFor(key);
    try {
      await stat(path);
      return await readFile(path);
    } catch {
      return null;
    }
  }

  read(ref: ObjectRef) {
    return this.readKey(keyOf(ref));
  }

  async delete(ref: ObjectRef) {
    await rm(this.pathFor(keyOf(ref)), { force: true });
  }

  async deleteUserFiles(userId: string) {
    for (const bucket of BUCKETS) await rm(this.pathFor(`${bucket}/${userId}`), { recursive: true, force: true });
  }

  /** Test helper: object keys under a bucket. */
  async list(bucket: Bucket): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, prefix: string) => {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else out.push(`${prefix}${entry.name}`);
      }
    };
    await walk(join(this.root, bucket), "");
    return out;
  }

  private sign(grant: Grant) {
    const payload = Buffer.from(JSON.stringify(grant)).toString("base64url");
    return `${payload}.${this.hmac(payload)}`;
  }

  private hmac(payload: string) {
    return createHmac("sha256", this.secret).update(`storage:${payload}`).digest("base64url");
  }

  /** Keys are server-generated, but still refuse anything that escapes the root. */
  private pathFor(key: string) {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return path;
  }
}

/**
 * Supabase Storage (production). Server-side only: authenticated with the
 * secret key, which never leaves the API. Buckets are private.
 */
export class SupabaseObjectStorage implements ObjectStorage {
  private readonly base: string;

  constructor(
    supabaseUrl: string,
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `${supabaseUrl.replace(/\/$/, "")}/storage/v1`;
  }

  async createUploadUrl(ref: ObjectRef, contentType: string, _byteSize: number, _ttlSeconds: number) {
    // Supabase signed upload URLs are valid for 2 hours; the API re-checks size and type before processing.
    const body = await this.call<{ url: string }>("POST", `/object/upload/sign/${ref.bucket}/${encodePath(ref.path)}`, {});
    return { url: `${this.base}${body.url}`, headers: { "Content-Type": contentType } };
  }

  async createDownloadUrl(ref: ObjectRef, ttlSeconds: number) {
    const body = await this.call<{ signedURL: string }>("POST", `/object/sign/${ref.bucket}/${encodePath(ref.path)}`, { expiresIn: ttlSeconds });
    return `${this.base}${body.signedURL}`;
  }

  async read(ref: ObjectRef) {
    const res = await this.fetchImpl(`${this.base}/object/authenticated/${ref.bucket}/${encodePath(ref.path)}`, { headers: this.headers() });
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new Error(`storage read failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(ref: ObjectRef) {
    await this.call("DELETE", `/object/${ref.bucket}`, { prefixes: [ref.path] });
  }

  async deleteUserFiles(userId: string) {
    for (const bucket of BUCKETS) {
      for (;;) {
        const objects = await this.call<{ name: string }[]>("POST", `/object/list/${bucket}`, { prefix: `${userId}/`, limit: 100, offset: 0 });
        if (!objects.length) break;
        await this.call("DELETE", `/object/${bucket}`, { prefixes: objects.map((o) => `${userId}/${o.name}`) });
        if (objects.length < 100) break;
      }
    }
  }

  private headers(json = false): Record<string, string> {
    // New `sb_secret_…` keys go in `apikey` only; legacy service-role JWTs also as a bearer token.
    const headers: Record<string, string> = { apikey: this.secretKey };
    if (!this.secretKey.startsWith("sb_")) headers.Authorization = `Bearer ${this.secretKey}`;
    if (json) headers["Content-Type"] = "application/json";
    return headers;
  }

  private async call<T = unknown>(method: string, path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, { method, headers: this.headers(true), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`storage ${method} failed (${res.status})`);
    return (await res.json().catch(() => ({}))) as T;
  }
}

const keyOf = (ref: ObjectRef) => `${ref.bucket}/${ref.path}`;
const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export type SupportedContentType = "application/pdf" | "image/jpeg" | "image/png";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Checks the file's real type from its first bytes — never trust the declared type alone. */
export function sniffContentType(data: Buffer): SupportedContentType | null {
  if (data.length >= 5 && data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

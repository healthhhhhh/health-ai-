import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Object storage for uploaded reports and images. Clients upload directly to a
 * short-lived signed URL (spec §6.1) instead of through the API.
 */
export interface ObjectStorage {
  /** A URL the client can PUT the file to, valid for `ttlSeconds`. */
  createUploadUrl(key: string, contentType: string, byteSize: number, ttlSeconds: number): Promise<{ url: string; headers: Record<string, string> }>;
  read(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export const STORAGE = Symbol("STORAGE");

/**
 * Development/single-server storage on local disk. Upload URLs point at
 * `PUT /v1/uploads/:token`, where the token is an HMAC-signed, expiring
 * grant for exactly one key and size.
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

  async createUploadUrl(key: string, contentType: string, byteSize: number, ttlSeconds: number) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const payload = Buffer.from(JSON.stringify({ key, contentType, byteSize, expires })).toString("base64url");
    const token = `${payload}.${this.sign(payload)}`;
    return { url: `${this.publicBaseUrl.replace(/\/$/, "")}/v1/uploads/${token}`, headers: { "Content-Type": contentType } };
  }

  /** Verifies an upload token; returns the grant or null when invalid/expired. */
  verifyUploadToken(token: string): { key: string; contentType: string; byteSize: number } | null {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const grant = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { key: string; contentType: string; byteSize: number; expires: number };
      if (grant.expires < Math.floor(Date.now() / 1000)) return null;
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

  async read(key: string) {
    const path = this.pathFor(key);
    try {
      await stat(path);
      return await readFile(path);
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }

  private sign(payload: string) {
    return createHmac("sha256", this.secret).update(`upload:${payload}`).digest("base64url");
  }

  /** Keys are server-generated, but still refuse anything that escapes the root. */
  private pathFor(key: string) {
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep)) throw new Error("Invalid storage key");
    return path;
  }
}

export type SupportedContentType = "application/pdf" | "image/jpeg" | "image/png";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Checks the file's real type from its first bytes — never trust the declared type alone. */
export function sniffContentType(data: Buffer): SupportedContentType | null {
  if (data.length >= 5 && data.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

import { Inject, Injectable } from "@nestjs/common";
import { jwtVerify, SignJWT } from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CONFIG, type AppConfig } from "../../config";
import { DATABASE, type Database, type Queryable } from "../../db/database";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
const ISSUER = "healthmate-api";
const AUDIENCE = "healthmate-clients";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type RefreshOutcome = { kind: "rotated"; userId: string; tokens: TokenPair } | { kind: "invalid" } | { kind: "reused"; userId: string };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Short-lived JWT access tokens + opaque, rotating refresh tokens stored only as
 * hashes. Presenting an already-rotated refresh token revokes its whole family
 * (token theft detection).
 */
@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(CONFIG) config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async issue(userId: string, tx: Queryable = this.db, familyId: string = randomUUID()): Promise<TokenPair> {
    const accessToken = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
    const refreshToken = randomBytes(32).toString("base64url");
    await tx.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
      [userId, familyId, hashToken(refreshToken), String(REFRESH_TOKEN_TTL_DAYS)],
    );
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async verifyAccessToken(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ["HS256"] });
      return typeof payload.sub === "string" ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async rotate(refreshToken: string): Promise<RefreshOutcome> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; user_id: string; family_id: string; revoked_at: Date | null; expired: boolean }>(
        `SELECT id, user_id, family_id, revoked_at, expires_at < now() AS expired FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(refreshToken)],
      );
      const row = rows[0];
      if (!row) return { kind: "invalid" };
      if (row.revoked_at) {
        await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id]);
        return { kind: "reused", userId: row.user_id };
      }
      if (row.expired) return { kind: "invalid" };
      await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
      return { kind: "rotated", userId: row.user_id, tokens: await this.issue(row.user_id, tx, row.family_id) };
    });
  }

  async revoke(refreshToken: string): Promise<string | null> {
    const { rows } = await this.db.query<{ user_id: string }>(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL RETURNING user_id`,
      [hashToken(refreshToken)],
    );
    return rows[0]?.user_id ?? null;
  }

  async revokeAll(userId: string, tx: Queryable = this.db) {
    await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
}

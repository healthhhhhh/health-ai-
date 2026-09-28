import { HttpStatus, Logger } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ApiError, unauthorized } from "../../common/errors";
import type { Database } from "../../db/database";
import type { AuthService } from "./auth.service";
import type { TokenPair, TokenService } from "./token.service";

export type AuthResult = { userId: string; tokens: TokenPair } | { userId: string | null; confirmationRequired: true };

/**
 * Who a person is. The API's `/v1/auth/*` routes and its guard depend on this
 * interface only:
 * - `LocalIdentityProvider`: argon2id + rotating refresh tokens in our own
 *   tables (development, tests, demo).
 * - `SupabaseIdentityProvider`: Supabase Auth (production). The API calls
 *   Supabase Auth server-side so existing clients keep the same contract.
 */
export interface IdentityProvider {
  readonly kind: "local" | "supabase";
  register(input: { email: string; password: string; firstName: string; lastName: string; timeZone: string }): Promise<AuthResult>;
  login(email: string, password: string): Promise<{ userId: string; tokens: TokenPair }>;
  refresh(refreshToken: string): Promise<TokenPair>;
  logout(refreshToken: string, accessToken?: string): Promise<void>;
  /** The user id for a valid access token, else null. */
  verifyAccessToken(token: string): Promise<string | null>;
  verifyPassword(userId: string, password: string): Promise<boolean>;
  /** Sends a reset email when the account exists. Never reveals whether it does. */
  requestPasswordReset(email: string, redirectTo?: string): Promise<void>;
  /** Sets a new password using the access token from a reset link, then ends every other session. */
  completePasswordReset(recoveryToken: string, newPassword: string): Promise<void>;
  /** Removes the identity and (by cascade) every HealthMate row. Idempotent. */
  deleteIdentity(userId: string): Promise<void>;
}

export const IDENTITY = Symbol("IDENTITY");

export class LocalIdentityProvider implements IdentityProvider {
  readonly kind = "local";

  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly db: Database,
  ) {}

  register(input: { email: string; password: string; firstName: string; lastName: string; timeZone: string }) {
    return this.auth.register({ email: input.email, password: input.password }, input);
  }
  login(email: string, password: string) {
    return this.auth.login({ email, password });
  }
  refresh(refreshToken: string) {
    return this.auth.refresh(refreshToken);
  }
  logout(refreshToken: string) {
    return this.auth.logout(refreshToken);
  }
  verifyAccessToken(token: string) {
    return this.tokens.verifyAccessToken(token);
  }
  verifyPassword(userId: string, password: string) {
    return this.auth.verifyPassword(userId, password);
  }
  async requestPasswordReset(): Promise<void> {
    throw new ApiError("not_found", "Password reset isn't available in local development. Use Supabase Auth.", HttpStatus.NOT_IMPLEMENTED);
  }
  async completePasswordReset(): Promise<void> {
    throw new ApiError("not_found", "Password reset isn't available in local development. Use Supabase Auth.", HttpStatus.NOT_IMPLEMENTED);
  }
  async deleteIdentity(userId: string) {
    await this.db.transaction(async (tx) => {
      await this.tokens.revokeAll(userId, tx);
      await tx.query(`DELETE FROM users WHERE id = $1`, [userId]); // cascades to every health table
    });
  }
}

type GoTrueSession = { access_token: string; refresh_token: string; expires_in: number; user: { id: string } };

/**
 * Supabase Auth over its REST API. The publishable key is used for the
 * public auth endpoints; the secret key only for admin calls (account
 * deletion). Access tokens are verified locally against the project's JWKS
 * (asymmetric signing keys), or the legacy JWT secret when configured.
 */
export class SupabaseIdentityProvider implements IdentityProvider {
  readonly kind = "supabase";
  private readonly logger = new Logger("SupabaseAuth");
  private readonly auth: string;
  private readonly issuer: string;
  private readonly jwks: JWTVerifyGetKey;
  private readonly legacySecret?: Uint8Array;

  constructor(
    supabaseUrl: string,
    private readonly publishableKey: string,
    private readonly secretKey: string,
    private readonly db: Database,
    options: { legacyJwtSecret?: string; fetchImpl?: typeof fetch; jwks?: JWTVerifyGetKey } = {},
  ) {
    const base = supabaseUrl.replace(/\/$/, "");
    this.auth = `${base}/auth/v1`;
    this.issuer = this.auth;
    this.jwks = options.jwks ?? createRemoteJWKSet(new URL(`${this.auth}/.well-known/jwks.json`), { cacheMaxAge: 10 * 60_000 });
    this.legacySecret = options.legacyJwtSecret ? new TextEncoder().encode(options.legacyJwtSecret) : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private readonly fetchImpl: typeof fetch;

  async register(input: { email: string; password: string; firstName: string; lastName: string; timeZone: string }): Promise<AuthResult> {
    const res = await this.call("POST", "/signup", {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      data: { first_name: input.firstName, last_name: input.lastName, time_zone: input.timeZone },
    });
    if (res.status === 422 || res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error_code?: string; code?: string | number; msg?: string };
      if (body.error_code === "user_already_exists" || /already registered/i.test(body.msg ?? "")) {
        throw new ApiError("conflict", "An account with this email already exists. Try signing in.", HttpStatus.CONFLICT);
      }
      if (body.error_code === "weak_password") throw new ApiError("validation_failed", "Choose a longer or less common password.", HttpStatus.BAD_REQUEST);
      throw new ApiError("validation_failed", "Those details couldn't be used to create an account.", HttpStatus.BAD_REQUEST);
    }
    if (!res.ok) throw this.unavailable(res.status);
    const body = (await res.json()) as Partial<GoTrueSession> & { id?: string };
    // With email confirmation on, Supabase returns the user without a session.
    if (!body.access_token) return { userId: body.id ?? body.user?.id ?? null, confirmationRequired: true };
    return { userId: body.user!.id, tokens: toPair(body as GoTrueSession) };
  }

  async login(email: string, password: string) {
    const res = await this.call("POST", "/token?grant_type=password", { email: email.trim().toLowerCase(), password });
    if (res.status === 400 || res.status === 401 || res.status === 422) {
      const body = (await res.json().catch(() => ({}))) as { error_code?: string };
      if (body.error_code === "email_not_confirmed") throw unauthorized("Confirm your email address first — check your inbox for the link.");
      throw unauthorized("Email or password is incorrect.");
    }
    if (!res.ok) throw this.unavailable(res.status);
    const session = (await res.json()) as GoTrueSession;
    return { userId: session.user.id, tokens: toPair(session) };
  }

  async refresh(refreshToken: string) {
    const res = await this.call("POST", "/token?grant_type=refresh_token", { refresh_token: refreshToken });
    if (res.status >= 400 && res.status < 500) throw unauthorized();
    if (!res.ok) throw this.unavailable(res.status);
    return toPair((await res.json()) as GoTrueSession);
  }

  /** Ends the session. Uses the access token when given, else a fresh one from the refresh token. */
  async logout(refreshToken: string, accessToken?: string) {
    let token = accessToken;
    if (!token) token = await this.refresh(refreshToken).then((p) => p.accessToken).catch(() => undefined);
    if (!token) return; // already invalid: nothing to end
    await this.call("POST", "/logout?scope=local", undefined, { Authorization: `Bearer ${token}` }).catch(() => undefined);
  }

  async verifyAccessToken(token: string): Promise<string | null> {
    const options = { issuer: this.issuer, audience: "authenticated" };
    try {
      const { payload } = this.legacySecret && isHs256(token) ? await jwtVerify(token, this.legacySecret, options) : await jwtVerify(token, this.jwks, options);
      return typeof payload.sub === "string" && payload.role === "authenticated" ? payload.sub : null;
    } catch {
      return null;
    }
  }

  async verifyPassword(userId: string, password: string) {
    const { rows } = await this.db.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (!rows[0]) return false;
    try {
      const { tokens } = await this.login(rows[0].email, password);
      await this.logout(tokens.refreshToken, tokens.accessToken); // don't leave the check's session behind
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.getStatus() === HttpStatus.UNAUTHORIZED) return false;
      throw error;
    }
  }

  async requestPasswordReset(email: string, redirectTo?: string) {
    const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
    const res = await this.call("POST", `/recover${query}`, { email: email.trim().toLowerCase() });
    // Always succeed from the caller's view so the endpoint can't reveal which emails have accounts.
    if (!res.ok && res.status >= 500) throw this.unavailable(res.status);
  }

  async completePasswordReset(recoveryToken: string, newPassword: string) {
    if (!(await this.verifyAccessToken(recoveryToken))) throw unauthorized("This reset link is invalid or has expired. Request a new one.");
    const auth = { Authorization: `Bearer ${recoveryToken}` };
    const res = await this.call("PUT", "/user", { password: newPassword }, auth);
    if (res.status === 401 || res.status === 403) throw unauthorized("This reset link is invalid or has expired. Request a new one.");
    if (res.status === 422 || res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error_code?: string };
      if (body.error_code === "same_password") throw new ApiError("validation_failed", "Choose a password you haven't used for this account.", HttpStatus.BAD_REQUEST);
      throw new ApiError("validation_failed", "Choose a longer or less common password.", HttpStatus.BAD_REQUEST);
    }
    if (!res.ok) throw this.unavailable(res.status);
    // A reset usually means the old password may be known to someone else.
    await this.call("POST", "/logout?scope=global", undefined, auth).catch(() => undefined);
  }

  async deleteIdentity(userId: string) {
    const res = await this.call("DELETE", `/admin/users/${encodeURIComponent(userId)}`, undefined, this.adminHeaders());
    if (!res.ok && res.status !== 404) throw this.unavailable(res.status);
    // The auth.users trigger (migration 0005) deletes public.users; make sure even if it didn't run.
    await this.db.query(`DELETE FROM users WHERE id = $1`, [userId]);
  }

  private adminHeaders(): Record<string, string> {
    return this.secretKey.startsWith("sb_") ? { apikey: this.secretKey } : { apikey: this.secretKey, Authorization: `Bearer ${this.secretKey}` };
  }

  private call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    return this.fetchImpl(`${this.auth}${path}`, {
      method,
      headers: { apikey: this.publishableKey, "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  private unavailable(status: number) {
    this.logger.warn(`Supabase Auth returned ${status}`);
    return new ApiError("internal", "Sign-in is temporarily unavailable. Please try again in a moment.", HttpStatus.SERVICE_UNAVAILABLE);
  }
}

function toPair(session: GoTrueSession): TokenPair {
  return { accessToken: session.access_token, refreshToken: session.refresh_token, expiresIn: session.expires_in };
}

function isHs256(token: string) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()).alg === "HS256";
  } catch {
    return false;
  }
}

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { AuditService } from "../../common/audit";
import { ApiError, unauthorized } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
import { findLinkedUser, linkIdentity, linkedProviders, providerName, touchIdentity } from "./identity-links";
import type { OAuthProvider, VerifiedIdentity } from "./oauth";
import { TokenService, type TokenPair } from "./token.service";

export interface Credentials {
  email: string;
  password: string;
}

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations). */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

// A real hash used to equalise timing when the email doesn't exist.
let dummyHash: Promise<string> | null = null;

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  static normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  async register({ email, password }: Credentials, profile: { firstName: string; lastName: string; timeZone: string }): Promise<{ userId: string; tokens: TokenPair }> {
    const normalized = AuthService.normalizeEmail(email);
    const passwordHash = await hash(password, ARGON2);
    try {
      return await this.db.transaction(async (tx) => {
        const { rows } = await tx.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`, [normalized, passwordHash]);
        const userId = rows[0]!.id;
        await tx.query(`INSERT INTO profiles (user_id, first_name, last_name, time_zone) VALUES ($1, $2, $3, $4)`, [userId, profile.firstName, profile.lastName, profile.timeZone]);
        await this.audit.log("auth.register", userId, {}, tx);
        return { userId, tokens: await this.tokens.issue(userId, tx) };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApiError("conflict", "An account with this email already exists. Try signing in.", HttpStatus.CONFLICT);
      }
      throw error;
    }
  }

  async login({ email, password }: Credentials): Promise<{ userId: string; tokens: TokenPair }> {
    const { rows } = await this.db.query<{ id: string; password_hash: string | null }>(`SELECT id, password_hash FROM users WHERE email = $1`, [AuthService.normalizeEmail(email)]);
    const user = rows[0];
    // Accounts created with Google have no password: same answer and timing as a wrong one.
    const valid = user?.password_hash ? await verify(user.password_hash, password) : await verifyAgainstDummy(password);
    if (!user || !valid) {
      await this.audit.log("auth.login_failed", user?.id ?? null);
      throw unauthorized("Email or password is incorrect.");
    }
    await this.audit.log("auth.login", user.id);
    return { userId: user.id, tokens: await this.tokens.issue(user.id) };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const outcome = await this.tokens.rotate(refreshToken);
    if (outcome.kind === "rotated") return outcome.tokens;
    if (outcome.kind === "reused") await this.audit.log("auth.refresh_reuse_detected", outcome.userId);
    throw unauthorized();
  }

  async logout(refreshToken: string) {
    const userId = await this.tokens.revoke(refreshToken);
    if (userId) await this.audit.log("auth.logout", userId);
  }

  /** Local accounts: every refresh token is revoked, so other sessions end within the access-token lifetime. */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!(await this.verifyPassword(userId, currentPassword))) throw new ApiError("forbidden", "Your current password is incorrect.", HttpStatus.FORBIDDEN);
    const passwordHash = await hash(newPassword, ARGON2);
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [userId, passwordHash]);
      await this.tokens.revokeAll(userId, tx);
      await this.audit.log("auth.password_changed", userId, {}, tx);
    });
  }

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const { rows } = await this.db.query<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    return rows[0]?.password_hash ? verify(rows[0].password_hash, password) : verifyAgainstDummy(password);
  }

  /**
   * Sign in (or create an account) with a verified Google identity. A returning
   * person is found by the linked identity, never by email alone: an existing
   * password account with the same email must sign in with its password and
   * connect Google from there (`linkIdentity`), so nobody can take over an
   * account just by controlling a matching address.
   */
  async signInWithIdentity(identity: VerifiedIdentity, profile: { firstName: string; lastName: string; timeZone: string }): Promise<{ userId: string; tokens: TokenPair; isNewUser: boolean }> {
    const name = providerName(identity.provider);
    try {
      return await this.db.transaction(async (tx) => {
        const linked = await findLinkedUser(tx, identity.provider, identity.subject);
        if (linked) {
          await touchIdentity(tx, linked, identity);
          await this.audit.log("auth.login", linked, { method: identity.provider }, tx);
          return { userId: linked, tokens: await this.tokens.issue(linked, tx), isNewUser: false };
        }
        if (!identity.email || !identity.emailVerified) {
          throw new ApiError("validation_failed", `Your ${name} account needs a verified email address to create a HealthMate account.`, HttpStatus.BAD_REQUEST);
        }
        const existing = await tx.query(`SELECT 1 FROM users WHERE email = $1`, [identity.email]);
        if (existing.rows[0]) {
          throw new ApiError("conflict", `An account with this email already exists. Sign in with your email and password instead.`, HttpStatus.CONFLICT);
        }
        const { rows } = await tx.query<{ id: string }>(`INSERT INTO users (email, password_hash, email_verified_at) VALUES ($1, NULL, now()) RETURNING id`, [identity.email]);
        const userId = rows[0]!.id;
        await tx.query(`INSERT INTO profiles (user_id, first_name, last_name, time_zone) VALUES ($1, $2, $3, $4)`, [userId, profile.firstName.slice(0, 80), profile.lastName.slice(0, 80), profile.timeZone]);
        await linkIdentity(tx, userId, identity);
        await this.audit.log("auth.register", userId, { method: identity.provider }, tx);
        return { userId, tokens: await this.tokens.issue(userId, tx), isNewUser: true };
      });
    } catch (error) {
      // Two sign-ins racing to create the same account: the other one won.
      if (isUniqueViolation(error)) throw new ApiError("conflict", "That sign-in is already being set up. Please try again.", HttpStatus.CONFLICT);
      throw error;
    }
  }

  /** Connects a verified identity to the signed-in account. */
  async linkIdentity(userId: string, identity: VerifiedIdentity) {
    await this.db.transaction(async (tx) => {
      if ((await linkIdentity(tx, userId, identity)) === "linked") await this.audit.log("auth.identity_linked", userId, { method: identity.provider }, tx);
    });
  }

  /** Disconnects an identity, unless it's the only way left to sign in. */
  async unlinkIdentity(userId: string, provider: OAuthProvider) {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
      const others = (await linkedProviders(tx, userId)).filter((p) => p !== provider);
      if (!rows[0]?.password_hash && others.length === 0) {
        throw new ApiError("conflict", `${providerName(provider)} is the only way to sign in to this account, so it can't be disconnected.`, HttpStatus.CONFLICT);
      }
      const removed = await tx.query(`DELETE FROM auth_identities WHERE user_id = $1 AND provider = $2 RETURNING id`, [userId, provider]);
      if (removed.rows[0]) await this.audit.log("auth.identity_unlinked", userId, { method: provider }, tx);
    });
  }
}

async function verifyAgainstDummy(password: string) {
  dummyHash ??= hash("timing-equaliser-not-a-password", ARGON2);
  await verify(await dummyHash, password);
  return false;
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  return code === "23505" || /duplicate key|unique constraint/i.test(message);
}

import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { hash, verify } from "@node-rs/argon2";
import { AuditService } from "../../common/audit";
import { ApiError, unauthorized } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
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
    const { rows } = await this.db.query<{ id: string; password_hash: string }>(`SELECT id, password_hash FROM users WHERE email = $1`, [AuthService.normalizeEmail(email)]);
    const user = rows[0];
    const valid = user ? await verify(user.password_hash, password) : await verifyAgainstDummy(password);
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

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const { rows } = await this.db.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    return rows[0] ? verify(rows[0].password_hash, password) : false;
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

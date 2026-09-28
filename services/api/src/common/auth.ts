import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { unauthorized } from "./errors";
import { DATABASE, type Database } from "../db/database";
import { IDENTITY, type IdentityProvider } from "../modules/auth/identity";

export interface AuthedRequest extends Request {
  userId?: string;
}

/**
 * Requires a valid access token (local or Supabase) for an account that still
 * exists. Every health route uses it; each query then filters by this user id.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityProvider,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const userId = await this.identity.verifyAccessToken(header.slice(7));
    if (!userId) throw unauthorized();
    // A signed token outlives logout/deletion by up to its expiry; the account must still exist.
    const { rows } = await this.db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!rows[0]) throw unauthorized();
    req.userId = userId;
    return true;
  }
}

/** The authenticated user's id. Only valid on routes guarded by AuthGuard. */
export const UserId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  if (!req.userId) throw unauthorized();
  return req.userId;
});

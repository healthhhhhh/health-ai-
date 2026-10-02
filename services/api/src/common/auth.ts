import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { unauthorized } from "./errors";
import { DATABASE, type Database } from "../db/database";
import { IDENTITY, type IdentityProvider } from "../modules/auth/identity";
import { AgeService } from "../modules/account/age.service";

export interface AuthedRequest extends Request {
  userId?: string;
}

const AGE_EXEMPT = "healthmate:ageExempt";

/**
 * Marks a route (or controller) that an account may use whatever its age state:
 * telling us an age, consents, export, deletion and sign-in security. Everything
 * else is restricted while the age gate refuses the account, so a new route is
 * restricted unless it opts out here.
 */
export const AgeExempt = () => SetMetadata(AGE_EXEMPT, true);

/**
 * Requires a valid access token (local or Supabase) for an account that still
 * exists. Every health route uses it; each query then filters by this user id.
 * With AGE_ENFORCEMENT=enforce it also refuses (403 `age_required`,
 * `age_review` or `age_not_eligible`) accounts that aren't eligible, except on
 * `@AgeExempt()` routes.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityProvider,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AgeService) private readonly age: AgeService,
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
    if (this.age.enforcing && !this.reflector.getAllAndOverride<boolean>(AGE_EXEMPT, [context.getHandler(), context.getClass()])) {
      await this.age.assertEligible(userId);
    }
    return true;
  }
}

/** The authenticated user's id. Only valid on routes guarded by AuthGuard. */
export const UserId = createParamDecorator((_: unknown, context: ExecutionContext): string => {
  const req = context.switchToHttp().getRequest<AuthedRequest>();
  if (!req.userId) throw unauthorized();
  return req.userId;
});

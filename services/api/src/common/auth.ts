import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { unauthorized } from "./errors";
import { TokenService } from "../modules/auth/token.service";

export interface AuthedRequest extends Request {
  userId?: string;
}

/** Requires a valid access token. Every health route uses it. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TokenService) private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw unauthorized();
    const userId = await this.tokens.verifyAccessToken(header.slice(7));
    if (!userId) throw unauthorized();
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

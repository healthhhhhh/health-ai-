import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { ApiError } from "./errors";
import type { AuthedRequest } from "./auth";

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowMs: number;
}

const RATE_LIMIT_KEY = "healthmate:rate-limit";

/** Limits requests per user (or per hashed IP when signed out) for a route. */
export const RateLimit = (bucket: string, limit: number, windowMs: number) => SetMetadata(RATE_LIMIT_KEY, { bucket, limit, windowMs } satisfies RateLimitRule);

/**
 * Fixed-window limiter. In-memory is correct for a single instance; swap for a
 * Redis-backed store when running more than one API instance.
 */
@Injectable()
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  hit(key: string, rule: RateLimitRule, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const entry = this.windows.get(key);
    if (!entry || now - entry.start >= rule.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.prune(now, rule.windowMs);
      return { allowed: true, retryAfterMs: 0 };
    }
    entry.count += 1;
    return entry.count <= rule.limit ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: rule.windowMs - (now - entry.start) };
  }

  reset() {
    this.windows.clear();
  }

  private prune(now: number, windowMs: number) {
    for (const [key, entry] of this.windows) if (now - entry.start >= windowMs) this.windows.delete(key);
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!rule) return true;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const subject = req.userId ?? `ip:${createHash("sha256").update(req.ip ?? "unknown").digest("hex").slice(0, 16)}`;
    const { allowed, retryAfterMs } = this.limiter.hit(`${rule.bucket}:${subject}`, rule);
    if (!allowed) {
      context.switchToHttp().getResponse().setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      throw new ApiError("rate_limited", "Too many requests. Please wait a moment and try again.", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

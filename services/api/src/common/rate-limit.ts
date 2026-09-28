import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger, type OnApplicationShutdown, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Redis } from "ioredis";
import { createHash } from "node:crypto";
import { ApiError } from "./errors";
import type { AuthedRequest } from "./auth";

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowMs: number;
}

const RATE_LIMIT_KEY = "healthmate:rate-limit";

/** Applies to any guarded route without its own rule, so nothing is unlimited by omission. */
export const DEFAULT_RATE_LIMIT: RateLimitRule = { bucket: "default", limit: 300, windowMs: 60_000 };

/** Limits requests per user (or per hashed IP when signed out) for a route. */
export const RateLimit = (bucket: string, limit: number, windowMs: number) => SetMetadata(RATE_LIMIT_KEY, { bucket, limit, windowMs } satisfies RateLimitRule);

export type RateLimitResult = { allowed: boolean; retryAfterMs: number };

/** Where rate-limit counters live. */
export interface RateLimitStore {
  hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult>;
  reset(): Promise<void>;
  close?(): Promise<void>;
}

/** Fixed-window counters in memory: correct for a single API instance. */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, { start: number; count: number }>();

  async hit(key: string, rule: RateLimitRule, now: number): Promise<RateLimitResult> {
    const entry = this.windows.get(key);
    if (!entry || now - entry.start >= rule.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      if (this.windows.size > 50_000) this.prune(now, rule.windowMs);
      return { allowed: true, retryAfterMs: 0 };
    }
    entry.count += 1;
    return entry.count <= rule.limit ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: rule.windowMs - (now - entry.start) };
  }

  async reset() {
    this.windows.clear();
  }

  private prune(now: number, windowMs: number) {
    for (const [key, entry] of this.windows) if (now - entry.start >= windowMs) this.windows.delete(key);
  }
}

// INCR + set expiry on first hit, atomically. Returns [count, ttl ms].
const HIT_SCRIPT = `local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}`;

/** Shared counters in Redis, so limits hold across API instances. */
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "hm:rl:",
  ) {}

  async hit(key: string, rule: RateLimitRule): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.eval(HIT_SCRIPT, 1, this.prefix + key, rule.windowMs)) as [number, number];
    return count <= rule.limit ? { allowed: true, retryAfterMs: 0 } : { allowed: false, retryAfterMs: Math.max(ttl, 0) };
  }

  async reset() {
    let cursor = "0";
    do {
      const [next, keys] = await this.redis.scan(cursor, "MATCH", `${this.prefix}*`, "COUNT", "500");
      if (keys.length) await this.redis.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  }

  async close() {
    await this.redis.quit().catch(() => undefined);
  }
}

export const RATE_LIMIT_STORE = Symbol("RATE_LIMIT_STORE");

/**
 * Fixed-window limiter over a store. If the store is unreachable the request
 * is allowed (and logged): an outage of Redis must not lock people out of
 * their health data.
 */
@Injectable()
export class RateLimiter implements OnApplicationShutdown {
  private readonly logger = new Logger("RateLimiter");

  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore) {}

  async hit(key: string, rule: RateLimitRule, now = Date.now()): Promise<RateLimitResult> {
    try {
      return await this.store.hit(key, rule, now);
    } catch (error) {
      this.logger.error(`rate-limit store unavailable (${error instanceof Error ? error.name : "unknown"})`);
      return { allowed: true, retryAfterMs: 0 };
    }
  }

  reset() {
    return this.store.reset();
  }

  async onApplicationShutdown() {
    await this.store.close?.();
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]) ?? DEFAULT_RATE_LIMIT;
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const subject = req.userId ?? `ip:${createHash("sha256").update(req.ip ?? "unknown").digest("hex").slice(0, 16)}`;
    const { allowed, retryAfterMs } = await this.limiter.hit(`${rule.bucket}:${subject}`, rule);
    if (!allowed) {
      context.switchToHttp().getResponse().setHeader("Retry-After", Math.ceil(retryAfterMs / 1000).toString());
      throw new ApiError("rate_limited", "Too many requests. Please wait a moment and try again.", HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}

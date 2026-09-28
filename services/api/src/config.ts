import { randomBytes } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  /** PostgreSQL connection string. When absent (dev/test) an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  /** Directory for a persistent embedded dev database; in-memory when unset. */
  PGLITE_DIR: z.string().optional(),
  /** HMAC secret for access tokens and signed upload URLs (≥ 32 chars). Required in production. */
  JWT_SECRET: z.string().min(32).optional(),
  /** Server-side only. Never shipped to the iOS or web clients. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5"),
  /** Local directory for uploaded files (dev). Production should use object storage. */
  STORAGE_DIR: z.string().default(".data/uploads"),
  /** Public base URL used to build upload URLs for the local storage adapter. */
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().optional(),
});

export type AppConfig = z.infer<typeof schema> & { jwtSecret: string; aiEnabled: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${fields}`);
  }
  const cfg = parsed.data;
  if (cfg.NODE_ENV === "production") {
    if (!cfg.JWT_SECRET) throw new Error("JWT_SECRET is required in production");
    if (!cfg.DATABASE_URL) throw new Error("DATABASE_URL is required in production");
  }
  return {
    ...cfg,
    // Dev/test only: a random per-process secret (sessions reset on restart).
    jwtSecret: cfg.JWT_SECRET ?? randomBytes(48).toString("base64url"),
    aiEnabled: Boolean(cfg.ANTHROPIC_API_KEY),
  };
}

export const CONFIG = Symbol("CONFIG");

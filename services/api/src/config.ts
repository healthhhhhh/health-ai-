import { randomBytes } from "node:crypto";
import { z } from "zod";

const optionalUrl = z.string().url().optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  /** PostgreSQL connection string (Supabase: the pooler URL). When absent (dev/test) an embedded PGlite database is used. */
  DATABASE_URL: z.string().optional(),
  /** Supabase's CA certificate (PEM) to verify the database TLS connection. */
  DATABASE_CA_CERT: z.string().optional(),
  /** Apply migrations when the API starts. Production: run `npm run db:migrate` in the deploy step instead. */
  MIGRATE_ON_START: z.enum(["true", "false"]).optional(),
  /** Directory for a persistent embedded dev database; in-memory when unset. */
  PGLITE_DIR: z.string().optional(),

  /** Supabase project. The secret key is server-side only — never in iOS or web code. */
  SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  SUPABASE_SECRET_KEY: z.string().optional(),
  /** Only for projects still on the legacy shared JWT secret (new projects use signing keys via JWKS). */
  SUPABASE_JWT_SECRET: z.string().optional(),
  /** Where password-reset emails send people (web page that sets the new password). */
  PASSWORD_RESET_REDIRECT_URL: optionalUrl,

  /** local | supabase. Defaults to supabase when SUPABASE_URL is set. */
  AUTH_PROVIDER: z.enum(["local", "supabase"]).optional(),
  STORAGE_PROVIDER: z.enum(["local", "supabase"]).optional(),
  /** supabase (gte-small Edge Function) | hash (dev/test only) | none. */
  EMBEDDINGS_PROVIDER: z.enum(["supabase", "hash", "none"]).optional(),
  /** Shared secret between the API and the `embed` Edge Function. */
  EMBED_FUNCTION_SECRET: z.string().min(24).optional(),

  /** Redis for rate limits and background jobs (BullMQ). Without it both run in-process (single instance). */
  REDIS_URL: z.string().optional(),
  /** Run background jobs inside the API process too (development convenience when using Redis). */
  RUN_WORKER_IN_API: z.enum(["true", "false"]).optional(),

  /** HMAC secret for local access tokens and local signed file URLs (≥ 32 chars). */
  JWT_SECRET: z.string().min(32).optional(),
  /** Server-side only. Never shipped to the iOS or web clients. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5"),
  /** Error reporting. Events are scrubbed of health content before sending. */
  SENTRY_DSN: optionalUrl,

  /** Local directory for uploaded files (dev only). */
  STORAGE_DIR: z.string().default(".data/uploads"),
  /** Public base URL used to build signed URLs for the local storage adapter. */
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().optional(),
});

type Env = z.infer<typeof schema>;

export type AppConfig = Env & {
  jwtSecret: string;
  aiEnabled: boolean;
  authProvider: "local" | "supabase";
  storageProvider: "local" | "supabase";
  embeddingsProvider: "supabase" | "hash" | "none";
  migrateOnStart: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid configuration: ${fields}`);
  }
  const cfg = parsed.data;
  const production = cfg.NODE_ENV === "production";
  const hasSupabase = Boolean(cfg.SUPABASE_URL);
  const authProvider = cfg.AUTH_PROVIDER ?? (hasSupabase ? "supabase" : "local");
  const storageProvider = cfg.STORAGE_PROVIDER ?? (hasSupabase && cfg.SUPABASE_SECRET_KEY ? "supabase" : "local");
  const embeddingsProvider = cfg.EMBEDDINGS_PROVIDER ?? (hasSupabase && cfg.EMBED_FUNCTION_SECRET ? "supabase" : production ? "none" : "hash");

  const need = (condition: boolean, message: string) => {
    if (condition) throw new Error(message);
  };
  if (authProvider === "supabase") need(!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || !cfg.SUPABASE_SECRET_KEY, "Supabase Auth needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY");
  if (storageProvider === "supabase") need(!cfg.SUPABASE_URL || !cfg.SUPABASE_SECRET_KEY, "Supabase Storage needs SUPABASE_URL and SUPABASE_SECRET_KEY");
  if (embeddingsProvider === "supabase") need(!cfg.SUPABASE_URL || !cfg.SUPABASE_SECRET_KEY || !cfg.EMBED_FUNCTION_SECRET, "Supabase embeddings need SUPABASE_URL, SUPABASE_SECRET_KEY and EMBED_FUNCTION_SECRET");
  if (production) {
    need(!cfg.DATABASE_URL, "DATABASE_URL is required in production");
    need(storageProvider === "local", "Production must use Supabase Storage (STORAGE_PROVIDER=supabase)");
    need(embeddingsProvider === "hash", "The hash embeddings provider is for development only");
    need(authProvider === "local" && !cfg.JWT_SECRET, "JWT_SECRET is required for local auth in production");
  }
  return {
    ...cfg,
    // Dev/test only: a random per-process secret (local sessions reset on restart).
    jwtSecret: cfg.JWT_SECRET ?? randomBytes(48).toString("base64url"),
    aiEnabled: Boolean(cfg.ANTHROPIC_API_KEY),
    authProvider,
    storageProvider,
    embeddingsProvider,
    migrateOnStart: cfg.MIGRATE_ON_START ? cfg.MIGRATE_ON_START === "true" : !production,
  };
}

export const CONFIG = Symbol("CONFIG");

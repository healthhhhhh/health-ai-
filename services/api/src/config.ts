import { randomBytes } from "node:crypto";
import { z } from "zod";
import { parsePrices, type ModelPrice } from "./modules/ai/ai.pricing";
import { AGE_BANDS, AGE_ENFORCEMENT_MODES, type AgeBand, type AgeEnforcement } from "./modules/account/age";
import { parseRoutes, type AiProviderName, type AiRoutes } from "./modules/ai/ai.routing";

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

  /**
   * Google sign-in: the OAuth client IDs (iOS and/or web) whose ID tokens are
   * accepted, comma-separated. Public identifiers, free to create in Google
   * Cloud. Unset: Google sign-in answers "not available".
   */
  GOOGLE_CLIENT_IDS: z.string().optional(),

  /** log | apns | none. Default: log outside production (nothing is sent), none in production. */
  PUSH_PROVIDER: z.enum(["log", "apns", "none"]).optional(),
  /** 32-byte key (base64) that encrypts stored device tokens. Dev/test: a random per-process key when unset. */
  PUSH_TOKEN_KEY: z.string().optional(),
  /** APNs token auth (.p8 key). Only read when PUSH_PROVIDER=apns — needs the paid Apple Developer Program. */
  APNS_KEY_ID: z.string().optional(),
  APNS_TEAM_ID: z.string().optional(),
  APNS_BUNDLE_ID: z.string().optional(),
  /** The .p8 file's contents (PEM); "\n" escapes are accepted. */
  APNS_PRIVATE_KEY: z.string().optional(),

  /** HMAC secret for local access tokens and local signed file URLs (≥ 32 chars). */
  JWT_SECRET: z.string().min(32).optional(),
  /** Server-side only. Never shipped to the iOS or web clients. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  /**
   * anthropic | development | none. Defaults to anthropic when ANTHROPIC_API_KEY
   * is set, otherwise none (the assistant says it's unavailable). "development"
   * is an offline, scripted provider that needs no key and costs nothing; it is
   * refused in production.
   */
  AI_PROVIDER: z.enum(["anthropic", "development", "none"]).optional(),
  /** Per-task routing: `task=provider[:model][@effort]`, comma-separated (see ai.routing.ts). */
  AI_ROUTES: z.string().optional(),
  /** Price overrides, USD per million tokens: `model=input/output[/cacheRead/cacheWrite]`. */
  AI_PRICES: z.string().optional(),
  /** Internal monthly AI cost limit per person (USD). 0 turns it off. Never shown to people. */
  AI_MONTHLY_USER_BUDGET_USD: z.coerce.number().min(0).default(5),
  /**
   * Extra monthly headroom (USD) for safety-critical (urgent-symptom) AI answers above the
   * limit. Past it, urgent messages get the deterministic urgent guidance without a model
   * call. Emergencies never use a model at all.
   */
  AI_SAFETY_CRITICAL_ALLOWANCE_USD: z.coerce.number().min(0).default(5),
  /** Longest wait for one AI provider call (ms). A timed-out call is charged its reserved worst case. */
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(240_000),
  /**
   * `enforce`: only accounts whose age band is enabled may use health features; an
   * unknown age must be given first (POST /v1/me/age) and under-13 accounts are
   * restricted and deleted after UNDER_13_DELETION_HOURS. `record`: assessments are
   * recorded and nothing is restricted. `off`: nothing is recorded. Production
   * accepts only `enforce` (its default).
   */
  AGE_ENFORCEMENT: z.enum(AGE_ENFORCEMENT_MODES).optional(),
  /** Age bands served (comma-separated). The US launch: 13_15,16_17,adult. under_13 can't be enabled. */
  ENABLED_AGE_BANDS: z.string().default("13_15,16_17,adult"),
  /**
   * How long an account found to belong to someone under 13 is kept (restricted
   * and unprocessed) before deletion, so a mistyped date can be raised with support.
   * Placeholder pending legal review.
   */
  UNDER_13_DELETION_HOURS: z.coerce.number().int().min(0).max(24 * 30).default(72),
  /** Error reporting. Events are scrubbed of health content before sending. */
  SENTRY_DSN: optionalUrl,

  /** Local directory for uploaded files (dev only). */
  STORAGE_DIR: z.string().default(".data/uploads"),
  /** Public base URL used to build signed URLs for the local storage adapter. */
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:4000"),
  CORS_ORIGINS: z.string().optional(),

  /**
   * Retention of operational records (no health content), in days; 0 keeps
   * them forever. Health data never expires automatically — people delete it
   * themselves (docs/health-memory-architecture.md §6).
   */
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().min(0).default(400),
  AI_USAGE_RETENTION_DAYS: z.coerce.number().int().min(0).default(400),
  SAFETY_EVENT_RETENTION_DAYS: z.coerce.number().int().min(0).default(730),
});

type Env = z.infer<typeof schema>;

export type AppConfig = Omit<Env, "AGE_ENFORCEMENT"> & {
  /** Resolved: `enforce` by default in production, `record` elsewhere. */
  AGE_ENFORCEMENT: AgeEnforcement;
  jwtSecret: string;
  aiEnabled: boolean;
  aiProvider: "anthropic" | "development" | "none";
  /** Every provider some task can use (the default first). */
  aiProvidersInUse: AiProviderName[];
  aiRoutes: AiRoutes;
  aiPrices: Record<string, ModelPrice>;
  googleClientIds: string[];
  pushProvider: "log" | "apns" | "none";
  /** 32 bytes, or null when device tokens can't be stored (production without PUSH_TOKEN_KEY). */
  pushTokenKey: Buffer | null;
  authProvider: "local" | "supabase";
  storageProvider: "local" | "supabase";
  embeddingsProvider: "supabase" | "hash" | "none";
  migrateOnStart: boolean;
  enabledAgeBands: AgeBand[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // `KEY=` in an env file means "not set" (Node's --env-file sets it to "").
  const present = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""));
  const parsed = schema.safeParse(present);
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

  const aiProvider = cfg.AI_PROVIDER ?? (cfg.ANTHROPIC_API_KEY ? "anthropic" : "none");

  const need = (condition: boolean, message: string) => {
    if (condition) throw new Error(message);
  };
  const parsedAi = (() => {
    try {
      return { ...parseRoutes(cfg.AI_ROUTES), prices: parsePrices(cfg.AI_PRICES) };
    } catch (error) {
      throw new Error(`Invalid configuration: ${error instanceof Error ? error.message : "AI_ROUTES/AI_PRICES"}`);
    }
  })();
  const aiProvidersInUse = [...new Set<AiProviderName>([aiProvider, ...parsedAi.providers])];
  need(aiProvidersInUse.includes("anthropic") && !cfg.ANTHROPIC_API_KEY, "AI_PROVIDER=anthropic (or an AI_ROUTES entry using it) needs ANTHROPIC_API_KEY");

  const googleClientIds = (cfg.GOOGLE_CLIENT_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  const pushProvider = cfg.PUSH_PROVIDER ?? (production ? "none" : "log");
  const pushTokenKey = cfg.PUSH_TOKEN_KEY ? Buffer.from(cfg.PUSH_TOKEN_KEY, "base64") : production ? null : randomBytes(32);
  need(pushTokenKey !== null && pushTokenKey.length !== 32, "PUSH_TOKEN_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  if (pushProvider === "apns") {
    need(!cfg.APNS_KEY_ID || !cfg.APNS_TEAM_ID || !cfg.APNS_BUNDLE_ID || !cfg.APNS_PRIVATE_KEY, "PUSH_PROVIDER=apns needs APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID and APNS_PRIVATE_KEY");
    need(!cfg.PUSH_TOKEN_KEY, "PUSH_PROVIDER=apns needs PUSH_TOKEN_KEY");
  }
  if (authProvider === "supabase") need(!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || !cfg.SUPABASE_SECRET_KEY, "Supabase Auth needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY");
  if (storageProvider === "supabase") need(!cfg.SUPABASE_URL || !cfg.SUPABASE_SECRET_KEY, "Supabase Storage needs SUPABASE_URL and SUPABASE_SECRET_KEY");
  if (embeddingsProvider === "supabase") need(!cfg.SUPABASE_URL || !cfg.SUPABASE_SECRET_KEY || !cfg.EMBED_FUNCTION_SECRET, "Supabase embeddings need SUPABASE_URL, SUPABASE_SECRET_KEY and EMBED_FUNCTION_SECRET");
  const ageEnforcement = cfg.AGE_ENFORCEMENT ?? (production ? "enforce" : "record");
  const enabledAgeBands = [...new Set(cfg.ENABLED_AGE_BANDS.split(",").map((b) => b.trim()).filter(Boolean))];
  need(enabledAgeBands.some((b) => !(AGE_BANDS as readonly string[]).includes(b)), `ENABLED_AGE_BANDS: unknown band (bands: ${AGE_BANDS.join(", ")})`);
  need(enabledAgeBands.length === 0, "ENABLED_AGE_BANDS needs at least one band");
  // Fail closed: serving under-13s needs verifiable parental consent, which doesn't exist.
  need(enabledAgeBands.includes("under_13"), "ENABLED_AGE_BANDS can't include under_13: parental consent isn't implemented");
  if (production) {
    need(ageEnforcement !== "enforce", "Production requires AGE_ENFORCEMENT=enforce");
    need(!cfg.DATABASE_URL, "DATABASE_URL is required in production");
    need(storageProvider === "local", "Production must use Supabase Storage (STORAGE_PROVIDER=supabase)");
    need(embeddingsProvider === "hash", "The hash embeddings provider is for development only");
    need(authProvider === "local" && !cfg.JWT_SECRET, "JWT_SECRET is required for local auth in production");
    need(aiProvidersInUse.includes("development"), "The development AI provider is for development only");
  }
  return {
    ...cfg,
    AGE_ENFORCEMENT: ageEnforcement,
    // Dev/test only: a random per-process secret (local sessions reset on restart).
    jwtSecret: cfg.JWT_SECRET ?? randomBytes(48).toString("base64url"),
    aiEnabled: aiProvider !== "none",
    aiProvider,
    aiProvidersInUse,
    aiRoutes: parsedAi.routes,
    aiPrices: parsedAi.prices,
    googleClientIds,
    pushProvider,
    pushTokenKey,
    authProvider,
    storageProvider,
    embeddingsProvider,
    migrateOnStart: cfg.MIGRATE_ON_START ? cfg.MIGRATE_ON_START === "true" : !production,
    enabledAgeBands: enabledAgeBands as AgeBand[],
  };
}

export const CONFIG = Symbol("CONFIG");

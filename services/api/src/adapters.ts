import { MemoryRateLimitStore, RedisRateLimitStore, type RateLimitStore } from "./common/rate-limit";
import type { AppConfig } from "./config";
import { InProcessJobQueue, type JobQueue } from "./modules/documents/job-queue";
import { AnthropicProvider, UnavailableProvider } from "./modules/ai/anthropic.provider";
import { BedrockProvider } from "./modules/ai/bedrock.provider";
import type { AiProvider } from "./modules/ai/ai.types";
import { DevelopmentAiProvider } from "./modules/ai/development.provider";
import { registryOf, type AiProviderRegistry } from "./modules/ai/ai.gateway";
import type { AiProviderName } from "./modules/ai/ai.routing";
import { LocalObjectStorage, SupabaseObjectStorage, type ObjectStorage } from "./modules/documents/storage";
import { HashEmbeddingProvider, NoEmbeddingProvider, SupabaseEmbeddingProvider, type EmbeddingProvider } from "./modules/memory/embeddings";

/**
 * Picks each infrastructure adapter from configuration so the same business
 * logic runs on PGlite/local disk in development and Supabase in production.
 */
export function storageFor(config: AppConfig): ObjectStorage {
  return config.storageProvider === "supabase"
    ? new SupabaseObjectStorage(config.SUPABASE_URL!, config.SUPABASE_SECRET_KEY!)
    : new LocalObjectStorage(config.STORAGE_DIR, config.PUBLIC_BASE_URL, config.jwtSecret);
}

export function embeddingsFor(config: AppConfig): EmbeddingProvider {
  switch (config.embeddingsProvider) {
    case "supabase":
      return new SupabaseEmbeddingProvider(config.SUPABASE_URL!, config.SUPABASE_SECRET_KEY!, config.EMBED_FUNCTION_SECRET!);
    case "hash":
      return new HashEmbeddingProvider();
    default:
      return new NoEmbeddingProvider();
  }
}

function buildProvider(config: AppConfig, name: AiProviderName): AiProvider {
  switch (name) {
    case "anthropic":
      return new AnthropicProvider(config.ANTHROPIC_API_KEY!, config.AI_MODEL);
    case "development":
      return new DevelopmentAiProvider();
    case "bedrock":
      return new BedrockProvider({ apiKey: config.AWS_BEARER_TOKEN_BEDROCK!, region: config.AWS_REGION!, modelId: config.BEDROCK_MODEL_ID! });
    default:
      return new UnavailableProvider();
  }
}

/** The default provider: the real model when configured; offline scripted answers for development; otherwise an honest "unavailable". */
export function aiProviderFor(config: AppConfig): AiProvider {
  return buildProvider(config, config.aiProvider);
}

/** Every provider a task can be routed to (`AI_PROVIDER` first, then those named in `AI_ROUTES`). */
export function aiProvidersFor(config: AppConfig): AiProviderRegistry {
  const [first, ...rest] = config.aiProvidersInUse.map((name) => buildProvider(config, name));
  return registryOf(first!, rest);
}

/** Redis (BullMQ) when REDIS_URL is set; otherwise jobs run in this process. */
export async function jobQueueFor(config: AppConfig): Promise<JobQueue> {
  if (!config.REDIS_URL) return new InProcessJobQueue();
  const { BullJobQueue } = await import("./modules/documents/bull-queue");
  return new BullJobQueue(config.REDIS_URL, { runWorker: config.RUN_WORKER_IN_API === "true" });
}

/** Shared Redis counters when REDIS_URL is set, so limits hold across instances. */
export async function rateLimitStoreFor(config: AppConfig): Promise<RateLimitStore> {
  if (!config.REDIS_URL) return new MemoryRateLimitStore();
  const { Redis } = await import("ioredis");
  return new RedisRateLimitStore(new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableOfflineQueue: false }));
}

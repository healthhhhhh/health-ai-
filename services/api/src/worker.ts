import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { aiProvidersFor, rateLimitStoreFor, storageFor } from "./adapters";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";
import { createDatabase } from "./db/database";
import { startMaintenance } from "./maintenance";
import { BullJobQueue } from "./modules/documents/bull-queue";

/**
 * Background worker (`npm run worker`): processes reports and photos,
 * computes memory embeddings and deletes files, from the Redis queue. Scale
 * it separately from the API. Serves no HTTP traffic.
 */
async function main() {
  const config = loadConfig();
  if (!config.REDIS_URL) throw new Error("The worker needs REDIS_URL (without Redis, jobs run inside the API).");
  const logger = new Logger("Worker");
  const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, caCert: config.DATABASE_CA_CERT });
  const jobQueue = new BullJobQueue(config.REDIS_URL, { runWorker: true });
  const aiProviders = aiProvidersFor(config);
  const app = await createApp({ config, database, aiProvider: aiProviders.default, aiProviders, storage: storageFor(config), jobQueue, rateLimitStore: await rateLimitStoreFor(config) });
  startMaintenance(app);
  logger.log(`HealthMate worker running (storage: ${config.storageProvider}, embeddings: ${config.embeddingsProvider})`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";
import { createDatabase, migrate } from "./db/database";
import { startMaintenance } from "./maintenance";
import { aiProvidersFor, jobQueueFor, rateLimitStoreFor, storageFor } from "./adapters";

async function main() {
  const config = loadConfig();
  const logger = new Logger("Main");
  const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, caCert: config.DATABASE_CA_CERT });
  if (config.migrateOnStart) {
    const applied = await migrate(database);
    if (applied.length) logger.log(`applied migrations: ${applied.join(", ")}`);
  }
  const aiProviders = aiProvidersFor(config);
  const aiProvider = aiProviders.default;
  const app = await createApp({
    config, database, aiProvider, aiProviders, storage: storageFor(config), jobQueue: await jobQueueFor(config),
    rateLimitStore: await rateLimitStoreFor(config),
  });
  // With Redis, a separate worker (`npm run worker`) runs jobs and housekeeping.
  if (!config.REDIS_URL || config.RUN_WORKER_IN_API === "true") startMaintenance(app);
  await app.listen(config.PORT);
  logger.log(
    `HealthMate API listening on :${config.PORT} (database: ${config.DATABASE_URL ? "postgres" : "embedded"}, auth: ${config.authProvider}, storage: ${config.storageProvider}, ` +
      `embeddings: ${config.embeddingsProvider}, jobs: ${config.REDIS_URL ? "redis" : "in-process"}, ai: ${[...aiProviders.byName.keys()].join("+")}, push: ${config.pushProvider})`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";
import { createDatabase, migrate } from "./db/database";
import { aiProviderFor, jobQueueFor, rateLimitStoreFor, storageFor } from "./adapters";

async function main() {
  const config = loadConfig();
  const logger = new Logger("Main");
  const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, caCert: config.DATABASE_CA_CERT });
  if (config.migrateOnStart) {
    const applied = await migrate(database);
    if (applied.length) logger.log(`applied migrations: ${applied.join(", ")}`);
  }
  const aiProvider = aiProviderFor(config);
  const app = await createApp({
    config, database, aiProvider, storage: storageFor(config), jobQueue: await jobQueueFor(config),
    rateLimitStore: await rateLimitStoreFor(config),
  });
  await app.listen(config.PORT);
  logger.log(
    `HealthMate API listening on :${config.PORT} (database: ${config.DATABASE_URL ? "postgres" : "embedded"}, auth: ${config.authProvider}, storage: ${config.storageProvider}, ` +
      `embeddings: ${config.embeddingsProvider}, jobs: ${config.REDIS_URL ? "redis" : "in-process"}, ai: ${aiProvider.name})`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

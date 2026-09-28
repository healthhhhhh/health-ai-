import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";
import { createDatabase, migrate } from "./db/database";
import { AnthropicProvider, UnavailableProvider } from "./modules/ai/anthropic.provider";
import { LocalObjectStorage } from "./modules/documents/storage";

async function main() {
  const config = loadConfig();
  const logger = new Logger("Main");
  const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
  const applied = await migrate(database);
  if (applied.length) logger.log(`applied migrations: ${applied.join(", ")}`);
  const aiProvider = config.ANTHROPIC_API_KEY ? new AnthropicProvider(config.ANTHROPIC_API_KEY, config.AI_MODEL) : new UnavailableProvider();
  const storage = new LocalObjectStorage(config.STORAGE_DIR, config.PUBLIC_BASE_URL, config.jwtSecret);
  const app = await createApp({ config, database, aiProvider, storage });
  await app.listen(config.PORT);
  logger.log(`HealthMate API listening on :${config.PORT} (database: ${config.DATABASE_URL ? "postgres" : "embedded"}, ai: ${aiProvider.name})`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

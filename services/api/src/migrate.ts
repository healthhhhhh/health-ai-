import { loadConfig } from "./config";
import { createDatabase, migrate } from "./db/database";

/** `npm run db:migrate`: applies pending migrations (run in the deploy step, before starting the API). */
async function main() {
  const config = loadConfig();
  const db = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, caCert: config.DATABASE_CA_CERT });
  try {
    const applied = await migrate(db);
    // eslint-disable-next-line no-console
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "database is up to date");
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

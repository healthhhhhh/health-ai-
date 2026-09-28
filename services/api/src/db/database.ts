import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool, types } from "pg";

// Return DATE columns as "YYYY-MM-DD" strings instead of local-midnight Dates.
types.setTypeParser(1082, (value: string) => value);

export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Minimal database interface: parameterised SQL only (no string-built
 * queries), transactions, and scripts for migrations. Backed by PostgreSQL in
 * production and by embedded PGlite in development and tests.
 */
export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  exec(script: string): Promise<void>;
  close(): Promise<void>;
}

class PgDatabase implements Database {
  constructor(private readonly pool: Pool) {}

  async query<T>(text: string, params: unknown[] = []) {
    const result = await this.pool.query(text, params as unknown[]);
    return { rows: result.rows as T[] };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx: Queryable = {
        query: async <R>(text: string, params: unknown[] = []) => ({ rows: (await client.query(text, params as unknown[])).rows as R[] }),
      };
      const result = await fn(tx);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async exec(script: string) {
    await this.pool.query(script);
  }

  async close() {
    await this.pool.end();
  }
}

class PgliteDatabase implements Database {
  constructor(private readonly db: PGlite) {}

  async query<T>(text: string, params: unknown[] = []) {
    const result = await this.db.query<T>(text, params as unknown[]);
    return { rows: result.rows };
  }

  async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.db.transaction(async (inner) =>
      fn({ query: async <R>(text: string, params: unknown[] = []) => ({ rows: (await inner.query<R>(text, params as unknown[])).rows }) }),
    );
  }

  async exec(script: string) {
    await this.db.exec(script);
  }

  async close() {
    await this.db.close();
  }
}

export async function createDatabase(options: { url?: string; pgliteDir?: string }): Promise<Database> {
  if (options.url) {
    return new PgDatabase(new Pool({ connectionString: options.url, max: 10 }));
  }
  const db = new PGlite(options.pgliteDir);
  await db.waitReady;
  return new PgliteDatabase(db);
}

/** Applies migrations/*.sql in order, once each, inside a transaction per file. */
export async function migrate(db: Database, directory = join(__dirname, "..", "..", "migrations")): Promise<string[]> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const files = readdirSync(directory).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(directory, file), "utf8");
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`);
    ran.push(file);
  }
  return ran;
}

export const DATABASE = Symbol("DATABASE");

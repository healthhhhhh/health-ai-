import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
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

export async function createDatabase(options: { url?: string; pgliteDir?: string; caCert?: string; poolSize?: number }): Promise<Database> {
  if (options.url) {
    // Supabase: use the pooler URL; pass its CA certificate to verify TLS.
    const ssl = options.caCert ? { ca: options.caCert, rejectUnauthorized: true } : undefined;
    return new PgDatabase(new Pool({ connectionString: options.url, max: options.poolSize ?? 10, ...(ssl ? { ssl } : {}) }));
  }
  const db = await PGlite.create({ dataDir: options.pgliteDir, extensions: { vector } });
  return new PgliteDatabase(db);
}

const SQL_DIR = join(__dirname, "..", "..", "sql");

/** "0004_complete_schema.sql" ⇄ Supabase CLI version "20260901000004" + name "complete_schema". */
export function supabaseVersion(file: string): { version: string; name: string } | null {
  const match = /^(\d{4})_(.+)\.sql$/.exec(file);
  return match ? { version: `2026090100${match[1]}`, name: match[2]! } : null;
}

/**
 * Applies migrations/*.sql in order, once each, inside a transaction per file.
 * On plain PostgreSQL/PGlite it first installs local stand-ins for Supabase's
 * `auth` and `storage` schemas. Migrations already applied by the Supabase CLI
 * (`supabase db push` / `supabase start`) are recognised and skipped.
 */
export async function migrate(db: Database, directory = join(__dirname, "..", "..", "migrations")): Promise<string[]> {
  const isSupabase = (await db.query<{ ok: boolean }>("SELECT to_regnamespace('auth') IS NOT NULL AS ok")).rows[0]?.ok;
  if (!isSupabase) await db.exec(readFileSync(join(SQL_DIR, "supabase-compat.sql"), "utf8"));
  await db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  const cli = (await db.query<{ ok: boolean }>("SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ok")).rows[0]?.ok;
  const cliVersions = cli ? new Set((await db.query<{ version: string }>("SELECT version FROM supabase_migrations.schema_migrations")).rows.map((r) => r.version)) : new Set<string>();
  const files = readdirSync(directory).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const quoted = file.replace(/'/g, "''");
    if (cliVersions.has(supabaseVersion(file)?.version ?? "")) {
      await db.query(`INSERT INTO schema_migrations (name) VALUES ('${quoted}') ON CONFLICT DO NOTHING`);
      continue;
    }
    const sql = readFileSync(join(directory, file), "utf8");
    await db.exec(`BEGIN;\n${sql}\nINSERT INTO schema_migrations (name) VALUES ('${quoted}');\nCOMMIT;`);
    ran.push(file);
  }
  return ran;
}

export const DATABASE = Symbol("DATABASE");

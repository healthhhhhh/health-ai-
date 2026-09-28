import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate, type Database, type Queryable } from "../src/db/database";

/**
 * Row Level Security and Storage policies, exercised exactly as Supabase's
 * Data API would: as the `authenticated` role with the user's JWT claims.
 * (The API itself connects as a privileged role and filters by user; RLS is
 * the independent second line of defence.)
 */
let db: Database;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createDatabase({});
  await migrate(db);
  alice = await authUser("alice@example.com", "Alice");
  bob = await authUser("bob@example.com", "Bob");
});
afterAll(async () => {
  await db.close();
});

/** Signs up through Supabase Auth: the auth.users trigger creates the HealthMate rows. */
async function authUser(email: string, firstName: string) {
  const id = randomUUID();
  await db.query(`INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, $2, $3::jsonb)`, [id, email, JSON.stringify({ first_name: firstName, time_zone: "Europe/London" })]);
  return id;
}

/** Runs `fn` as a signed-in user (or anon) through RLS. */
async function as<T>(userId: string | null, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`SET LOCAL ROLE ${userId ? "authenticated" : "anon"}`);
    await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(userId ? { sub: userId, role: "authenticated" } : { role: "anon" })]);
    return fn(tx);
  });
}

const count = async (q: Queryable, sql: string, params: unknown[] = []) => (await q.query(sql, params)).rows.length;

describe("Supabase Auth linkage", () => {
  it("creates the user and profile from auth.users, and deletes everything with it", async () => {
    const { rows } = await db.query<{ email: string; auth_provider: string; first_name: string; time_zone: string }>(
      `SELECT u.email, u.auth_provider, p.first_name, p.time_zone FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [alice],
    );
    expect(rows[0]).toEqual({ email: "alice@example.com", auth_provider: "supabase", first_name: "Alice", time_zone: "Europe/London" });

    const temp = await authUser("temp@example.com", "Temp");
    await db.query(`INSERT INTO health_conditions (user_id, name, source) VALUES ($1, 'Asthma', 'user_reported')`, [temp]);
    await db.query(`DELETE FROM auth.users WHERE id = $1`, [temp]);
    expect(await count(db, `SELECT 1 FROM users WHERE id = $1`, [temp])).toBe(0);
    expect(await count(db, `SELECT 1 FROM health_conditions WHERE user_id = $1`, [temp])).toBe(0);
  });
});

describe("row level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const { rows } = await db.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("stops one person reading, changing or deleting another's records", async () => {
    const { id } = await as(alice, async (q) => (await q.query<{ id: string }>(`INSERT INTO health_conditions (user_id, name, source) VALUES ($1, 'Migraine', 'user_reported') RETURNING id`, [alice])).rows[0]!);
    await as(alice, async (q) => {
      expect(await count(q, `SELECT 1 FROM health_conditions WHERE id = $1`, [id])).toBe(1);
    });
    await as(bob, async (q) => {
      expect(await count(q, `SELECT 1 FROM health_conditions WHERE id = $1`, [id])).toBe(0);
      expect(await count(q, `SELECT 1 FROM profiles WHERE user_id = $1`, [alice])).toBe(0);
      expect(await count(q, `SELECT 1 FROM users WHERE id = $1`, [alice])).toBe(0);
      expect(await count(q, `UPDATE health_conditions SET name = 'changed' WHERE id = $1 RETURNING id`, [id])).toBe(0);
      expect(await count(q, `DELETE FROM health_conditions WHERE id = $1 RETURNING id`, [id])).toBe(0);
    });
    // Nor create records in someone else's name.
    await expect(as(bob, (q) => q.query(`INSERT INTO health_conditions (user_id, name, source) VALUES ($1, 'Planted', 'user_reported')`, [alice]))).rejects.toThrow(/row-level security/);
    // Nor move one of their own records onto someone else.
    const bobs = await as(bob, async (q) => (await q.query<{ id: string }>(`INSERT INTO allergies (user_id, substance, source) VALUES ($1, 'Peanuts', 'user_reported') RETURNING id`, [bob])).rows[0]!.id);
    await expect(as(bob, (q) => q.query(`UPDATE allergies SET user_id = $1 WHERE id = $2`, [alice, bobs]))).rejects.toThrow(/row-level security/);
    expect((await db.query<{ name: string }>(`SELECT name FROM health_conditions WHERE id = $1`, [id])).rows[0]!.name).toBe("Migraine");
  });

  it("applies to every per-user table, including derived and server-written ones", async () => {
    const convo = (await db.query<{ id: string }>(`INSERT INTO conversations (user_id, title) VALUES ($1, 'Chat') RETURNING id`, [alice])).rows[0]!.id;
    await db.query(`INSERT INTO messages (conversation_id, user_id, role, content) VALUES ($1, $2, 'user', 'hello')`, [convo, alice]);
    const doc = (
      await db.query<{ id: string }>(
        `INSERT INTO medical_documents (user_id, filename, content_type, byte_size, storage_path) VALUES ($1, 'labs.pdf', 'application/pdf', 100, $2) RETURNING id`,
        [alice, `${alice}/${randomUUID()}`],
      )
    ).rows[0]!.id;
    await db.query(`INSERT INTO symptoms (user_id, name) VALUES ($1, 'Cough')`, [alice]);
    await db.query(`INSERT INTO health_measurements (user_id, kind, value, unit, recorded_at, source) VALUES ($1, 'steps', 100, 'count', now(), 'apple_health')`, [alice]);
    await db.query(`INSERT INTO mood_checkins (user_id, mood) VALUES ($1, 'good')`, [alice]);
    for (const table of ["conversations", "messages", "medical_documents", "symptoms", "health_measurements", "mood_checkins", "healthkit_measurements"]) {
      await as(alice, async (q) => expect(await count(q, `SELECT 1 FROM ${table}`), `${table} (owner)`).toBeGreaterThan(0));
      await as(bob, async (q) => expect(await count(q, `SELECT 1 FROM ${table}`), `${table} (other)`).toBe(0));
    }
    // Derived records are written by the server only.
    await expect(as(alice, (q) => q.query(`UPDATE medical_documents SET status = 'ready' WHERE id = $1`, [doc]))).resolves.toBeDefined();
    expect((await db.query<{ status: string }>(`SELECT status FROM medical_documents WHERE id = $1`, [doc])).rows[0]!.status).toBe("awaiting_upload");
  });

  it("hides server-only tables from signed-in people and everything from anonymous callers", async () => {
    await db.query(`INSERT INTO audit_logs (user_id, action) VALUES ($1, 'auth.login')`, [alice]);
    await as(alice, async (q) => {
      expect(await count(q, `SELECT 1 FROM audit_logs`)).toBe(0);
      expect(await count(q, `SELECT 1 FROM refresh_tokens`)).toBe(0);
    });
    await expect(as(null, (q) => q.query(`SELECT 1 FROM health_conditions`))).rejects.toThrow(/permission denied/);
    await expect(as(null, (q) => q.query(`SELECT 1 FROM users`))).rejects.toThrow(/permission denied/);
  });
});

describe("health memory provenance", () => {
  it("lets people add reported facts but never AI inferences", async () => {
    await as(alice, (q) => q.query(`INSERT INTO health_memories (user_id, fact, source, status) VALUES ($1, 'Allergic to penicillin', 'user', 'user_reported')`, [alice]));
    await expect(as(alice, (q) => q.query(`INSERT INTO health_memories (user_id, fact, source, status) VALUES ($1, 'Probably diabetic', 'ai', 'ai_inferred')`, [alice]))).rejects.toThrow(/row-level security/);
    await expect(
      as(alice, (q) => q.query(`INSERT INTO health_memories (user_id, fact, source, status) VALUES ($1, 'Confirmed without a date', 'user', 'user_confirmed')`, [alice])),
    ).rejects.toThrow(/check constraint/);
  });

  it("confirms an AI inference only by an explicit confirmation", async () => {
    const id = (
      await db.query<{ id: string }>(`INSERT INTO health_memories (user_id, fact, source, status, confidence) VALUES ($1, 'Gets headaches after screens', 'ai', 'ai_inferred', 0.6) RETURNING id`, [alice])
    ).rows[0]!.id;
    // Even the server can't promote it without recording the confirmation.
    await expect(db.query(`UPDATE health_memories SET status = 'user_confirmed' WHERE id = $1`, [id])).rejects.toThrow();
    // Someone else can't confirm it at all.
    await as(bob, async (q) => expect(await count(q, `UPDATE health_memories SET status = 'user_confirmed', confirmed_at = now() WHERE id = $1 RETURNING id`, [id])).toBe(0));
    // The person can.
    await as(alice, async (q) => expect(await count(q, `UPDATE health_memories SET status = 'user_confirmed', confirmed_at = now() WHERE id = $1 RETURNING id`, [id])).toBe(1));
    expect((await db.query<{ status: string }>(`SELECT status FROM health_memories WHERE id = $1`, [id])).rows[0]!.status).toBe("user_confirmed");
  });

  it("clears the embedding when a fact is edited", async () => {
    const vector = `[${new Array(384).fill(0).map((_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
    const id = (
      await db.query<{ id: string }>(
        `INSERT INTO health_memories (user_id, fact, source, status, embedding, embedding_model, embedded_at) VALUES ($1, 'Walks daily', 'user', 'user_reported', $2::vector, 'test', now()) RETURNING id`,
        [alice, vector],
      )
    ).rows[0]!.id;
    await db.query(`UPDATE health_memories SET fact = 'Walks most days' WHERE id = $1`, [id]);
    expect((await db.query<{ embedding: unknown }>(`SELECT embedding FROM health_memories WHERE id = $1`, [id])).rows[0]!.embedding).toBeNull();
  });
});

describe("timeline policies", () => {
  it("lets people add and remove only their own entries", async () => {
    await as(alice, (q) => q.query(`INSERT INTO timeline_events (user_id, event_type, title, occurred_at, source_type) VALUES ($1, 'note', 'Felt better', now(), 'user_entered')`, [alice]));
    await expect(
      as(alice, (q) => q.query(`INSERT INTO timeline_events (user_id, event_type, title, occurred_at, source_type) VALUES ($1, 'report', 'Fake lab report', now(), 'document')`, [alice])),
    ).rejects.toThrow(/row-level security/);
    const docEvent = (await db.query<{ id: string }>(`INSERT INTO timeline_events (user_id, event_type, title, occurred_at, source_type) VALUES ($1, 'report', 'Labs', now(), 'document') RETURNING id`, [alice])).rows[0]!.id;
    await as(alice, async (q) => expect(await count(q, `DELETE FROM timeline_events WHERE id = $1 RETURNING id`, [docEvent])).toBe(0));
  });
});

describe("storage policies", () => {
  it("keeps medical buckets private and each person's folder their own", async () => {
    const { rows } = await db.query<{ id: string; public: boolean }>(`SELECT id, public FROM storage.buckets ORDER BY id`);
    expect(rows).toEqual([
      { id: "avatars", public: false },
      { id: "health-images", public: false },
      { id: "medical-reports", public: false },
    ]);
    // Uploaded by the server through signed URLs.
    await db.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('medical-reports', $1), ('health-images', $2)`, [`${alice}/${randomUUID()}`, `${alice}/${randomUUID()}`]);
    await as(alice, async (q) => expect(await count(q, `SELECT 1 FROM storage.objects WHERE bucket_id IN ('medical-reports', 'health-images')`)).toBe(2));
    await as(bob, async (q) => {
      expect(await count(q, `SELECT 1 FROM storage.objects WHERE name LIKE $1`, [`${alice}/%`])).toBe(0);
      expect(await count(q, `DELETE FROM storage.objects WHERE name LIKE $1 RETURNING id`, [`${alice}/%`])).toBe(0);
      expect(await count(q, `UPDATE storage.objects SET name = $2 WHERE name LIKE $1 RETURNING id`, [`${alice}/%`, `${bob}/stolen`])).toBe(0);
    });
    // People can't write medical files directly (only via the API's signed URLs)…
    await expect(as(alice, (q) => q.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('medical-reports', $1)`, [`${alice}/direct.pdf`]))).rejects.toThrow(/row-level security/);
    // …and can manage only their own avatar.
    await as(alice, (q) => q.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)`, [`${alice}/me.png`]));
    await expect(as(bob, (q) => q.query(`INSERT INTO storage.objects (bucket_id, name) VALUES ('avatars', $1)`, [`${alice}/evil.png`]))).rejects.toThrow(/row-level security/);
    await as(bob, async (q) => expect(await count(q, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [`${alice}/me.png`])).toBe(0));
    await expect(as(null, (q) => q.query(`SELECT 1 FROM storage.objects`))).rejects.toThrow(/permission denied/);
  });
});

describe("constraints", () => {
  it("rejects invalid health records at the database", async () => {
    const bad: [string, unknown[]][] = [
      [`WITH s AS (INSERT INTO symptoms (user_id, name) VALUES ($1, 'Dizziness') RETURNING id) INSERT INTO symptom_events (user_id, symptom_id, severity) SELECT $1, id, 11 FROM s`, [alice]],
      [`INSERT INTO medications (user_id, name, instruction, source) VALUES ($1, 'X', '   ', 'user_reported')`, [alice]],
      [`INSERT INTO medical_documents (user_id, filename, content_type, byte_size, storage_path) VALUES ($1, 'a.exe', 'application/x-msdownload', 10, $2)`, [alice, `${alice}/a`]],
      [`INSERT INTO medical_documents (user_id, filename, content_type, byte_size, storage_path) VALUES ($1, 'a.pdf', 'application/pdf', 30000000, $2)`, [alice, `${alice}/b`]],
      [`INSERT INTO medical_documents (user_id, filename, content_type, byte_size, storage_path) VALUES ($1, 'a.pdf', 'application/pdf', 10, $2)`, [alice, `${bob}/c`]],
      [`INSERT INTO appointments (user_id, title, starts_at, ends_at) VALUES ($1, 'Visit', now(), now() - interval '1 hour')`, [alice]],
      [`INSERT INTO care_providers (user_id, name, website) VALUES ($1, 'Dr', 'javascript:alert(1)')`, [alice]],
      [`INSERT INTO health_memories (user_id, fact, source, status, confidence) VALUES ($1, 'x', 'ai', 'ai_inferred', 1.5)`, [alice]],
    ];
    for (const [sql, params] of bad) await expect(db.query(sql, params), sql).rejects.toThrow();
  });

  it("indexes the hot paths", async () => {
    const { rows } = await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`);
    const names = rows.map((r) => r.indexname).join(" ");
    for (const expected of ["health_memories_embedding", "plan_items_user_idx"]) expect(names).toContain(expected);
    // Every user_id column is covered by an index (RLS filters on it).
    const { rows: unindexed } = await db.query<{ table: string }>(
      `SELECT c.relname AS table FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'user_id'
          AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indkey[0] = a.attnum)`,
    );
    expect(unindexed.map((r) => r.table)).toEqual([]);
  });
});

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap";
import { loadConfig } from "../src/config";
import { createDatabase, migrate, type Database } from "../src/db/database";
import { FakeAiProvider } from "../src/modules/ai/fake.provider";
import { JobQueue } from "../src/modules/documents/job-queue";
import { SupabaseObjectStorage } from "../src/modules/documents/storage";

/**
 * End-to-end against a real Supabase project: Auth, Storage, Postgres (RLS)
 * and the Data API. Runs in CI against `supabase start`; can be pointed at a
 * hosted project. Opt-in because it creates (and then deletes) real users.
 *
 *   SUPABASE_LIVE_TEST=1 SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=…
 *   TEST_DATABASE_URL=… [SUPABASE_JWT_SECRET=…] npx vitest run test/supabase-live.test.ts
 */
const env = process.env;
const live = env.SUPABASE_LIVE_TEST === "1";

let app: INestApplication;
let http: ReturnType<typeof request>;
let db: Database;
let ai: FakeAiProvider;
const url = env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const password = `Live-test ${randomUUID()}`;
const created: string[] = [];

const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF");
const adminHeaders = (): Record<string, string> => {
  const key = env.SUPABASE_SECRET_KEY!;
  return key.startsWith("sb_") ? { apikey: key } : { apikey: key, Authorization: `Bearer ${key}` };
};

/** Creates a confirmed Supabase Auth user (admin API) and signs in through the HealthMate API. */
async function user(name: string) {
  const email = `hm-live-${name}-${randomUUID().slice(0, 8)}@example.com`;
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { ...adminHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { first_name: name, time_zone: "UTC" } }),
  });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
  const id = ((await res.json()) as { id: string }).id;
  created.push(id);
  const login = await http.post("/v1/auth/login").send({ email, password }).expect(200);
  const auth = { Authorization: `Bearer ${login.body.accessToken}` };
  for (const kind of ["ai_processing", "document_processing"]) await http.post("/v1/me/consents").set(auth).send({ kind, granted: true }).expect(204);
  return { id, email, auth, token: login.body.accessToken as string, refreshToken: login.body.refreshToken as string };
}

/** Supabase's Data API (PostgREST) as the signed-in person: this is what RLS protects. */
const dataApi = (token: string, path: string) =>
  fetch(`${url}/rest/v1/${path}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${token}` } });

describe.skipIf(!live)("Supabase (live)", () => {
  beforeAll(async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY,
      SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
      SUPABASE_JWT_SECRET: env.SUPABASE_JWT_SECRET,
      EMBEDDINGS_PROVIDER: "hash",
    } as NodeJS.ProcessEnv);
    db = await createDatabase({ url: env.TEST_DATABASE_URL, poolSize: 4 });
    await migrate(db);
    ai = new FakeAiProvider();
    app = await createApp({ config, database: db, aiProvider: ai, storage: new SupabaseObjectStorage(url, env.SUPABASE_SECRET_KEY!) }, { logger: false });
    http = request(app.getHttpServer());
  }, 60_000);

  afterAll(async () => {
    // Never leave test users behind (deleting the Auth user cascades to HealthMate rows).
    for (const id of created) await fetch(`${url}/auth/v1/admin/users/${id}`, { method: "DELETE", headers: adminHeaders() }).catch(() => undefined);
    await app?.close();
  });

  it("signs in with Supabase Auth; the API accepts its sessions and refreshes them", async () => {
    const alice = await user("Alice");
    const me = await http.get("/v1/me").set(alice.auth).expect(200);
    expect(me.body.profile.firstName).toBe("Alice");
    const refreshed = await http.post("/v1/auth/refresh").send({ refreshToken: alice.refreshToken }).expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    await http.post("/v1/auth/login").send({ email: alice.email, password: "wrong password!" }).expect(401);
    await http.get("/v1/me").set({ Authorization: "Bearer not-a-token" }).expect(401);
    await http.post("/v1/auth/logout").set({ Authorization: `Bearer ${refreshed.body.accessToken}` }).send({ refreshToken: refreshed.body.refreshToken }).expect(204);
    await http.post("/v1/auth/refresh").send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  }, 60_000);

  it("stores reports privately in Storage and isolates people across API, Data API and Storage", async () => {
    const alice = await user("Alice");
    const bob = await user("Bob");
    ai.on("report_analysis", () => ({
      readable: true,
      documentType: "lab_results",
      summary: "Test summary.",
      findings: [],
      suggestedQuestions: [],
      containsInstructionsToAi: false,
    }));
    const createdDoc = await http.post("/v1/documents").set(alice.auth).send({ kind: "report", filename: "labs.pdf", contentType: "application/pdf", byteSize: PDF.length }).expect(201);
    const { upload, document } = createdDoc.body as { upload: { url: string; headers: Record<string, string> }; document: { id: string } };
    const put = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: PDF });
    expect(put.status, await put.clone().text()).toBeLessThan(300);
    await http.post(`/v1/documents/${document.id}/process`).set(alice.auth).send({}).expect(202);
    await app.get(JobQueue).drain();
    expect((await http.get(`/v1/documents/${document.id}`).set(alice.auth).expect(200)).body.status).toBe("ready");

    // Download through a short-lived signed URL.
    const link = (await http.get(`/v1/documents/${document.id}/file`).set(alice.auth).expect(200)).body as { url: string };
    const file = await fetch(link.url);
    expect(Buffer.from(await file.arrayBuffer()).equals(PDF)).toBe(true);

    // Bob: not through the API…
    await http.get(`/v1/documents/${document.id}`).set(bob.auth).expect(404);
    await http.get(`/v1/documents/${document.id}/file`).set(bob.auth).expect(404);
    // …not through the Data API (RLS)…
    expect(await (await dataApi(bob.token, `medical_documents?id=eq.${document.id}`)).json()).toEqual([]);
    expect(await (await dataApi(bob.token, `profiles?user_id=eq.${alice.id}`)).json()).toEqual([]);
    expect(((await (await dataApi(alice.token, `medical_documents?id=eq.${document.id}`)).json()) as unknown[]).length).toBe(1);
    // …and not straight from Storage (storage.objects policies).
    const path = `${alice.id}/${document.id}`;
    const direct = await fetch(`${url}/storage/v1/object/authenticated/medical-reports/${path}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${bob.token}` } });
    expect(direct.status).toBeGreaterThanOrEqual(400);
    const own = await fetch(`${url}/storage/v1/object/authenticated/medical-reports/${path}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${alice.token}` } });
    expect(own.status).toBe(200);
    // People can't write medical files directly, even into their own folder.
    const sneaky = await fetch(`${url}/storage/v1/object/medical-reports/${alice.id}/direct.pdf`, {
      method: "POST",
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY!, Authorization: `Bearer ${alice.token}`, "Content-Type": "application/pdf" },
      body: PDF,
    });
    expect(sneaky.status).toBeGreaterThanOrEqual(400);
    // Anonymous callers (publishable key, no session) are refused outright — including the API's bookkeeping table.
    for (const table of ["medical_documents", "users", "health_memories", "schema_migrations", "audit_logs"]) {
      const anon = await fetch(`${url}/rest/v1/${table}`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY! } });
      expect([401, 403], table).toContain(anon.status);
    }
  }, 120_000);

  // Needs the local stack's Mailpit (SUPABASE_MAILPIT_URL) to read the reset email.
  it.skipIf(!env.SUPABASE_MAILPIT_URL)("resets a forgotten password through the emailed link", async () => {
    const dave = await user("Dave");
    await http.post("/v1/auth/password-reset").send({ email: dave.email }).expect(202);
    let link: string | undefined;
    for (let i = 0; i < 40 && !link; i++) {
      const list = (await (await fetch(`${env.SUPABASE_MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${dave.email}`)}`)).json()) as { messages: { ID: string }[] };
      if (list.messages[0]) {
        const message = (await (await fetch(`${env.SUPABASE_MAILPIT_URL}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string; HTML: string };
        link = /(https?:\/\/[^\s"<>]+verify[^\s"<>]+)/.exec(`${message.Text} ${message.HTML}`)?.[1]?.replace(/&amp;/g, "&");
      }
      if (!link) await new Promise((r) => setTimeout(r, 250));
    }
    expect(link).toBeDefined();
    const verified = await fetch(link!, { redirect: "manual" });
    const accessToken = new URLSearchParams((verified.headers.get("location") ?? "").split("#")[1] ?? "").get("access_token");
    expect(accessToken).toBeTruthy();
    const newPassword = `New passphrase ${randomUUID()}`;
    await http.post("/v1/auth/password-reset/complete").send({ accessToken, password: newPassword }).expect(204);
    await http.post("/v1/auth/login").send({ email: dave.email, password }).expect(401);
    await http.post("/v1/auth/login").send({ email: dave.email, password: newPassword }).expect(200);
    // The old session was signed out everywhere.
    await http.post("/v1/auth/refresh").send({ refreshToken: dave.refreshToken }).expect(401);
  }, 60_000);

  it("deletes the account: Storage objects, the Auth user and every row", async () => {
    const carol = await user("Carol");
    const doc = await http.post("/v1/documents").set(carol.auth).send({ kind: "report", filename: "a.pdf", contentType: "application/pdf", byteSize: PDF.length }).expect(201);
    await fetch(doc.body.upload.url, { method: "PUT", headers: doc.body.upload.headers, body: PDF });
    await http.post("/v1/me/delete").set(carol.auth).send({ password }).expect(204);
    const listed = await fetch(`${url}/storage/v1/object/list/medical-reports`, {
      method: "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: `${carol.id}/`, limit: 10 }),
    });
    expect(await listed.json()).toEqual([]);
    expect((await fetch(`${url}/auth/v1/admin/users/${carol.id}`, { headers: adminHeaders() })).status).toBe(404);
    expect((await db.query(`SELECT 1 FROM users WHERE id = $1`, [carol.id])).rows).toHaveLength(0);
    await http.get("/v1/me").set(carol.auth).expect(401);
  }, 60_000);
});

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { createApp } from "./bootstrap";
import { loadConfig } from "./config";
import { createDatabase, migrate } from "./db/database";
import { DemoAiProvider } from "./modules/ai/demo.provider";
import { LocalObjectStorage } from "./modules/documents/storage";

/**
 * Demo server for screenshots and UI tests: scripted AI answers (clearly
 * labelled as a demo in the app) and a demo account. Never for production.
 *
 * The seeded content is deliberately non-medical — no conditions,
 * medications, results or clinician instructions are invented.
 */
export const DEMO_ACCOUNT = { email: "demo@healthmate.example", password: "demo-password-123", firstName: "Alex" };

async function main() {
  const config = loadConfig();
  if (config.NODE_ENV === "production") throw new Error("The demo server must not run in production.");
  const logger = new Logger("Demo");
  const database = await createDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
  await migrate(database);
  const storage = new LocalObjectStorage(config.STORAGE_DIR, config.PUBLIC_BASE_URL, config.jwtSecret);
  const app = await createApp({ config, database, aiProvider: new DemoAiProvider(), storage });
  await app.listen(config.PORT);
  await seed(`http://127.0.0.1:${config.PORT}/v1`);
  logger.log(`Demo API on :${config.PORT} — sign in as ${DEMO_ACCOUNT.email} / ${DEMO_ACCOUNT.password}`);
}

export async function seed(base: string) {
  const call = async (path: string, body?: unknown, token?: string, method = "POST") => {
    const res = await fetch(`${base}/${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 409) throw new Error(`seed ${method} ${path} failed with ${res.status}`);
    return res.status === 204 ? null : ((await res.json()) as Record<string, unknown>);
  };

  const registered = await call("auth/register", { ...DEMO_ACCOUNT, lastName: "", timeZone: "UTC" });
  const auth = registered && "accessToken" in registered ? registered : await call("auth/login", { email: DEMO_ACCOUNT.email, password: DEMO_ACCOUNT.password });
  const token = String(auth?.accessToken);

  const existing = (await call("memories", undefined, token, "GET")) as unknown as unknown[];
  if (Array.isArray(existing) && existing.length > 0) return; // already seeded (persistent database)

  for (const kind of ["ai_processing", "document_processing"]) await call("me/consents", { kind, granted: true }, token);
  await call("memories", { fact: "Prefers to walk in the morning", status: "user_reported" }, token);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  await call("timeline", { eventType: "note", title: "Started a morning walking habit", occurredAt: twoDaysAgo }, token);
  await call("conversations", { message: "Tips for sleeping better" }, token);
  const today = new Date().toISOString().slice(0, 10);
  const item = (title: string, kind: "task" | "habit", time: string, notes: string | null) => ({
    id: randomUUID(),
    title,
    notes,
    kind,
    time,
    repeat: { type: "daily" },
    reminderEnabled: false,
    source: "user_reported",
    instruction: null,
    startDay: today,
    endDay: null,
    createdAt: new Date().toISOString(),
  });
  await call("plan", { baseRevision: 0, items: [item("Morning walk", "habit", "07:30", "20 minutes"), item("Drink a glass of water", "task", "12:00", null)], completions: [] }, token, "PUT");
}

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

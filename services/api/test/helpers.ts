import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createApp } from "../src/bootstrap";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { createDatabase, migrate, type Database } from "../src/db/database";
import { FakeAiProvider } from "../src/modules/ai/fake.provider";
import { JobQueue } from "../src/modules/documents/job-queue";
import { LocalObjectStorage } from "../src/modules/documents/storage";

export interface TestContext {
  app: INestApplication;
  http: ReturnType<typeof request>;
  db: Database;
  ai: FakeAiProvider;
  storage: LocalObjectStorage;
  drainJobs: () => Promise<void>;
  close: () => Promise<void>;
}

/** A full app on an in-memory Postgres (PGlite) with a fake AI provider. */
export async function createTestContext(): Promise<TestContext> {
  const config = loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1" } as NodeJS.ProcessEnv);
  const db = await createDatabase({});
  await migrate(db);
  const ai = new FakeAiProvider();
  const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-uploads-")), config.PUBLIC_BASE_URL, config.jwtSecret);
  const app = await createApp({ config, database: db, aiProvider: ai, storage }, { logger: false });
  const http = request(app.getHttpServer());
  return {
    app,
    http,
    db,
    ai,
    storage,
    drainJobs: () => app.get(JobQueue).drain(),
    close: () => app.close(),
  };
}

let counter = 0;

/** Registers a new user (and grants consents) and returns an authorised request helper. */
export async function signUp(ctx: TestContext, consents: string[] = ["ai_processing", "document_processing", "health_data_sync"]) {
  counter += 1;
  await ctx.app.get(RateLimiter).reset(); // tests register many users from one address
  const email = `user${counter}-${Date.now()}@example.com`;
  const res = await ctx.http.post("/v1/auth/register").send({ email, password: "correct horse battery", firstName: "Alex", timeZone: "UTC" }).expect(201);
  const token = res.body.accessToken as string;
  const auth = { Authorization: `Bearer ${token}` };
  for (const kind of consents) await ctx.http.post("/v1/me/consents").set(auth).send({ kind, granted: true }).expect(204);
  return { email, userId: res.body.userId as string, token, auth, refreshToken: res.body.refreshToken as string };
}

export const chatAnswer = (overrides: Record<string, unknown> = {}) => ({
  answer: "A headache like this could have several causes, such as tension or dehydration.",
  followUp: { question: "How would you describe the headache?", options: ["Mild", "Moderate", "Severe"], allowsMultiple: false },
  warningSigns: ["The worst headache of your life", "Headache with a stiff neck and fever"],
  careRecommendation: null,
  memorySuggestions: [{ fact: "Has had a headache since yesterday" }],
  ...overrides,
});

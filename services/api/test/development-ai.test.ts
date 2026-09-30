import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiProviderFor } from "../src/adapters";
import { createApp } from "../src/bootstrap";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { createDatabase, migrate } from "../src/db/database";
import { DevelopmentAiProvider, developmentAnswer } from "../src/modules/ai/development.provider";
import { LocalObjectStorage } from "../src/modules/documents/storage";

const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

/** KEY=value lines of an env file, as Node's --env-file reads them (empty values included). */
function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]!] = match[2]!;
  }
  return out;
}

describe("AI provider selection without a paid key", () => {
  it("is honestly unavailable when nothing is configured", () => {
    const config = loadConfig(env({ NODE_ENV: "development" }));
    expect(config.aiProvider).toBe("none");
    expect(config.aiEnabled).toBe(false);
    expect(aiProviderFor(config)).toMatchObject({ name: "unavailable", available: false });
  });

  it("uses the Anthropic provider only when a key is set", () => {
    const config = loadConfig(env({ NODE_ENV: "development", ANTHROPIC_API_KEY: "test-key-not-real" }));
    expect(config.aiProvider).toBe("anthropic");
    expect(aiProviderFor(config).name).toBe("anthropic");
    expect(() => loadConfig(env({ NODE_ENV: "development", AI_PROVIDER: "anthropic" }))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("offers an offline development provider that needs no key and is refused in production", () => {
    const config = loadConfig(env({ NODE_ENV: "development", AI_PROVIDER: "development" }));
    const provider = aiProviderFor(config);
    expect(provider).toBeInstanceOf(DevelopmentAiProvider);
    expect(provider).toMatchObject({ name: "development", available: true, demo: true });
    // Even with a key present, the explicit choice wins (no accidental paid calls).
    expect(aiProviderFor(loadConfig(env({ NODE_ENV: "development", AI_PROVIDER: "development", ANTHROPIC_API_KEY: "test-key-not-real" }))).name).toBe("development");
    expect(() => loadConfig(env({ NODE_ENV: "production", DATABASE_URL: "postgres://x", STORAGE_PROVIDER: "local", AI_PROVIDER: "development" }))).toThrow();
  });

  it("accepts the committed .env.example unchanged (empty values mean not set)", () => {
    const config = loadConfig(env(parseEnvFile(join(__dirname, "../../../.env.example"))));
    expect(config.aiProvider).toBe("none");
    expect(config.authProvider).toBe("local");
    expect(config.SUPABASE_URL).toBeUndefined();
  });
});

describe("development answer text", () => {
  it("lists only the selected context, verbatim, and says no model was called", () => {
    const system = [
      "Rules mention <health_context> too; only the context block itself is read.",
      `<health_context>
Today: 2026-09-30
Profile:
- not provided
Previous relevant history (selected for this question; …):
Current:
- User reported: Evening headaches after screen time (about 3 months ago, 2026-06-30)
Past (no longer current — use only as history):
- User reported: Played football weekly (about 8 years ago, 2018-01-01; no longer current since 2019-01-01)
Daily health data relevant to this question:
- Sleep: last 7 days averaged 5.9 h, below your usual range (7.1 h)
</health_context>`,
    ];
    const text = developmentAnswer(system);
    expect(text).toMatch(/^Development mode: no AI model was called/);
    expect(text).toContain("- User reported: Evening headaches after screen time");
    expect(text).toContain("Past (no longer current");
    expect(text).toContain("- Sleep: last 7 days averaged 5.9 h, below your usual range");
    const empty = developmentAnswer(["rules", "<health_context>\nPrevious relevant history (…):\nCurrent:\n- none relevant\nDaily health data relevant to this question:\n- none relevant\n</health_context>"]);
    expect(empty).toContain("No facts from your health memory were selected");
    expect(empty).not.toContain("Daily health data selected");
  });
});

describe("chat with the development provider (synthetic data)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let auth: Record<string, string>;

  beforeAll(async () => {
    const config = loadConfig(env({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", AI_PROVIDER: "development" }));
    const db = await createDatabase({});
    await migrate(db);
    const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-dev-ai-")), config.PUBLIC_BASE_URL, config.jwtSecret);
    app = await createApp({ config, database: db, aiProvider: aiProviderFor(config), storage }, { logger: false });
    http = request(app.getHttpServer());
    await app.get(RateLimiter).reset();
    const res = await http.post("/v1/auth/register").send({ email: `dev-ai-${Date.now()}@example.com`, password: "correct horse battery", firstName: "Sam", timeZone: "UTC" }).expect(201);
    auth = { Authorization: `Bearer ${res.body.accessToken}` };
    await http.post("/v1/me/consents").set(auth).send({ kind: "ai_processing", granted: true }).expect(204);
  });
  afterAll(async () => {
    await app.close();
  });

  const ask = async (message: string) => (await http.post("/v1/conversations").set(auth).send({ message }).expect(201)).body.messages[1].payload;

  it("reports itself as a demo so clients show their notice", async () => {
    expect((await http.get("/v1/meta").expect(200)).body.ai).toEqual({ available: true, demo: true });
  });

  it("recalls, excludes and dates remembered facts without a model", async () => {
    const memory = (await http.post("/v1/memories").set(auth).send({ fact: "Evening headaches after screen time" }).expect(201)).body;

    const recalled = await ask("Why do I get headaches in the evening?");
    expect(recalled.kind).toBe("answer");
    expect(recalled.answer).toContain("Development mode: no AI model was called");
    expect(recalled.answer).toContain("Evening headaches after screen time");
    expect(recalled.context.memories.map((m: { id: string }) => m.id)).toContain(memory.id);

    await http.patch(`/v1/memories/${memory.id}`).set(auth).send({ aiExcluded: true }).expect(200);
    const excluded = await ask("Why do I get headaches in the evening?");
    expect(excluded.answer).not.toContain("Evening headaches after screen time");
    expect(excluded.context.memories).toEqual([]);

    await http.patch(`/v1/memories/${memory.id}`).set(auth).send({ aiExcluded: false }).expect(200);
    await http.post(`/v1/memories/${memory.id}/end`).set(auth).send({ endedOn: "2025-01-01" }).expect(200);
    const past = await ask("Why do I get headaches in the evening?");
    expect(past.answer).toContain("Past (no longer current");
    expect(past.context.memories[0].temporalStatus).toBe("historical");
  });

  it("still escalates emergencies before any provider is involved", async () => {
    const payload = await ask("I have crushing chest pain and I can't breathe");
    expect(payload.kind).toBe("escalation");
  });
});

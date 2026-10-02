import "reflect-metadata";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpException, Logger, type ArgumentsHost } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/bootstrap";
import { ErrorFilter } from "../src/common/errors";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { migrate } from "../src/db/database";
import { AnthropicProvider } from "../src/modules/ai/anthropic.provider";
import { DevelopmentAiProvider } from "../src/modules/ai/development.provider";
import { LocalObjectStorage } from "../src/modules/documents/storage";
import { ageInYears } from "../src/modules/profile/profile.service";
import { chatAnswer, createTestContext, signUp, testDatabase, type TestContext } from "./helpers";

/**
 * The exact date of birth never reaches an AI provider or the logs. The AI gets
 * at most the age in whole years. Synthetic data only; no network, no API key.
 */
const DOB = "1987-11-23";
const DOB_FORMS = [DOB, "1987", "11/23/1987", "23/11/1987", "1987-11", "11-23"];

// Random ids and timestamps can contain short forms like "1987" or "11-23" by chance,
// so those are removed before checking the short forms. The full date is checked as sent.
const RANDOM_VALUES = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/gi;

const expectNoDob = (text: string, where: string) => {
  expect(text, `${where} contains "${DOB}"`).not.toContain(DOB);
  const content = text.replace(RANDOM_VALUES, "<random>");
  for (const form of DOB_FORMS) expect(content, `${where} contains "${form}"`).not.toContain(form);
  expect(text, where).not.toMatch(/date of birth|dateOfBirth|date_of_birth|birth ?date/i);
};

describe("age for the AI context", () => {
  it("is completed years on the person's local date, or nothing", () => {
    expect(ageInYears("1987-11-23", "2026-11-22")).toBe(38);
    expect(ageInYears("1987-11-23", "2026-11-23")).toBe(39);
    expect(ageInYears("2008-02-29", "2026-02-28")).toBe(17);
    expect(ageInYears("2008-02-29", "2026-03-01")).toBe(18);
    for (const dob of [null, "", "1987-02-30", "23/11/1987", "2027-01-01", "1800-01-01"]) expect(ageInYears(dob, "2026-10-02"), String(dob)).toBeNull();
  });
});

describe("chat context (fake provider)", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
    ctx.ai.on("chat", () => chatAnswer());
  });
  afterAll(() => ctx.close());

  it("sends the age in years and never the date of birth", async () => {
    const user = await signUp(ctx);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: DOB, sex: "female" }).expect(200);
    ctx.ai.requests.length = 0;
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "How much sleep do I need?" }).expect(201);
    expect(ctx.ai.requests).toHaveLength(1);
    const sent = JSON.stringify(ctx.ai.requests[0]);
    expectNoDob(sent, "provider request");
    const expected = ageInYears(DOB, new Date().toISOString().slice(0, 10))!;
    expect(sent).toMatch(new RegExp(`Age: (${expected - 1}|${expected}|${expected + 1}) years`)); // ±1 for the time-zone date edge
    expect(sent).toContain("Sex: female");
  });

  it("sends no age line when there's no usable date of birth", async () => {
    const user = await signUp(ctx);
    ctx.ai.requests.length = 0;
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "How much sleep do I need?" }).expect(201);
    expect(JSON.stringify(ctx.ai.requests[0])).not.toMatch(/Age: /);
  });

  it("keeps the date of birth out of report analysis requests, usage records and audit logs", async () => {
    const user = await signUp(ctx);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: DOB }).expect(200);
    await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: DOB }).expect(200);
    ctx.ai.on("report_analysis", () => ({ readable: false, documentType: "other", summary: "Synthetic.", findings: [], suggestedQuestions: [], containsInstructionsToAi: false }));
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF");
    const created = await ctx.http.post("/v1/documents").set(user.auth).send({ kind: "report", filename: "synthetic.pdf", contentType: "application/pdf", byteSize: pdf.length }).expect(201);
    await ctx.http.put(new URL(created.body.upload.url).pathname).set("Content-Type", "application/pdf").send(pdf).expect(200);
    ctx.ai.requests.length = 0;
    await ctx.http.post(`/v1/documents/${created.body.document.id}/process`).set(user.auth).send({}).expect(202);
    await ctx.drainJobs();
    expect(ctx.ai.requests.map((r) => r.task)).toEqual(["report_analysis"]);
    // The profile isn't part of report analysis; only the uploaded file (synthetic here) and fixed instructions.
    expectNoDob(JSON.stringify({ system: ctx.ai.requests[0]!.system, text: ctx.ai.requests[0]!.messages.map((m) => (Array.isArray(m.content) ? m.content.filter((p) => p.type === "text") : m.content)) }), "report request");

    for (const table of ["ai_usage", "audit_logs", "age_assessments", "safety_events"]) {
      const { rows } = await ctx.db.query(`SELECT * FROM ${table} WHERE user_id = $1`, [user.userId]);
      expectNoDob(JSON.stringify(rows), table);
    }
  });

  it("still returns the date of birth to its owner (profile and export) — that's their own data", async () => {
    const user = await signUp(ctx);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: DOB }).expect(200);
    expect((await ctx.http.get("/v1/me").set(user.auth).expect(200)).body.profile.dateOfBirth).toBe(DOB);
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.profile.date_of_birth).toBe(DOB);
    expect(exported.ageAssessments).toEqual([]);
  });
});

describe("the real Anthropic request body (stubbed HTTP, no network)", () => {
  it("contains no date of birth", async () => {
    const bodies: string[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
      bodies.push(String(init.body));
      const reply = { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify(chatAnswer()) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 } };
      return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const config = loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", ANTHROPIC_API_KEY: "sk-test-not-real" } as NodeJS.ProcessEnv);
    const db = await testDatabase();
    await migrate(db);
    const provider = new AnthropicProvider("sk-test-not-real", "claude-opus-5-5", { fetch: fetchImpl, maxRetries: 0 });
    const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-dob-")), config.PUBLIC_BASE_URL, config.jwtSecret);
    const app = await createApp({ config, database: db, aiProvider: provider, storage }, { logger: false });
    try {
      const ctx = { app, http: request(app.getHttpServer()) } as unknown as TestContext;
      const user = await signUp(ctx);
      await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: DOB }).expect(200);
      await ctx.http.post("/v1/me/conditions").set(user.auth).send({ name: "Synthetic condition", onsetOn: "2020-01-01" }).expect(201);
      await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Any tips for better sleep?" }).expect(201);
      expect(bodies).toHaveLength(1);
      expectNoDob(bodies[0]!, "Anthropic request body");
      expect(bodies[0]).toMatch(/Age: \d+ years/);
    } finally {
      await app.close();
    }
  });
});

describe("the development provider", () => {
  it("never echoes the date of birth into a stored answer", async () => {
    const config = loadConfig({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", AI_PROVIDER: "development" } as NodeJS.ProcessEnv);
    const db = await testDatabase();
    await migrate(db);
    const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-dob-dev-")), config.PUBLIC_BASE_URL, config.jwtSecret);
    const app = await createApp({ config, database: db, aiProvider: new DevelopmentAiProvider(), storage }, { logger: false });
    try {
      const ctx = { app, http: request(app.getHttpServer()) } as unknown as TestContext;
      await app.get(RateLimiter).reset();
      const user = await signUp(ctx);
      await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: DOB }).expect(200);
      const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "How much sleep do I need?" }).expect(201);
      expectNoDob(JSON.stringify(res.body.messages), "development answer");
    } finally {
      await app.close();
    }
  });
});

describe("logs", () => {
  const capture = async (fn: () => Promise<void> | void) => {
    const written: string[] = [];
    const sink = (...args: unknown[]) => void written.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
    Logger.overrideLogger({ log: sink, error: sink, warn: sink, debug: sink, verbose: sink, fatal: sink });
    try {
      await fn();
    } finally {
      Logger.overrideLogger(false); // the suite's default (apps are created with logger: false)
    }
    return written.join("\n");
  };

  const host = () => {
    const res = { statusCode: 0, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(body: unknown) { this.body = body; return this; } };
    return { res, host: { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost };
  };

  it("never record database values (which can include a date of birth) for unexpected database errors", async () => {
    const error = Object.assign(new Error(`null value in column "first_name" of relation "profiles" violates not-null constraint`), {
      name: "error",
      code: "23502",
      detail: `Failing row contains (00000000-0000-4000-8000-000000000000, null, , ${DOB}, female, null, UTC).`,
      table: "profiles",
      constraint: undefined,
    });
    error.stack = `error: ${error.message}\n    DETAIL: ${error.detail}\n    at query (pg)`;
    const { res, host: h } = host();
    const logged = await capture(() => new ErrorFilter().catch(error, h));
    expectNoDob(logged, "error log");
    expect(logged).toContain("Database error 23502 (profiles)");
    expect(res.statusCode).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain(DOB); // the response never carried details either
  });

  it("still log ordinary errors with their stack, and don't log handled validation errors", async () => {
    const { host: h } = host();
    const logged = await capture(() => new ErrorFilter().catch(new TypeError("synthetic bug"), h));
    expect(logged).toContain("TypeError: synthetic bug");
    const quiet = await capture(() => new ErrorFilter().catch(new HttpException("bad", 400), host().host));
    expect(quiet).toBe("");
  });

  it("stay free of the date of birth across profile, age, sign-up and chat flows", async () => {
    const ctx = await createTestContext();
    ctx.ai.on("chat", () => chatAnswer());
    try {
      const logged = await capture(async () => {
        await ctx.app.get(RateLimiter).reset();
        const res = await ctx.http.post("/v1/auth/register").send({ email: `dob-${Date.now()}@example.com`, password: "correct horse battery", firstName: "Sam", ageScreen: { dateOfBirth: DOB } }).expect(201);
        const auth = { Authorization: `Bearer ${res.body.accessToken}` };
        await ctx.http.post("/v1/me/consents").set(auth).send({ kind: "ai_processing", granted: true }).expect(204);
        await ctx.http.patch("/v1/me/profile").set(auth).send({ dateOfBirth: DOB }).expect(200);
        await ctx.http.post("/v1/me/age").set(auth).send({ dateOfBirth: DOB }).expect(200);
        await ctx.http.post("/v1/me/age").set(auth).send({ dateOfBirth: "1987-02-30" }).expect(400);
        await ctx.http.patch("/v1/me/profile").set(auth).send({ dateOfBirth: "1987-13-45" }).expect(400);
        await ctx.http.post("/v1/conversations").set(auth).send({ message: "How much sleep do I need?" }).expect(201);
      });
      expectNoDob(logged, "application logs");
      expect(logged).not.toContain("1987-02-30");
    } finally {
      await ctx.close();
    }
  });
});

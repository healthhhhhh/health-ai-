import "reflect-metadata";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { aiProvidersFor } from "../src/adapters";
import { createApp } from "../src/bootstrap";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { createDatabase, migrate, type Database } from "../src/db/database";
import { AiGateway, registryOf } from "../src/modules/ai/ai.gateway";
import { aiDataRecipients } from "../src/modules/ai/ai.routing";
import { AiDeclinedError, AiInvalidOutputError, AiUnavailableError, AiUnpricedModelError } from "../src/modules/ai/ai.types";
import { OpenRouterProvider } from "../src/modules/ai/openrouter.provider";
import { ChatAnswerSchema } from "../src/modules/chat/chat.prompts";
import { JobQueue } from "../src/modules/documents/job-queue";
import { LocalObjectStorage } from "../src/modules/documents/storage";
import { chatAnswer, testDatabase } from "./helpers";

/**
 * OpenRouter provider with a stubbed fetch: the real request is built and the real
 * response handling runs, but nothing leaves the process. Synthetic data only.
 * Model names below are test values.
 */
const KEY = "sk-or-test-THIS-MUST-NOT-APPEAR";
const env = (values: Record<string, string> = {}) =>
  ({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", AI_PROVIDER: "openrouter", OPENROUTER_API_KEY: KEY, ...values }) as unknown as NodeJS.ProcessEnv;

type Reply = { status: number; body: unknown } | "network-error";
interface Seen {
  url: string;
  authorization: string;
  body: Record<string, any>;
}
function fakeOpenRouter(...replies: Reply[]) {
  const seen: Seen[] = [];
  const fetchStub = (async (url: string | URL, init?: RequestInit) => {
    const headers = init?.headers as Record<string, string>;
    seen.push({ url: String(url), authorization: headers.Authorization!, body: JSON.parse(String(init?.body)) });
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)]!;
    if (reply === "network-error") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetch: fetchStub, seen };
}
const completion = (content: unknown, extra: { model?: string; finish_reason?: string; usage?: Record<string, unknown>; refusal?: string } = {}) => ({
  status: 200,
  body: {
    id: "gen-test",
    model: extra.model ?? "example/free-model:free",
    choices: [{ finish_reason: extra.finish_reason ?? "stop", message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content), refusal: extra.refusal ?? null } }],
    usage: extra.usage ?? { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100, cost: 0 },
  },
});
const failure = (status: number, message = "synthetic error") => ({ status, body: { error: { code: status, message } } });
const provider = (fake: ReturnType<typeof fakeOpenRouter>, model = "openrouter/free", allowPaid = false) => new OpenRouterProvider({ apiKey: KEY, model, allowPaid, fetch: fake.fetch });
const providerRequest = (model = "openrouter/free") => ({
  task: "health_chat" as const,
  model,
  system: ["Stable rules", "<health_context>synthetic</health_context>"],
  messages: [{ role: "user" as const, content: "How much sleep do adults usually need?" }],
  schema: ChatAnswerSchema,
  effort: "medium" as const,
  maxOutputTokens: 2_000,
});

describe("OpenRouter provider (stubbed HTTP)", () => {
  it("sends an OpenAI-compatible request with the key, the free router, the system prompt and a strict JSON schema", async () => {
    const fake = fakeOpenRouter(completion(chatAnswer()));
    const res = await provider(fake).generate({ ...providerRequest(), messages: [{ role: "user", content: "Earlier" }, { role: "assistant", content: "Earlier answer" }, { role: "user", content: "How much sleep do adults usually need?" }] });
    const [req] = fake.seen;
    expect(req!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(req!.authorization).toBe(`Bearer ${KEY}`);
    expect(req!.body.model).toBe("openrouter/free");
    expect(req!.body.messages[0]).toEqual({ role: "system", content: "Stable rules\n\n<health_context>synthetic</health_context>" });
    expect(req!.body.messages.slice(1).map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(req!.body.max_tokens).toBe(2_000);
    expect(req!.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "healthmate_answer", strict: true, schema: { type: "object" } } });
    expect(req!.body.usage).toEqual({ include: true });
    expect(req!.body.plugins).toBeUndefined();
    // The answer, the model OpenRouter actually chose, its usage and its billed amount.
    expect(res).toMatchObject({ data: chatAnswer(), model: "example/free-model:free", usage: { inputTokens: 900, outputTokens: 200 }, actualCostUsd: 0 });
  });

  it("sends images as data URLs, and PDFs as files with the text-extraction parser", async () => {
    const fake = fakeOpenRouter(completion({ ok: true }));
    await provider(fake).generate({
      ...providerRequest(),
      messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", base64: "aW1n" }, { type: "pdf", base64: "cGRm" }, { type: "text", text: "Explain this." }] }],
    });
    const parts = fake.seen[0]!.body.messages[1].content;
    expect(parts[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,aW1n" } });
    expect(parts[1]).toEqual({ type: "file", file: { filename: "document-2.pdf", file_data: "data:application/pdf;base64,cGRm" } });
    expect(fake.seen[0]!.body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "pdf-text" } }]);
  });

  it("accepts JSON wrapped in a code fence; refuses text, cut-off answers and refusals (usage kept)", async () => {
    expect((await provider(fakeOpenRouter(completion("```json\n" + JSON.stringify(chatAnswer()) + "\n```"))).generate(providerRequest())).data).toEqual(chatAnswer());
    const notJson = provider(fakeOpenRouter(completion("Sure! Here's my answer."))).generate(providerRequest());
    await expect(notJson).rejects.toBeInstanceOf(AiInvalidOutputError);
    await expect(notJson).rejects.toMatchObject({ failure: { usage: { inputTokens: 900 } } });
    await expect(provider(fakeOpenRouter(completion("{\"answer\":", { finish_reason: "length" }))).generate(providerRequest())).rejects.toBeInstanceOf(AiInvalidOutputError);
    await expect(provider(fakeOpenRouter(completion("", { finish_reason: "content_filter" }))).generate(providerRequest())).rejects.toBeInstanceOf(AiDeclinedError);
    await expect(provider(fakeOpenRouter(completion("", { refusal: "I can't help with that." }))).generate(providerRequest())).rejects.toBeInstanceOf(AiDeclinedError);
  });

  it("never sends a request to a paid model unless paid models are allowed", async () => {
    const fake = fakeOpenRouter(completion(chatAnswer()));
    await expect(provider(fake, "example/paid-model").generate(providerRequest("example/paid-model"))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fake.seen).toHaveLength(0);
    await provider(fake, "example/model:free").generate(providerRequest("example/model:free"));
    await provider(fake, "example/paid-model", true).generate(providerRequest("example/paid-model"));
    expect(fake.seen.map((s) => s.body.model)).toEqual(["example/model:free", "example/paid-model"]);
  });

  describe("errors (never logging the key or the conversation)", () => {
    const logged: string[] = [];
    beforeAll(() => {
      const sink = (...args: unknown[]) => void logged.push(args.map(String).join(" "));
      Logger.overrideLogger({ log: sink, error: sink, warn: sink, debug: sink, verbose: sink, fatal: sink });
    });
    afterAll(() => Logger.overrideLogger(false));
    afterEach(() => {
      for (const line of logged) {
        expect(line).not.toContain(KEY);
        expect(line).not.toContain("sleep");
        expect(line).not.toContain("synthetic error");
      }
    });
    const refused = async (reply: Reply, usageUnknown: boolean, hint: RegExp) => {
      logged.length = 0;
      const call = provider(fakeOpenRouter(reply)).generate(providerRequest());
      await expect(call).rejects.toBeInstanceOf(AiUnavailableError);
      await expect(call).rejects.toMatchObject({ failure: { usageUnknown } });
      expect(logged.join("\n")).toMatch(hint);
    };

    it("invalid key, no credits, unknown model, unsupported request, rate limits", async () => {
      await refused(failure(401), false, /401 for health_chat: OPENROUTER_API_KEY wasn't accepted/);
      await refused(failure(402), false, /402 .*credits/);
      await refused(failure(404), false, /404 .*OPENROUTER_MODEL/);
      await refused(failure(400), false, /400 .*JSON output, images or files/);
      await refused(failure(429), false, /429 .*per-minute and per-day/);
    });

    it("provider outages, timeouts and dropped connections: usage unknown", async () => {
      await refused(failure(503), true, /503/);
      await refused(failure(502), true, /502/);
      await refused(failure(408), true, /408/);
      await refused("network-error", true, /OpenRouter TypeError/);
      // An error reported inside a 200 response.
      await refused({ status: 200, body: { error: { code: 502, message: "synthetic error" } } }, true, /502/);
    });
  });
});

describe("OpenRouter configuration", () => {
  it("uses the free router by default, only when selected, and never in production", () => {
    expect(loadConfig(env()).OPENROUTER_MODEL).toBe("openrouter/free");
    expect(loadConfig(env({ AI_PROVIDER: "" })).aiProvider).toBe("none"); // a key alone selects nothing
    expect(() => loadConfig(env({ OPENROUTER_API_KEY: "" }))).toThrow(/needs OPENROUTER_API_KEY/);
    expect(() => loadConfig(env({ OPENROUTER_MODEL: "example/paid-model" }))).toThrow(/isn't free/);
    expect(loadConfig(env({ OPENROUTER_MODEL: "example/paid-model", OPENROUTER_ALLOW_PAID: "true" })).OPENROUTER_MODEL).toBe("example/paid-model");
    const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), STORAGE_PROVIDER: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "s", SUPABASE_PUBLISHABLE_KEY: "p" };
    expect(() => loadConfig(env(prod))).toThrow(/OpenRouter AI provider is enabled for development testing only/);
    try {
      loadConfig(env({ OPENROUTER_MODEL: "example/paid-model" }));
    } catch (error) {
      expect(String(error)).not.toContain(KEY);
    }
  });

  it("builds from configuration; Bedrock stays available but unused", () => {
    const registry = aiProvidersFor(loadConfig(env()));
    expect(registry.default).toBeInstanceOf(OpenRouterProvider);
    expect(registry.default.defaultModel).toBe("openrouter/free");
    expect(registry.default.metered).toBe(false); // free only
    expect(registry.byName.has("bedrock")).toBe(false);
    expect(aiDataRecipients(["openrouter"])).toEqual(["OpenRouter"]);
  });
});

describe("OpenRouter with the workspace proxy adding the key (OPENROUTER_AUTH=proxy)", () => {
  const proxyEnv = (values: Record<string, string> = {}) => env({ OPENROUTER_API_KEY: "", OPENROUTER_AUTH: "proxy", HTTPS_PROXY: "http://127.0.0.1:9", NODE_USE_ENV_PROXY: "1", ...values });

  it("needs no key, refuses one in the process, and refuses to run where requests wouldn't reach the proxy", () => {
    expect(loadConfig(env()).OPENROUTER_AUTH).toBe("key"); // the default is unchanged
    expect(loadConfig(proxyEnv()).OPENROUTER_AUTH).toBe("proxy");
    expect(() => loadConfig(proxyEnv({ OPENROUTER_API_KEY: KEY }))).toThrow(/leave OPENROUTER_API_KEY unset/);
    expect(() => loadConfig(proxyEnv({ HTTPS_PROXY: "" }))).toThrow(/HTTPS_PROXY isn't set/);
    expect(() => loadConfig(proxyEnv({ NODE_USE_ENV_PROXY: "" }))).toThrow(/NODE_USE_ENV_PROXY=1/);
    // Still free-only, and still never in production.
    expect(() => loadConfig(proxyEnv({ OPENROUTER_MODEL: "example/paid-model" }))).toThrow(/isn't free/);
    const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), STORAGE_PROVIDER: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "s", SUPABASE_PUBLISHABLE_KEY: "p" };
    expect(() => loadConfig(proxyEnv(prod))).toThrow(/development testing only/);
  });

  it("sends no Authorization header (the proxy adds it); everything else is unchanged", async () => {
    const built = aiProvidersFor(loadConfig(proxyEnv())).default as OpenRouterProvider;
    expect(built).toBeInstanceOf(OpenRouterProvider);
    const fake = fakeOpenRouter(completion(chatAnswer()));
    const res = await new OpenRouterProvider({ model: "openrouter/free", allowPaid: false, fetch: fake.fetch }).generate(providerRequest());
    expect(fake.seen[0]!.authorization).toBeUndefined();
    expect(fake.seen[0]!.body.model).toBe("openrouter/free");
    expect(res.data).toEqual(chatAnswer());
    // The free-only guard still applies before anything is sent.
    await expect(new OpenRouterProvider({ model: "example/paid-model", allowPaid: false, fetch: fake.fetch }).generate(providerRequest("example/paid-model"))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fake.seen).toHaveLength(1);
  });
});

describe("OpenRouter through the AI Gateway", () => {
  let db: Database;
  beforeAll(async () => {
    db = await createDatabase({});
    await migrate(db);
  });
  afterAll(() => db.close());
  const person = async (consent = true) => {
    const id = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`or-${Math.random()}@example.com`])).rows[0]!.id;
    if (consent) await db.query(`INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, 'ai_processing', true, 'test')`, [id]);
    return id;
  };
  const ask = (userId: string) => ({ task: "health_chat" as const, userId, system: ["rules"], messages: [{ role: "user" as const, content: "How can I sleep better?" }], schema: ChatAnswerSchema });

  it("records usage and the model actually used, at no cost for free models", async () => {
    const userId = await person();
    const res = await new AiGateway(registryOf(provider(fakeOpenRouter(completion(chatAnswer())))), db, loadConfig(env())).generate(ask(userId));
    expect(res).toMatchObject({ provider: "openrouter", model: "example/free-model:free", costUsd: 0 });
    const rows = (await db.query(`SELECT provider, model, input_tokens, output_tokens, cost_usd::float8 AS cost, status FROM ai_usage WHERE user_id = $1`, [userId])).rows;
    expect(rows).toEqual([{ provider: "openrouter", model: "example/free-model:free", input_tokens: 900, output_tokens: 200, cost: 0, status: "ok" }]);
  });

  it("consent is checked before any request", async () => {
    const fake = fakeOpenRouter(completion(chatAnswer()));
    await expect(new AiGateway(registryOf(provider(fake)), db, loadConfig(env())).generate(ask(await person(false)))).rejects.toMatchObject({ name: "ProcessingNotPermittedError" });
    expect(fake.seen).toHaveLength(0);
  });

  it("paid models stay fail-closed: without a price the gateway refuses to start", () => {
    const config = loadConfig(env({ OPENROUTER_MODEL: "example/paid-model", OPENROUTER_ALLOW_PAID: "true" }));
    expect(() => new AiGateway(registryOf(provider(fakeOpenRouter(completion(chatAnswer())), "example/paid-model", true)), db, config)).toThrow(AiUnpricedModelError);
  });
});

describe("OpenRouter behind the HTTP API", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fake: ReturnType<typeof fakeOpenRouter>;
  const replies: Reply[] = [];
  beforeAll(async () => {
    const config = loadConfig(env({ AGE_ENFORCEMENT: "enforce" }));
    const db = await testDatabase();
    await migrate(db);
    fake = fakeOpenRouter(completion(chatAnswer()));
    const stub = fake.fetch;
    // Replies queued per test, else a chat answer.
    const fetchStub = (async (url: string | URL, init?: RequestInit) => (replies.length ? fakeOpenRouter(replies.shift()!).fetch(url, init).finally(() => void stub(url, init).catch(() => undefined)) : stub(url, init))) as typeof fetch;
    const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-or-")), config.PUBLIC_BASE_URL, config.jwtSecret);
    app = await createApp({ config, database: db, aiProvider: new OpenRouterProvider({ apiKey: KEY, model: "openrouter/free", allowPaid: false, fetch: fetchStub }), storage }, { logger: false });
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  const account = async (consents = ["ai_processing", "document_processing"], dateOfBirth: string | null = "1990-04-12") => {
    await app.get(RateLimiter).reset();
    const res = await http.post("/v1/auth/register").send({ email: `or-${Date.now()}-${Math.random()}@example.com`, password: "correct horse battery", firstName: "Sam", timeZone: "UTC" }).expect(201);
    const auth = { Authorization: `Bearer ${res.body.accessToken}` };
    if (dateOfBirth) await http.post("/v1/me/age").set(auth).send({ dateOfBirth }).expect(200);
    for (const kind of consents) await http.post("/v1/me/consents").set(auth).send({ kind, granted: true }).expect(204);
    return auth;
  };
  const upload = async (auth: Record<string, string>, kind: "report" | "image", file: Buffer, contentType: string) => {
    const created = await http.post("/v1/documents").set(auth).send({ kind, filename: kind === "report" ? "synthetic.pdf" : "synthetic.png", contentType, byteSize: file.length, purpose: kind === "image" ? "skin" : undefined }).expect(201);
    await http.put(new URL(created.body.upload.url).pathname).set("Content-Type", contentType).send(file).expect(200);
    const id = created.body.document.id as string;
    await http.post(`/v1/documents/${id}/process`).set(auth).send({}).expect(202);
    await app.get(JobQueue).drain();
    return (await http.get(`/v1/documents/${id}`).set(auth).expect(200)).body;
  };

  it("chat answers through the gateway; /v1/meta names OpenRouter without exposing settings", async () => {
    const auth = await account();
    fake.seen.length = 0;
    const res = await http.post("/v1/conversations").set(auth).send({ message: "How much sleep do adults usually need?" }).expect(201);
    expect(res.body.messages[1].payload).toMatchObject({ kind: "answer", answer: chatAnswer().answer });
    expect(fake.seen).toHaveLength(1);
    const meta = (await http.get("/v1/meta").expect(200)).body;
    expect(meta.ai).toEqual({ available: true, demo: false, recipients: ["OpenRouter"] });
    expect(JSON.stringify(meta)).not.toContain(KEY);
  });

  it("emergencies, missing consent and a missing date of birth never reach OpenRouter", async () => {
    const auth = await account();
    const noConsent = await account([]);
    const noAge = await account(["ai_processing"], null);
    fake.seen.length = 0;
    expect((await http.post("/v1/conversations").set(auth).send({ message: "I have crushing chest pain and I can't breathe" }).expect(201)).body.messages[1].payload.kind).toBe("escalation");
    await http.post("/v1/conversations").set(noConsent).send({ message: "How much sleep do adults usually need?" }).expect(403);
    await http.post("/v1/conversations").set(noAge).send({ message: "How much sleep do adults usually need?" }).expect(403);
    expect(fake.seen).toHaveLength(0);
  });

  it("a PDF report goes as a file with the parser; a photo goes as an image", async () => {
    const auth = await account();
    const extraction = { readable: true, documentType: "lab_results", summary: "Synthetic summary.", findings: [], suggestedQuestions: ["What do these mean?"], containsInstructionsToAi: false };
    fake.seen.length = 0;
    replies.push(completion(extraction));
    const report = await upload(auth, "report", Buffer.from("%PDF-1.4\n% synthetic\n%%EOF"), "application/pdf");
    expect(report.status).toBe("ready");
    expect(fake.seen[0]!.body.plugins).toEqual([{ id: "file-parser", pdf: { engine: "pdf-text" } }]);
    expect(fake.seen[0]!.body.messages[1].content[0].type).toBe("file");

    const analysis = { quality: "good", qualityIssue: null, supported: true, bodyArea: "forearm", observations: ["A small red patch."], possibleCauses: [{ name: "Irritation", likelihood: "possible" }], recommendations: ["Keep the area clean."], warningSigns: ["Spreading redness"], careUrgency: "routine", containsInstructionsToAi: false };
    fake.seen.length = 0;
    replies.push(completion(analysis));
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const photo = await upload(auth, "image", PNG, "image/png");
    expect(photo.status).toBe("ready");
    const parts = fake.seen[0]!.body.messages[1].content;
    expect(parts.some((p: { type: string }) => p.type === "image_url")).toBe(true);
    expect(fake.seen[0]!.body.plugins).toBeUndefined();
  });
});

import "reflect-metadata";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Logger, type INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { aiProvidersFor } from "../src/adapters";
import { bedrockCheck } from "../src/bedrock-check";
import { createApp } from "../src/bootstrap";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig, type AppConfig } from "../src/config";
import { createDatabase, migrate, type Database } from "../src/db/database";
import { AiGateway, registryOf } from "../src/modules/ai/ai.gateway";
import { AiDeclinedError, AiInvalidOutputError, AiTimeoutError, AiUnavailableError, AiUnpricedModelError } from "../src/modules/ai/ai.types";
import { BedrockProvider } from "../src/modules/ai/bedrock.provider";
import { ChatAnswerSchema } from "../src/modules/chat/chat.prompts";
import { LocalObjectStorage } from "../src/modules/documents/storage";
import { chatAnswer, testDatabase } from "./helpers";

/**
 * Amazon Bedrock provider with mocked AWS responses: a fake HTTP handler stands in for
 * bedrock-runtime, so the real AWS SDK serializes requests and parses responses and
 * errors, but nothing leaves the process and nothing is billed. Synthetic data only.
 * The model ID and prices below are test values, not real Bedrock models or prices.
 */
const KEY = "bedrock-test-key-THIS-MUST-NOT-APPEAR";
const MODEL = "us.example.test-model-v1:0";
const OTHER_MODEL = "us.example.other-model-v2:0";
const REGION = "us-west-2";
const PRICES = `${MODEL}=3/15,${OTHER_MODEL}=1/5`; // test values (USD per million tokens)

const env = (values: Record<string, string> = {}) =>
  ({ NODE_ENV: "test", PUBLIC_BASE_URL: "http://127.0.0.1", AI_PROVIDER: "bedrock", AWS_BEARER_TOKEN_BEDROCK: KEY, AWS_REGION: REGION, BEDROCK_MODEL_ID: MODEL, AI_PRICES: PRICES, ...values }) as unknown as NodeJS.ProcessEnv;

type Reply = { status: number; body?: unknown; errorType?: string } | "hang";
interface SeenRequest {
  host: string;
  path: string;
  authorization: string | undefined;
  body: Record<string, any>;
}

/** A fake bedrock-runtime endpoint. Replies are used in order; the last one repeats. */
function fakeBedrock(...replies: Reply[]) {
  const seen: SeenRequest[] = [];
  const handler = {
    handle: async (req: { hostname: string; path: string; headers: Record<string, string>; body: unknown }) => {
      const raw = typeof req.body === "string" ? req.body : Buffer.from(req.body as Uint8Array).toString("utf8");
      seen.push({ host: req.hostname, path: req.path, authorization: req.headers.authorization ?? req.headers.Authorization, body: JSON.parse(raw) });
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)]!;
      if (reply === "hang") return new Promise<never>(() => undefined);
      const headers: Record<string, string> = { "content-type": "application/json", ...(reply.errorType ? { "x-amzn-errortype": `${reply.errorType}:http://internal.amazon.com/coral/com.amazon.bedrock/` } : {}) };
      return { response: { statusCode: reply.status, headers, body: Readable.from([Buffer.from(JSON.stringify(reply.body ?? {}))]) } };
    },
  };
  return { handler, seen };
}

const answered = (input: unknown, usage: Record<string, number> = { inputTokens: 1_200, outputTokens: 300, totalTokens: 1_500 }, stopReason = "tool_use") => ({
  status: 200,
  body: { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "tooluse_1", name: "respond", input } }] } }, stopReason, usage, metrics: { latencyMs: 5 } },
});
const failure = (status: number, errorType: string, message = "synthetic error") => ({ status, errorType, body: { message } });

const provider = (fake: ReturnType<typeof fakeBedrock>, modelId = MODEL, maxAttempts = 1) => new BedrockProvider({ apiKey: KEY, region: REGION, modelId, requestHandler: fake.handler as never, maxAttempts });

const providerRequest = (model = MODEL) => ({
  task: "health_chat" as const,
  model,
  system: ["Stable rules", "<health_context>synthetic</health_context>"],
  messages: [{ role: "user" as const, content: "How much sleep do adults usually need?" }],
  schema: ChatAnswerSchema,
  effort: "medium" as const,
  maxOutputTokens: 2_000,
});

describe("Bedrock provider (mocked AWS)", () => {
  it("sends one Converse request with the bearer key, the configured model, the system prompt and a forced answer tool", async () => {
    const fake = fakeBedrock(answered(chatAnswer()));
    const res = await provider(fake).generate({
      ...providerRequest(),
      messages: [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
        { role: "user", content: [{ type: "text", text: "What does this say?" }, { type: "image", mediaType: "image/png", base64: Buffer.from("png").toString("base64") }, { type: "pdf", base64: Buffer.from("%PDF").toString("base64") }] },
      ],
    });
    expect(fake.seen).toHaveLength(1);
    const [req] = fake.seen;
    expect(req!.host).toBe(`bedrock-runtime.${REGION}.amazonaws.com`);
    expect(decodeURIComponent(req!.path)).toBe(`/model/${MODEL}/converse`);
    expect(req!.authorization).toBe(`Bearer ${KEY}`);
    expect(req!.body.system).toEqual([{ text: "Stable rules" }, { text: "<health_context>synthetic</health_context>" }]);
    expect(req!.body.inferenceConfig).toEqual({ maxTokens: 2_000 });
    expect(req!.body.toolConfig.toolChoice).toEqual({ tool: { name: "respond" } });
    expect(req!.body.toolConfig.tools[0].toolSpec.inputSchema.json).toMatchObject({ type: "object", properties: expect.objectContaining({ answer: expect.any(Object) }) });
    // Conversation history is kept in order; attachments use Converse's image/document blocks.
    expect(req!.body.messages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    const parts = req!.body.messages[2].content;
    expect(parts[0]).toEqual({ text: "What does this say?" });
    expect(parts[1].image.format).toBe("png");
    expect(parts[2].document).toMatchObject({ format: "pdf", name: "document-3" });

    expect(res.data).toEqual(chatAnswer());
    expect(res.model).toBe(MODEL);
    expect(res.usage).toEqual({ inputTokens: 1_200, outputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("reports cache tokens when Bedrock does, and leaves usage unknown when it's missing", async () => {
    const cached = await provider(fakeBedrock(answered(chatAnswer(), { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadInputTokens: 900, cacheWriteInputTokens: 40 }))).generate(providerRequest());
    expect(cached.usage).toEqual({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 40 });
    const noUsage = fakeBedrock({ status: 200, body: { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t", name: "respond", input: chatAnswer() } }] } }, stopReason: "tool_use" } });
    expect((await provider(noUsage).generate(providerRequest())).usage).toBeUndefined();
  });

  it("accepts a JSON text answer, and treats other text, cut-off answers and guardrail blocks as failures (still billed)", async () => {
    const text = (t: string, stopReason = "end_turn") => ({ status: 200, body: { output: { message: { role: "assistant", content: [{ text: t }] } }, stopReason, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } });
    expect((await provider(fakeBedrock(text(JSON.stringify(chatAnswer())))).generate(providerRequest())).data).toEqual(chatAnswer());

    const notJson = provider(fakeBedrock(text("Here is my answer"))).generate(providerRequest());
    await expect(notJson).rejects.toBeInstanceOf(AiInvalidOutputError);
    await expect(notJson).rejects.toMatchObject({ failure: { usage: { inputTokens: 10, outputTokens: 5 } } });

    await expect(provider(fakeBedrock(text("{\"answer\":", "max_tokens"))).generate(providerRequest())).rejects.toBeInstanceOf(AiInvalidOutputError);
    for (const stopReason of ["guardrail_intervened", "content_filtered"]) {
      const blocked = provider(fakeBedrock(text("", stopReason))).generate(providerRequest());
      await expect(blocked).rejects.toBeInstanceOf(AiDeclinedError);
      await expect(blocked).rejects.toMatchObject({ failure: { usage: { inputTokens: 10 } } });
    }
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
      const call = provider(fakeBedrock(reply)).generate(providerRequest());
      await expect(call).rejects.toBeInstanceOf(AiUnavailableError);
      await expect(call).rejects.toMatchObject({ failure: { usageUnknown } });
      expect(logged.join("\n")).toMatch(hint);
    };

    it("invalid credentials", async () => {
      await refused(failure(403, "UnrecognizedClientException", "The security token included in the request is invalid."), false, /UnrecognizedClientException 403 for health_chat: .*AWS_BEARER_TOKEN_BEDROCK/);
      await refused(failure(403, "AccessDeniedException", "Invalid API Key format"), false, /AccessDeniedException 403/);
    });

    it("a model the account can't use, or that doesn't exist in the Region", async () => {
      await refused(failure(403, "AccessDeniedException", "You don't have access to the model with the specified model ID."), false, /access to the model in AWS_REGION/);
      await refused(failure(404, "ResourceNotFoundException", "Model not found"), false, /BEDROCK_MODEL_ID wasn't found in AWS_REGION/);
      await refused(failure(400, "ValidationException", "The provided model identifier is invalid."), false, /inference profile/);
    });

    it("throttling (and a successful retry when retries are allowed)", async () => {
      await refused(failure(429, "ThrottlingException", "Too many requests"), false, /ThrottlingException 429/);
      const fake = fakeBedrock(failure(429, "ThrottlingException"), answered(chatAnswer()));
      const res = await provider(fake, MODEL, 2).generate(providerRequest());
      expect(fake.seen).toHaveLength(2);
      expect(res.data).toEqual(chatAnswer());
    });

    it("model timeouts and server errors may have been processed: usage unknown (the gateway charges the reservation)", async () => {
      await refused(failure(408, "ModelTimeoutException"), true, /ModelTimeoutException 408/);
      await refused(failure(503, "ServiceUnavailableException"), true, /ServiceUnavailableException 503/);
      await refused(failure(500, "InternalServerException"), true, /InternalServerException 500/);
    });
  });
});

describe("Bedrock configuration", () => {
  it("is selected only explicitly, needs all three settings and is refused in production", () => {
    // AWS settings alone never select Bedrock: the default stays anthropic-if-keyed, otherwise none.
    const unselected = loadConfig(env({ AI_PROVIDER: "" }) as never);
    expect(unselected.aiProvider).toBe("none");
    expect(loadConfig(env({ AI_PROVIDER: "", ANTHROPIC_API_KEY: "test-key-not-real" }) as never).aiProvider).toBe("anthropic");
    expect(loadConfig(env()).aiProvider).toBe("bedrock");

    for (const missing of ["AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION", "BEDROCK_MODEL_ID"]) {
      expect(() => loadConfig(env({ [missing]: "" }))).toThrow(/needs AWS_BEARER_TOKEN_BEDROCK, AWS_REGION and BEDROCK_MODEL_ID/);
    }
    const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(40), STORAGE_PROVIDER: "supabase", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SECRET_KEY: "s", SUPABASE_PUBLISHABLE_KEY: "p" };
    expect(() => loadConfig(env(prod))).toThrow(/Bedrock AI provider is enabled for development testing only/);
    expect(() => loadConfig(env({ ...prod, AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "test-key-not-real", AI_ROUTES: "summarization=bedrock" }))).toThrow(/development testing only/);
    // Configuration errors never echo the key.
    try {
      loadConfig(env({ AWS_REGION: "" }));
    } catch (error) {
      expect(String(error)).not.toContain(KEY);
    }
  });

  it("builds the Bedrock provider from configuration, and the model follows BEDROCK_MODEL_ID", () => {
    const registry = aiProvidersFor(loadConfig(env()));
    expect(registry.default).toBeInstanceOf(BedrockProvider);
    expect(registry.default.defaultModel).toBe(MODEL);
    expect(aiProvidersFor(loadConfig(env({ BEDROCK_MODEL_ID: OTHER_MODEL }))).default.defaultModel).toBe(OTHER_MODEL);
    // Existing providers are untouched: development is still selectable, and can route one task to Bedrock.
    const mixed = aiProvidersFor(loadConfig(env({ AI_PROVIDER: "development", AI_ROUTES: "summarization=bedrock" })));
    expect(mixed.default.name).toBe("development");
    expect(mixed.byName.get("bedrock")).toBeInstanceOf(BedrockProvider);
  });
});

describe("Bedrock through the AI Gateway (accounting and budgets)", () => {
  let db: Database;
  beforeAll(async () => {
    db = await createDatabase({});
    await migrate(db);
  });
  afterAll(() => db.close());

  const person = async (consent = true) => {
    const id = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`bedrock-${Math.random()}@example.com`])).rows[0]!.id;
    if (consent) await db.query(`INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, 'ai_processing', true, 'test')`, [id]);
    return id;
  };
  const rows = async (userId: string) =>
    (await db.query<Record<string, unknown>>(`SELECT provider, model, input_tokens, output_tokens, cost_usd::float8 AS cost, cost_basis, status FROM ai_usage WHERE user_id = $1 ORDER BY created_at`, [userId])).rows;
  const gateway = (fake: ReturnType<typeof fakeBedrock>, values: Record<string, string> = {}) => {
    const config: AppConfig = loadConfig(env(values));
    return new AiGateway(registryOf(provider(fake, config.BEDROCK_MODEL_ID!)), db, config);
  };
  const ask = (userId: string | null) => ({ task: "health_chat" as const, userId, system: ["rules"], messages: [{ role: "user" as const, content: "How can I sleep better?" }], schema: ChatAnswerSchema });

  it("prices reported usage with the configured price and records it", async () => {
    const userId = await person();
    const fake = fakeBedrock(answered(chatAnswer(), { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 }));
    const res = await gateway(fake).generate(ask(userId));
    expect(res).toMatchObject({ provider: "bedrock", model: MODEL, usage: { inputTokens: 1_000, outputTokens: 500 } });
    // 1,000 × $3/M + 500 × $15/M (test prices) = $0.0105
    expect(res.costUsd).toBeCloseTo(0.0105, 6);
    expect(await rows(userId)).toEqual([{ provider: "bedrock", model: MODEL, input_tokens: 1_000, output_tokens: 500, cost: 0.0105, cost_basis: "usage", status: "ok" }]);
  });

  it("changing BEDROCK_MODEL_ID changes the model called and the price used", async () => {
    const userId = await person();
    const fake = fakeBedrock(answered(chatAnswer(), { inputTokens: 1_000, outputTokens: 500, totalTokens: 1_500 }));
    const res = await gateway(fake, { BEDROCK_MODEL_ID: OTHER_MODEL }).generate(ask(userId));
    expect(decodeURIComponent(fake.seen[0]!.path)).toBe(`/model/${OTHER_MODEL}/converse`);
    expect(res.costUsd).toBeCloseTo(0.0035, 6); // 1,000 × $1/M + 500 × $5/M
  });

  it("refuses a model without a verified price at startup (no guessed pricing)", () => {
    const config = loadConfig(env({ AI_PRICES: "" }));
    expect(() => new AiGateway(registryOf(provider(fakeBedrock(answered(chatAnswer())))), db, config)).toThrow(AiUnpricedModelError);
  });

  it("missing usage is charged at the reserved worst case, not zero", async () => {
    const userId = await person();
    const fake = fakeBedrock({ status: 200, body: { output: { message: { role: "assistant", content: [{ toolUse: { toolUseId: "t", name: "respond", input: chatAnswer() } }] } }, stopReason: "tool_use" } });
    await gateway(fake).generate(ask(userId));
    const [row] = await rows(userId);
    expect(row).toMatchObject({ cost_basis: "reservation", status: "ok" });
    expect(row!.cost as number).toBeGreaterThan(0);
  });

  it("enforces consent and the monthly limit before any Bedrock request", async () => {
    const noConsent = await person(false);
    const fake = fakeBedrock(answered(chatAnswer()));
    await expect(gateway(fake).generate(ask(noConsent))).rejects.toMatchObject({ name: "ProcessingNotPermittedError" });
    const capped = await person();
    await expect(gateway(fake, { AI_MONTHLY_USER_BUDGET_USD: "0.000001" }).generate(ask(capped))).rejects.toMatchObject({ name: "AiBudgetExceededError" });
    expect(fake.seen).toHaveLength(0);
    expect(await rows(capped)).toEqual([expect.objectContaining({ status: "budget_exceeded", cost: 0 })]);
  });

  it("a call that doesn't answer in time is a timeout charged at the reservation", async () => {
    const userId = await person();
    await expect(gateway(fakeBedrock("hang"), { AI_REQUEST_TIMEOUT_MS: "1000" }).generate(ask(userId))).rejects.toBeInstanceOf(AiTimeoutError);
    const [row] = await rows(userId);
    expect(row).toMatchObject({ status: "timeout", cost_basis: "reservation" });
    expect(row!.cost as number).toBeGreaterThan(0);
  });

  it("a refused request (e.g. no model access) costs nothing", async () => {
    const userId = await person();
    await expect(gateway(fakeBedrock(failure(403, "AccessDeniedException"))).generate(ask(userId))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await rows(userId)).toEqual([expect.objectContaining({ status: "unavailable", cost: 0 })]);
  });
});

describe("Bedrock behind the HTTP API (safety, consent, age)", () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fake: ReturnType<typeof fakeBedrock>;
  beforeAll(async () => {
    const config = loadConfig(env({ AGE_ENFORCEMENT: "enforce" }));
    const db = await testDatabase();
    await migrate(db);
    fake = fakeBedrock(answered(chatAnswer()));
    const storage = new LocalObjectStorage(mkdtempSync(join(tmpdir(), "hm-bedrock-")), config.PUBLIC_BASE_URL, config.jwtSecret);
    app = await createApp({ config, database: db, aiProvider: provider(fake), storage }, { logger: false });
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  const account = async (consents: string[] = ["ai_processing"], dateOfBirth: string | null = "1990-04-12") => {
    await app.get(RateLimiter).reset();
    const res = await http.post("/v1/auth/register").send({ email: `bedrock-${Date.now()}-${Math.random()}@example.com`, password: "correct horse battery", firstName: "Sam", timeZone: "UTC" }).expect(201);
    const auth = { Authorization: `Bearer ${res.body.accessToken}` };
    if (dateOfBirth) await http.post("/v1/me/age").set(auth).send({ dateOfBirth }).expect(200);
    for (const kind of consents) await http.post("/v1/me/consents").set(auth).send({ kind, granted: true }).expect(204);
    return auth;
  };

  it("answers chat through the gateway, and /v1/meta names AWS without exposing any setting", async () => {
    const auth = await account();
    fake.seen.length = 0;
    const res = await http.post("/v1/conversations").set(auth).send({ message: "How much sleep do adults usually need?" }).expect(201);
    expect(res.body.messages[1].payload).toMatchObject({ kind: "answer", answer: chatAnswer().answer });
    expect(fake.seen).toHaveLength(1);
    const meta = await http.get("/v1/meta").expect(200);
    expect(meta.body.ai).toEqual({ available: true, demo: false, recipients: ["Amazon Web Services"] });
    const text = JSON.stringify(meta.body);
    for (const secret of [KEY, MODEL, REGION]) expect(text).not.toContain(secret);
  });

  it("emergencies get fixed guidance without calling Bedrock", async () => {
    const auth = await account();
    fake.seen.length = 0;
    const res = await http.post("/v1/conversations").set(auth).send({ message: "I have crushing chest pain and I can't breathe" }).expect(201);
    expect(res.body.messages[1].payload.kind).toBe("escalation");
    expect(fake.seen).toHaveLength(0);
  });

  it("no AI consent, or no confirmed age, means no Bedrock request", async () => {
    const noConsent = await account([]);
    const noAge = await account(["ai_processing"], null);
    fake.seen.length = 0;
    await http.post("/v1/conversations").set(noConsent).send({ message: "How much sleep do adults usually need?" }).expect(403);
    expect((await http.post("/v1/conversations").set(noAge).send({ message: "How much sleep do adults usually need?" }).expect(403)).body.error.code).toBe("age_required");
    expect(fake.seen).toHaveLength(0);
  });
});

describe("bedrock:check", () => {
  let db: Database;
  beforeAll(async () => {
    db = await createDatabase({});
    await migrate(db);
  });
  afterAll(() => db.close());

  it("without the flag sends nothing, never prints the key, and says what's missing", async () => {
    const fake = fakeBedrock(answered({ summary: "ok" }));
    const lines: string[] = [];
    expect(await bedrockCheck(loadConfig(env()), { billable: false, db, providers: registryOf(provider(fake)) }, (l) => lines.push(l))).toBe(true);
    expect(fake.seen).toHaveLength(0);
    const out = lines.join("\n");
    expect(out).toContain(`Model: ${MODEL}`);
    expect(out).toContain("API key: set (not shown)");
    expect(out).toContain("get-foundation-model-availability");
    expect(out).not.toContain(KEY);

    lines.length = 0;
    expect(await bedrockCheck(loadConfig(env({ AI_PRICES: "" })), { billable: true, db, providers: registryOf(provider(fake)) }, (l) => lines.push(l))).toBe(false);
    expect(lines.join("\n")).toContain("Price: MISSING");
    expect(fake.seen).toHaveLength(0);
    expect(await bedrockCheck(loadConfig(env({ AI_PROVIDER: "development" })), { billable: false }, (l) => lines.push(l))).toBe(false);
  });

  it("with the flag sends one synthetic request through the gateway, which records its cost", async () => {
    const ok = fakeBedrock(answered({ summary: "ok" }, { inputTokens: 40, outputTokens: 6, totalTokens: 46 }));
    const lines: string[] = [];
    // Routes elsewhere don't matter: the check always asks BEDROCK_MODEL_ID.
    const config = loadConfig(env({ AI_ROUTES: "summarization=development" }));
    expect(await bedrockCheck(config, { billable: true, db, providers: registryOf(provider(ok)) }, (l) => lines.push(l))).toBe(true);
    expect(ok.seen).toHaveLength(1);
    expect(decodeURIComponent(ok.seen[0]!.path)).toBe(`/model/${MODEL}/converse`);
    expect(JSON.stringify(ok.seen[0]!.body)).not.toMatch(/sleep|date of birth|diagnos/i);
    expect(lines.at(-1)).toBe(`OK: ${MODEL} answered (40 input / 6 output tokens, estimated $0.000210 at your AI_PRICES).`);
    const recorded = await db.query<{ provider: string; cost: number }>(`SELECT provider, cost_usd::float8 AS cost FROM ai_usage WHERE user_id IS NULL AND model = $1`, [MODEL]);
    expect(recorded.rows).toEqual([{ provider: "bedrock", cost: 0.00021 }]);

    const denied = fakeBedrock(failure(403, "AccessDeniedException"));
    lines.length = 0;
    expect(await bedrockCheck(loadConfig(env()), { billable: true, db, providers: registryOf(provider(denied)) }, (l) => lines.push(l))).toBe(false);
    expect(lines.at(-1)).toMatch(/^FAILED/);
    expect(lines.join("\n")).not.toContain(KEY);
  });
});

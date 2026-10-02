import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiProvidersFor } from "../src/adapters";
import { loadConfig } from "../src/config";
import { createDatabase, migrate, type Database } from "../src/db/database";
import { AiBudgetLedger, type UsageRow } from "../src/modules/ai/ai.budget";
import { AiGateway, registryOf } from "../src/modules/ai/ai.gateway";
import { billingPeriod, PriceBook } from "../src/modules/ai/ai.pricing";
import { estimateInputTokens, TASK_PROFILES } from "../src/modules/ai/ai.tasks";
import { AiBudgetExceededError, AiTimeoutError, AiUnpricedModelError, type AiProvider, type AiProviderResponse } from "../src/modules/ai/ai.types";
import { AnthropicProvider } from "../src/modules/ai/anthropic.provider";
import { FakeAiProvider } from "../src/modules/ai/fake.provider";
import { ChatAnswerSchema } from "../src/modules/chat/chat.prompts";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

/**
 * Audit of budget enforcement: overspend from real usage, late responses,
 * expiry reconciliation, malformed usage, the safety-critical allowance and
 * production configuration. Runs on real Postgres in CI (TEST_DATABASE_URL).
 */
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const config = (values: Record<string, string> = {}) => loadConfig(env({ NODE_ENV: "test", ...values }));
const opus = (usage: AiProviderResponse["usage"] | null = { inputTokens: 10_000, outputTokens: 5_000 }) =>
  new FakeAiProvider({ name: "anthropic", model: "claude-opus-5-5", usage, metered: true }).on("chat", () => chatAnswer());

let db: Database;
beforeAll(async () => {
  db = await createDatabase({ url: process.env.TEST_DATABASE_URL, poolSize: 8 });
  await migrate(db);
});
afterAll(() => db.close());

/** A person who has granted AI processing (the gateway checks consent before anything else). */
const newUser = async () => {
  const id = (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`audit-${Math.random()}@example.com`])).rows[0]!.id;
  await db.query(`INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, 'ai_processing', true, 'test'), ($1, 'document_processing', true, 'test')`, [id]);
  return id;
};
const request = (userId: string | null, extra: Record<string, unknown> = {}) => ({
  task: "health_chat" as const,
  userId,
  system: ["rules", "<health_context>\n</health_context>"],
  messages: [{ role: "user" as const, content: "How can I sleep better?" }],
  schema: ChatAnswerSchema,
  ...extra,
});
const worstCase = (task: "health_chat" | "complex_health" = "health_chat") => {
  const r = request(null);
  return new PriceBook().worstCase(true, "claude-opus-5-5", estimateInputTokens(r.system, r.messages), TASK_PROFILES[task].maxOutputTokens);
};
const balance = (userId: string) => new AiBudgetLedger(db).balance(userId, billingPeriod());
const usageRows = async (userId: string) =>
  (await db.query<{ status: string; cost: number; cost_basis: string; model: string; output_tokens: number }>(
    `SELECT status, cost_usd::float8 AS cost, cost_basis, model, output_tokens FROM ai_usage WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )).rows;
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await check()); i++) await new Promise((resolve) => setTimeout(resolve, 20));
};

describe("real usage above the reservation", () => {
  it("is charged in full and then blocks further routine requests", async () => {
    const userId = await newUser();
    // 40,000 output tokens is far beyond the 16,000 reserved (e.g. a provider not honouring max_tokens).
    const provider = opus({ inputTokens: 1_000, outputTokens: 40_000 });
    const limit = worstCase() * 1.5;
    const gateway = new AiGateway(registryOf(provider), db, config({ AI_MONTHLY_USER_BUDGET_USD: String(limit) }));
    const result = await gateway.generate(request(userId));
    expect(result.costUsd).toBe(0.804); // 1000×4 + 40000×20, per million — more than the reservation
    expect(result.costUsd).toBeGreaterThan(worstCase());
    expect(await balance(userId)).toEqual({ spent: 0.804, reserved: 0 });
    // Spend now exceeds the limit: routine requests are refused without calling the provider.
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(provider.requests).toHaveLength(1);
  });

  it("charges a more expensive fallback model at its own price", async () => {
    const userId = await newUser();
    const fallback: AiProvider = {
      name: "anthropic", available: true, metered: true, defaultModel: "claude-opus-5-5",
      generate: async () => ({
        data: chatAnswer(), model: "claude-fable-5-1", usage: { inputTokens: 3_000, outputTokens: 20_000 },
        usageByModel: [
          { model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 2_000 } },
          { model: "claude-fable-5-1", usage: { inputTokens: 2_000, outputTokens: 18_000 } },
        ],
      }),
    };
    const result = await new AiGateway(registryOf(fallback), db, config()).generate(request(userId));
    // Opus 5.5: 1000×4 + 2000×20 = 44,000; Fable 5.1: 2000×10 + 18000×50 = 920,000 (per million).
    expect(result.costUsd).toBe(0.964);
    expect(result.costUsd).toBeGreaterThan(worstCase());
    expect((await balance(userId)).spent).toBe(0.964);
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ model: "claude-fable-5-1", cost: 0.964, cost_basis: "usage" })]);
  });
});

describe("late responses and expiry", () => {
  it("adds the extra once when a timed-out call later reports more than it was charged", async () => {
    const userId = await newUser();
    const provider = opus({ inputTokens: 1_000, outputTokens: 30_000 }); // $0.604 > worst case
    provider.delayMs = 1_300;
    const gateway = new AiGateway(registryOf(provider), db, config({ AI_REQUEST_TIMEOUT_MS: "1000" }));
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiTimeoutError);
    expect((await balance(userId)).spent).toBe(worstCase()); // charged the worst case at the timeout
    await until(async () => (await balance(userId)).spent > worstCase());
    expect(await balance(userId)).toEqual({ spent: 0.604, reserved: 0 });
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "timeout", cost: 0.604, cost_basis: "usage", output_tokens: 30_000 })]);
  });

  it("never refunds a timed-out call that later reports less", async () => {
    const userId = await newUser();
    const provider = opus({ inputTokens: 100, outputTokens: 100 });
    provider.delayMs = 1_200;
    const gateway = new AiGateway(registryOf(provider), db, config({ AI_REQUEST_TIMEOUT_MS: "1000" }));
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiTimeoutError);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect((await balance(userId)).spent).toBe(worstCase());
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "timeout", cost: worstCase(), cost_basis: "reservation" })]);
  });

  it("reconciles an expired reservation upwards exactly once", async () => {
    const userId = await newUser();
    const ledger = new AiBudgetLedger(db);
    const id = (await ledger.reserve({ userId, billingPeriod: billingPeriod(), task: "health_chat", provider: "anthropic", model: "claude-opus-5-5", amountUsd: 0.3, limitUsd: 5, safetyCritical: false, ttlMs: 1 }))!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await ledger.expireStale(userId)).toBe(1);
    const late: UsageRow = {
      userId, task: "health_chat", provider: "anthropic", model: "claude-opus-5-5", requestedModel: "claude-opus-5-5", billingPeriod: billingPeriod(),
      inputTokens: 1_000, outputTokens: 30_000, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0.1, costUsd: 0.604, costBasis: "usage",
      status: "ok", safetyCritical: false, validationIssueCount: 0, priceVersion: "test",
    };
    const results = await Promise.all([ledger.settle(id, late), ledger.settle(id, late), ledger.settle(id, late)]);
    expect(results.filter((r) => r === "reconciled")).toHaveLength(1);
    expect(await balance(userId)).toEqual({ spent: 0.604, reserved: 0 });
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "expired", cost: 0.604, cost_basis: "usage" })]);
    // A finished request can never be reconciled again, and an ordinary settled one never at all.
    expect(await ledger.settle(id, { ...late, costUsd: 5 })).toBeNull();
    expect((await balance(userId)).spent).toBe(0.604);
  });

  it("doesn't reopen requests settled from reported usage", async () => {
    const userId = await newUser();
    const gateway = new AiGateway(registryOf(opus()), db, config());
    await gateway.generate(request(userId));
    const id = (await db.query<{ id: string }>(`SELECT id FROM ai_budget_reservations WHERE user_id = $1`, [userId])).rows[0]!.id;
    const ledger = new AiBudgetLedger(db);
    const row = (await usageRows(userId))[0]!;
    expect(row.cost_basis).toBe("usage");
    expect(await ledger.settle(id, { userId, task: "health_chat", provider: "anthropic", model: "claude-opus-5-5", requestedModel: "claude-opus-5-5", billingPeriod: billingPeriod(), inputTokens: 0, outputTokens: 999_999, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: 0, costUsd: 99, costBasis: "usage", status: "ok", safetyCritical: false, validationIssueCount: 0, priceVersion: "test" })).toBeNull();
    expect((await balance(userId)).spent).toBe(0.14);
  });
});

describe("malformed usage", () => {
  it("charges at least the worst case for a malformed per-model breakdown", async () => {
    const userId = await newUser();
    const broken: AiProvider = {
      name: "anthropic", available: true, metered: true, defaultModel: "claude-opus-5-5",
      generate: async () => ({
        data: chatAnswer(), model: "claude-opus-5-5", usage: { inputTokens: 10, outputTokens: 10 },
        usageByModel: [{ model: "claude-opus-5-5", usage: { inputTokens: -5, outputTokens: Number.POSITIVE_INFINITY } }],
      }),
    };
    const result = await new AiGateway(registryOf(broken), db, config()).generate(request(userId));
    expect(result.costUsd).toBe(worstCase());
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ cost: worstCase(), cost_basis: "reservation" })]);
  });

  it("ignores an invalid provider-billed amount and prices the usage instead", async () => {
    const userId = await newUser();
    const lying: AiProvider = { name: "anthropic", available: true, metered: true, defaultModel: "claude-opus-5-5", generate: async () => ({ data: chatAnswer(), model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 500 }, actualCostUsd: -1 }) };
    expect((await new AiGateway(registryOf(lying), db, config()).generate(request(userId))).costUsd).toBe(0.014);
  });
});

describe("safety-critical allowance", () => {
  it("lets urgent requests use extra headroom above the limit, but not unlimited spend", async () => {
    const userId = await newUser();
    const provider = opus();
    // Limit: nothing for routine requests; allowance: room for exactly one urgent worst case.
    const gateway = new AiGateway(registryOf(provider), db, config({ AI_MONTHLY_USER_BUDGET_USD: "0.000001", AI_SAFETY_CRITICAL_ALLOWANCE_USD: String(worstCase("complex_health")) }));
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiBudgetExceededError);
    await gateway.generate(request(userId, { task: "complex_health", safetyCritical: true })); // $0.14 spent
    await expect(gateway.generate(request(userId, { task: "complex_health", safetyCritical: true }))).rejects.toBeInstanceOf(AiBudgetExceededError);
    expect(provider.requests).toHaveLength(1);
    expect(testConfigDefaults().AI_SAFETY_CRITICAL_ALLOWANCE_USD).toBe(5);
  });
});
const testConfigDefaults = () => config();

describe("chat when urgent answers can't use the model", () => {
  let ctx: TestContext;
  const provider = new FakeAiProvider({ name: "anthropic", model: "claude-opus-5-5", usage: { inputTokens: 10_000, outputTokens: 5_000 }, metered: true });
  beforeAll(async () => {
    ctx = await createTestContext({ ai: provider, env: { AI_MONTHLY_USER_BUDGET_USD: "0.000001", AI_SAFETY_CRITICAL_ALLOWANCE_USD: "0.000001" } });
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    provider.requests.length = 0;
    provider.available = true;
    provider.on("chat", () => chatAnswer());
  });

  it("returns the deterministic urgent guidance once the safety allowance is used up", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have a high fever and a stiff neck" }).expect(201);
    expect(res.body.messages[1].payload).toMatchObject({ kind: "escalation", escalation: { level: "urgent" } });
    expect(provider.requests).toHaveLength(0);
    // Routine questions are simply unavailable (no balance shown).
    const routine = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Tips for sleeping better" });
    expect(routine.status).toBe(503);
    expect(JSON.stringify(routine.body)).not.toMatch(/credit|balance|budget|limit|\$/i);
  });

  it("returns the deterministic urgent guidance when the AI is down", async () => {
    const unlimited = await createTestContext({ ai: provider, env: { AI_MONTHLY_USER_BUDGET_USD: "0" } });
    try {
      const user = await signUp(unlimited);
      provider.available = false;
      const res = await unlimited.http.post("/v1/conversations").set(user.auth).send({ message: "I have a high fever and a stiff neck" }).expect(201);
      expect(res.body.messages[1].payload).toMatchObject({ kind: "escalation", escalation: { level: "urgent" } });
      // Non-urgent questions still report that the AI is unavailable.
      await unlimited.http.post("/v1/conversations").set(user.auth).send({ message: "Tips for sleeping better" }).expect(503);
    } finally {
      await unlimited.close();
    }
  });
});

describe("production configuration", () => {
  const prod = { NODE_ENV: "production", DATABASE_URL: "postgres://x", SUPABASE_URL: "https://p.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p", SUPABASE_SECRET_KEY: "s" };

  it("never runs the development provider in production", () => {
    expect(() => loadConfig(env({ ...prod, AI_PROVIDER: "development" }))).toThrow(/development only/);
    expect(() => loadConfig(env({ ...prod, AI_ROUTES: "health_chat=development" }))).toThrow(/development only/);
  });

  it("refuses paid routes without credentials or prices", () => {
    expect(() => loadConfig(env({ ...prod, AI_PROVIDER: "anthropic" }))).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig(env({ ...prod, AI_ROUTES: "complex_health=anthropic:claude-opus-5-5" }))).toThrow(/ANTHROPIC_API_KEY/);
    const unpriced = loadConfig(env({ ...prod, ANTHROPIC_API_KEY: "test-key-not-real", AI_MODEL: "claude-no-price" }));
    expect(() => new AiGateway(aiProvidersFor(unpriced), db, unpriced)).toThrow(AiUnpricedModelError);
    // Without any AI configuration production is honestly unavailable, not free-running.
    const none = loadConfig(env(prod));
    expect(none.aiProvider).toBe("none");
    expect(aiProvidersFor(none).default.available).toBe(false);
  });

  it("never writes an API key to the logs, even on provider errors", async () => {
    const secret = "sk-ant-test-THIS-MUST-NOT-APPEAR-0123456789";
    const written: string[] = [];
    const capture = (...args: unknown[]) => void written.push(args.map(String).join(" "));
    Logger.overrideLogger({ log: capture, error: capture, warn: capture, debug: capture, verbose: capture, fatal: capture });
    try {
      const failing = (async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
      const provider = new AnthropicProvider(secret, "claude-opus-5-5", { fetch: failing, maxRetries: 0 });
      const userId = await newUser();
      await expect(new AiGateway(registryOf(provider), db, config()).generate(request(userId))).rejects.toBeDefined();
      let message = "";
      try {
        loadConfig(env({ NODE_ENV: "test", ANTHROPIC_API_KEY: secret, AI_PROVIDER: "bogus" }));
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      written.push(message); // configuration errors end up in startup logs
    } finally {
      Logger.overrideLogger(false); // the suite's default (apps are created with logger: false)
    }
    expect(written.join("")).not.toContain(secret);
    expect(written.join("")).toMatch(/Anthropic API error 401/); // the error is logged, the key isn't
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { createDatabase, migrate, type Database } from "../src/db/database";
import { AiBudgetLedger, type UsageRow } from "../src/modules/ai/ai.budget";
import { AiGateway, registryOf } from "../src/modules/ai/ai.gateway";
import { billingPeriod, PriceBook } from "../src/modules/ai/ai.pricing";
import { estimateInputTokens, TASK_PROFILES } from "../src/modules/ai/ai.tasks";
import { AiBudgetExceededError, AiDeclinedError, AiInvalidOutputError, AiTimeoutError, AiUnavailableError, AiUnpricedModelError, type AiProvider, type AiProviderResponse } from "../src/modules/ai/ai.types";
import { FakeAiProvider } from "../src/modules/ai/fake.provider";
import { ChatAnswerSchema } from "../src/modules/chat/chat.prompts";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

/**
 * Atomic cost protection. Runs on PGlite locally and on real Postgres in CI
 * (TEST_DATABASE_URL), where the concurrency tests exercise row locking.
 */
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
const config = (values: Record<string, string> = {}) => loadConfig(env({ NODE_ENV: "test", ...values }));
const opus = (usage: AiProviderResponse["usage"] | null = { inputTokens: 10_000, outputTokens: 5_000 }) =>
  new FakeAiProvider({ name: "anthropic", model: "claude-opus-5-5", usage, metered: true }).on("chat", () => chatAnswer());

let db: Database;
let ledger: AiBudgetLedger;
beforeAll(async () => {
  db = await createDatabase({ url: process.env.TEST_DATABASE_URL, poolSize: 8 });
  await migrate(db);
  ledger = new AiBudgetLedger(db);
});
afterAll(() => db.close());

const newUser = async () => (await db.query<{ id: string }>(`INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`, [`budget-${Math.random()}@example.com`])).rows[0]!.id;
const request = (userId: string | null, extra: Record<string, unknown> = {}) => ({
  task: "health_chat" as const,
  userId,
  system: ["rules", "<health_context>\n</health_context>"],
  messages: [{ role: "user" as const, content: "How can I sleep better?" }],
  schema: ChatAnswerSchema,
  ...extra,
});
/** The worst case the gateway reserves for `request()` on Opus 5.5. */
const worstCase = () => {
  const r = request(null);
  return new PriceBook().worstCase(true, "claude-opus-5-5", estimateInputTokens(r.system, r.messages), TASK_PROFILES.health_chat.maxOutputTokens);
};
const usageRows = async (userId: string) =>
  (await db.query<{ status: string; cost: number; cost_basis: string; model: string; requested_model: string; reservation_id: string | null; billing_period: string; task: string }>(
    `SELECT status, cost_usd::float8 AS cost, cost_basis, model, requested_model, reservation_id, billing_period, task FROM ai_usage WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )).rows;
const reservations = async (userId: string) =>
  (await db.query<{ status: string; amount: number; charged: number | null }>(`SELECT status, amount_usd::float8 AS amount, charged_usd::float8 AS charged FROM ai_budget_reservations WHERE user_id = $1 ORDER BY created_at`, [userId])).rows;
const row = (userId: string, cost: number): UsageRow => ({
  userId, task: "health_chat", provider: "anthropic", model: "claude-opus-5-5", requestedModel: "claude-opus-5-5", billingPeriod: billingPeriod(),
  inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, estimatedCostUsd: cost, costUsd: cost, costBasis: "usage",
  status: "ok", safetyCritical: false, validationIssueCount: 0, priceVersion: "test",
});
const reserve = (userId: string, amountUsd: number, limitUsd: number | null, ttlMs = 60_000) =>
  ledger.reserve({ userId, billingPeriod: billingPeriod(), task: "health_chat", provider: "anthropic", model: "claude-opus-5-5", amountUsd, limitUsd, safetyCritical: false, ttlMs });

describe("budget ledger", () => {
  it("lets concurrent reservations take exactly the room the limit has", async () => {
    const userId = await newUser();
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(userId, 0.1, 1)));
    expect(results.filter(Boolean)).toHaveLength(10);
    expect(await ledger.balance(userId, billingPeriod())).toEqual({ spent: 0, reserved: 1 });
  });

  it("allows a reservation that lands exactly on the limit, and refuses one a millionth over", async () => {
    const userId = await newUser();
    expect(await reserve(userId, 0.4, 1)).toBeTruthy();
    expect(await reserve(userId, 0.6, 1)).toBeTruthy(); // 1.000000 ≤ 1
    expect(await reserve(userId, 0.000001, 1)).toBeNull(); // 1.000001 > 1
    const other = await newUser();
    expect(await reserve(other, 1.000001, 1)).toBeNull();
  });

  it("settles once: retries and late duplicates can't charge twice", async () => {
    const userId = await newUser();
    const id = (await reserve(userId, 0.33, 5))!;
    expect(await ledger.settle(id, row(userId, 0.14))).toBe("settled");
    expect(await ledger.settle(id, row(userId, 0.14))).toBeNull(); // retry
    expect(await ledger.settle(id, row(userId, 0), "released")).toBeNull(); // late release
    expect(await ledger.balance(userId, billingPeriod())).toEqual({ spent: 0.14, reserved: 0 });
    expect(await usageRows(userId)).toHaveLength(1);
    // Concurrent duplicate settles: still exactly one charge.
    const id2 = (await reserve(userId, 0.33, 5))!;
    const settled = await Promise.all(Array.from({ length: 5 }, () => ledger.settle(id2, row(userId, 0.1))));
    expect(settled.filter((r) => r === "settled")).toHaveLength(1);
    expect(settled.filter((r) => r !== "settled").every((r) => r === null)).toBe(true);
    expect((await ledger.balance(userId, billingPeriod())).spent).toBeCloseTo(0.24);
    expect(await usageRows(userId)).toHaveLength(2);
  });

  it("charges reservations abandoned by a crashed request in full, once", async () => {
    const userId = await newUser();
    const id = (await reserve(userId, 0.33, 5, 1))!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await ledger.expireStale(userId)).toBe(1);
    expect(await ledger.expireStale(userId)).toBe(0);
    expect(await ledger.balance(userId, billingPeriod())).toEqual({ spent: 0.33, reserved: 0 });
    expect(await reservations(userId)).toEqual([{ status: "expired", amount: 0.33, charged: 0.33 }]);
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "expired", cost: 0.33, cost_basis: "reservation", reservation_id: id })]);
    // The request finishing late for less than the expiry charged: no refund, and only once.
    expect(await ledger.settle(id, row(userId, 0.14))).toBe("reconciled");
    expect(await ledger.settle(id, row(userId, 0.14))).toBeNull();
    expect((await ledger.balance(userId, billingPeriod())).spent).toBe(0.33);
  });

  it("expires stale reservations before checking the limit", async () => {
    const userId = await newUser();
    await reserve(userId, 0.9, 1, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The abandoned 0.9 becomes spend: 0.9 + 0.2 > 1.
    expect(await reserve(userId, 0.2, 1)).toBeNull();
    expect(await reserve(userId, 0.1, 1)).toBeTruthy();
  });
});

describe("gateway with reservations", () => {
  it("never lets concurrent requests overrun the monthly limit", async () => {
    const userId = await newUser();
    const provider = opus();
    provider.delayMs = 30; // all requests are in flight together
    const limit = worstCase() * 3 + 0.0001; // room for exactly three worst cases
    const gateway = new AiGateway(registryOf(provider), db, config({ AI_MONTHLY_USER_BUDGET_USD: String(limit) }));
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => gateway.generate(request(userId))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.filter((r) => r.status === "rejected" && r.reason instanceof AiBudgetExceededError)).toHaveLength(7);
    expect(provider.requests).toHaveLength(3);
    const balance = await new AiBudgetLedger(db).balance(userId, billingPeriod());
    expect(balance.reserved).toBe(0);
    expect(balance.spent).toBeCloseTo(0.42); // three settled at the real $0.14
    expect(balance.spent).toBeLessThanOrEqual(limit);
  });

  it("reconciles each reservation with the reported usage", async () => {
    const userId = await newUser();
    const gateway = new AiGateway(registryOf(opus({ inputTokens: 1_000, outputTokens: 500, cacheReadTokens: 2_000, cacheWriteTokens: 1_000 })), db, config());
    const result = await gateway.generate(request(userId));
    expect(result.costUsd).toBe(0.0194); // 1000×4 + 500×20 + 2000×0.2 + 1000×5, per million
    expect(await reservations(userId)).toEqual([{ status: "settled", amount: worstCase(), charged: 0.0194 }]);
    expect(await gateway.monthlySpend(userId)).toBe(0.0194);
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "ok", cost: 0.0194, cost_basis: "usage", billing_period: billingPeriod() })]);
  });

  it("releases the reservation when the provider didn't process the request", async () => {
    const userId = await newUser();
    const provider = opus();
    provider.failWith = new AiUnavailableError(); // e.g. HTTP 529: not processed, not billed
    const gateway = new AiGateway(registryOf(provider), db, config());
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await reservations(userId)).toEqual([{ status: "released", amount: worstCase(), charged: 0 }]);
    expect(await new AiBudgetLedger(db).balance(userId, billingPeriod())).toEqual({ spent: 0, reserved: 0 });
    // The caller's retry is charged for its own usage only.
    provider.failWith = null;
    await gateway.generate(request(userId));
    expect(await gateway.monthlySpend(userId)).toBe(0.14);
  });

  it("charges billed failures (refusals, cut-off answers) at their reported usage", async () => {
    const userId = await newUser();
    const provider = opus();
    provider.failWith = new AiDeclinedError({ model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 100 } });
    const gateway = new AiGateway(registryOf(provider), db, config());
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiDeclinedError);
    provider.failWith = new AiInvalidOutputError({ model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 16_000 } });
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiInvalidOutputError);
    expect((await usageRows(userId)).map((r) => [r.status, r.cost])).toEqual([["declined", 0.006], ["invalid_output", 0.324]]);
  });

  it("charges the worst case when a provider times out (it may still have billed)", async () => {
    const userId = await newUser();
    const provider = opus();
    provider.delayMs = 1_500;
    const gateway = new AiGateway(registryOf(provider), db, config({ AI_REQUEST_TIMEOUT_MS: "1000" }));
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiTimeoutError);
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "timeout", cost: worstCase(), cost_basis: "reservation" })]);
    expect(await new AiBudgetLedger(db).balance(userId, billingPeriod())).toEqual({ spent: worstCase(), reserved: 0 });
    // The late answer changes nothing.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(await usageRows(userId)).toHaveLength(1);
    expect(AiGateway.toApiError(new AiTimeoutError())).toMatchObject({ code: "ai_unavailable" });
  });

  it("charges the worst case for connection failures where usage is unknown", async () => {
    const userId = await newUser();
    const provider = opus();
    provider.failWith = new AiUnavailableError(undefined, { usageUnknown: true });
    await expect(new AiGateway(registryOf(provider), db, config()).generate(request(userId))).rejects.toBeInstanceOf(AiUnavailableError);
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "unavailable", cost: worstCase(), cost_basis: "reservation" })]);
  });

  it("charges the worst case when an answer comes back without usage metadata", async () => {
    const userId = await newUser();
    const gateway = new AiGateway(registryOf(opus(null)), db, config());
    const result = await gateway.generate(request(userId));
    expect(result.costUsd).toBe(worstCase());
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ status: "ok", cost: worstCase(), cost_basis: "reservation" })]);
    const malformed = await newUser();
    await new AiGateway(registryOf(opus({ inputTokens: Number.NaN, outputTokens: -1 })), db, config()).generate(request(malformed));
    expect(await usageRows(malformed)).toEqual([expect.objectContaining({ cost: worstCase(), cost_basis: "reservation" })]);
  });

  it("prices a refusal fallback model by model, and the worst case for an unpriced model", async () => {
    const userId = await newUser();
    const fallback: AiProvider = {
      name: "anthropic", available: true, metered: true, defaultModel: "claude-opus-5-5",
      generate: async () => ({
        data: chatAnswer(), model: "claude-opus-4-8", usage: { inputTokens: 2_000, outputTokens: 600 },
        usageByModel: [{ model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 100 } }, { model: "claude-opus-4-8", usage: { inputTokens: 1_000, outputTokens: 500 } }],
      }),
    };
    const result = await new AiGateway(registryOf(fallback), db, config()).generate(request(userId));
    expect(result.costUsd).toBe(0.0235); // (1000×4 + 100×20) + (1000×5 + 500×25), per million
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ model: "claude-opus-4-8", requested_model: "claude-opus-5-5", cost: 0.0235 })]);

    const unknown = await newUser();
    const surprise: AiProvider = { ...fallback, generate: async () => ({ data: chatAnswer(), model: "claude-next-unpriced", usage: { inputTokens: 1, outputTokens: 1 } }) };
    await new AiGateway(registryOf(surprise), db, config()).generate(request(unknown));
    expect(await usageRows(unknown)).toEqual([expect.objectContaining({ model: "claude-next-unpriced", cost: worstCase(), cost_basis: "reservation" })]);
  });

  it("refuses to start with a paid route to an unpriced model, and refuses unpriced requests", () => {
    const unpriced = new FakeAiProvider({ name: "anthropic", model: "claude-unknown", metered: true });
    expect(() => new AiGateway(registryOf(unpriced), db, config())).toThrow(AiUnpricedModelError);
    const known = opus();
    expect(() => new AiGateway(registryOf(known), db, { ...config(), aiRoutes: { summarization: { provider: "anthropic", model: "claude-unknown" } } })).toThrow(AiUnpricedModelError);
    // A price override makes it usable.
    expect(() => new AiGateway(registryOf(unpriced), db, { ...config(), aiPrices: { "claude-unknown": { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } } })).not.toThrow();
  });

  it("accounts safety-critical requests even past the limit, without refusing them", async () => {
    const userId = await newUser();
    const gateway = new AiGateway(registryOf(opus()), db, config({ AI_MONTHLY_USER_BUDGET_USD: "0.01" }));
    await expect(gateway.generate(request(userId))).rejects.toBeInstanceOf(AiBudgetExceededError);
    await gateway.generate(request(userId, { task: "complex_health", safetyCritical: true }));
    await gateway.generate(request(userId, { task: "complex_health", safetyCritical: true }));
    expect(await gateway.monthlySpend(userId)).toBe(0.28);
    expect((await usageRows(userId)).map((r) => r.status)).toEqual(["budget_exceeded", "ok", "ok"]);
  });

  it("doesn't reserve for free providers or system work", async () => {
    const userId = await newUser();
    const free = new FakeAiProvider().on("chat", () => chatAnswer());
    await new AiGateway(registryOf(free), db, config({ AI_MONTHLY_USER_BUDGET_USD: "0.000001" })).generate(request(userId));
    expect(await reservations(userId)).toEqual([]);
    expect(await usageRows(userId)).toEqual([expect.objectContaining({ cost: 0, cost_basis: "none" })]);
    await new AiGateway(registryOf(opus()), db, config({ AI_MONTHLY_USER_BUDGET_USD: "0.000001" })).generate(request(null));
  });
});

describe("through the API", () => {
  let ctx: TestContext;
  const provider = new FakeAiProvider({ name: "anthropic", model: "claude-opus-5-5", usage: { inputTokens: 1_000, outputTokens: 500 }, metered: true });
  beforeAll(async () => {
    ctx = await createTestContext({ ai: provider, env: { AI_MONTHLY_USER_BUDGET_USD: "0.000001" } });
  });
  afterAll(() => ctx.close());
  beforeEach(() => {
    provider.requests.length = 0;
    provider.available = true;
    provider.on("chat", () => chatAnswer());
  });

  it("ignores user ids, tasks, models, periods and costs sent by a client", async () => {
    const { db: appDb } = ctx;
    const victim = await signUp(ctx);
    const caller = await signUp(ctx);
    // Urgent symptoms bypass the (tiny) limit, so this request reaches the provider.
    const res = await ctx.http
      .post("/v1/conversations")
      .set(caller.auth)
      .send({ message: "I have a high fever and a stiff neck", userId: victim.userId, task: "summarization", model: "claude-haiku-4-5", provider: "development", costUsd: 0, billingPeriod: "2000-01", safetyCritical: false });
    expect(res.status).toBe(201);
    expect(provider.requests.at(-1)).toMatchObject({ task: "complex_health", model: "claude-opus-5-5" });
    const rows = (await appDb.query<{ user_id: string; task: string; model: string; billing_period: string; cost: number; safety_critical: boolean }>(
      `SELECT user_id, task, model, billing_period, cost_usd::float8 AS cost, safety_critical FROM ai_usage WHERE user_id IN ($1, $2)`, [victim.userId, caller.userId],
    )).rows;
    expect(rows).toEqual([{ user_id: caller.userId, task: "complex_health", model: "claude-opus-5-5", billing_period: billingPeriod(), cost: 0.014, safety_critical: true }]);
  });

  it("has no route that reads or changes usage, reservations or limits", async () => {
    const user = await signUp(ctx);
    for (const path of ["/v1/me/usage", "/v1/me/ai-usage", "/v1/me/budget", "/v1/ai/usage", "/v1/me/credits"]) {
      expect((await ctx.http.get(path).set(user.auth)).status, path).toBe(404);
    }
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(JSON.stringify(exported)).not.toMatch(/reserv|budget|cost_usd|spent_usd/i);
  });

  it("answers emergencies without any model call, even with AI down and the limit reached", async () => {
    const user = await signUp(ctx);
    provider.available = false;
    for (const message of ["I have crushing chest pain and I can't breathe", "I took too many pills"]) {
      const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message }).expect(201);
      expect(res.body.messages[1].payload.kind, message).toBe("escalation");
    }
    expect(provider.requests).toHaveLength(0);
  });

  it("treats medication questions as normal questions with safety checks, not emergencies", async () => {
    const user = await signUp(ctx);
    const unlimited = await createTestContext({ ai: provider, env: { AI_MONTHLY_USER_BUDGET_USD: "0" } });
    try {
      const u = await signUp(unlimited);
      const change = await unlimited.http.post("/v1/conversations").set(u.auth).send({ message: "Should I stop taking my blood pressure tablets?" }).expect(201);
      expect(change.body.messages[1].payload).toMatchObject({ kind: "answer", escalation: null });
      expect(change.body.messages[1].payload.notice).toContain("can't advise starting, stopping or changing");
      expect(provider.requests.at(-1)!.task).toBe("complex_health");
      const info = await unlimited.http.post("/v1/conversations").set(u.auth).send({ message: "What is ibuprofen usually used for?" }).expect(201);
      expect(info.body.messages[1].payload).toMatchObject({ kind: "answer", escalation: null, notice: null });
      expect(provider.requests.at(-1)!.task).toBe("health_chat");
      // A dose in the model's answer is caught by the safety checks and replaced.
      provider.on("chat", () => chatAnswer({ answer: "Take 800 mg of ibuprofen three times a day." }));
      const unsafe = await unlimited.http.post("/v1/conversations").set(u.auth).send({ message: "My knee hurts after running" }).expect(201);
      expect(unsafe.body.messages[1].payload).toMatchObject({ safetyAdjusted: true });
      expect(unsafe.body.messages[1].payload.answer).not.toMatch(/800 mg/);
    } finally {
      await unlimited.close();
    }
    // Medication questions are not safety-critical: the cost limit applies to them.
    const limited = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Should I stop taking my blood pressure tablets?" });
    expect(limited.status).toBe(503);
  });
});

describe("architecture", () => {
  const src = join(__dirname, "../src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith(".ts") ? [join(dir, f)] : []));

  it("calls providers only from the gateway, and the paid SDK only from its provider", () => {
    for (const file of files(src)) {
      const rel = file.slice(src.length + 1);
      const text = readFileSync(file, "utf8");
      if (rel !== "modules/ai/ai.gateway.ts") expect(text, rel).not.toMatch(/provider\.generate\(|providers\.\w+.*\.generate\(/);
      if (rel !== "modules/ai/anthropic.provider.ts") expect(text, rel).not.toMatch(/new Anthropic\(|from "@anthropic-ai\/sdk"/);
    }
  });
});

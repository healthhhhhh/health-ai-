import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compareToUsual, dailyHealthContext, formatValue, relevantMetrics } from "../src/modules/health-data/daily-health-context";
import type { DailyRecord } from "../src/modules/health-data/health-data.service";
import { MemoryService } from "../src/modules/memory/memory.service";
import {
  categorize,
  CONTEXT_BUDGET,
  questionCategories,
  renderMemoryContext,
  selectMemoriesForContext,
  temporalStatus,
  timeWeight,
  type MemoryCandidate,
} from "../src/modules/memory/memory-retrieval";
import { limitPast } from "../src/modules/profile/profile.service";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

const today = "2026-09-30";
const candidate = (id: string, overrides: Partial<MemoryCandidate> = {}): MemoryCandidate => ({
  id,
  fact: `Fact ${id}`,
  status: "user_reported",
  occurredOn: null,
  endedOn: null,
  createdAt: "2026-09-01T10:00:00.000Z",
  category: "other",
  aiExcluded: false,
  ...overrides,
});

describe("memory retrieval (pure)", () => {
  it("categorises facts and questions deterministically", () => {
    expect(categorize("Allergic to penicillin")).toBe("allergy");
    expect(categorize("Takes 10mg of something each morning")).toBe("medication");
    expect(categorize("Diagnosed with asthma as a child")).toBe("condition");
    expect(categorize("Evening headaches after screen time")).toBe("symptom");
    expect(categorize("My mother had diabetes")).toBe("family_history");
    expect(categorize("Walks the dog every morning")).toBe("lifestyle");
    expect(categorize("Likes blue")).toBe("other");
    expect(questionCategories("Can I take ibuprofen for this headache?")).toEqual(["medication", "symptom"]);
  });

  it("derives current, historical and superseded status from dates", () => {
    expect(temporalStatus({ status: "user_reported", endedOn: null }, today)).toBe("current");
    expect(temporalStatus({ status: "user_reported", endedOn: "2026-10-05" }, today)).toBe("current");
    expect(temporalStatus({ status: "user_reported", endedOn: "2026-09-30" }, today)).toBe("historical");
    expect(temporalStatus({ status: "superseded", endedOn: null }, today)).toBe("superseded");
  });

  it("lets old history fade without disappearing, and never fades current facts", () => {
    expect(timeWeight({ createdAt: "2010-01-01T00:00:00Z" }, "current", today)).toBe(1);
    expect(timeWeight({ endedOn: "2024-09-30", createdAt: "2020-01-01T00:00:00Z" }, "historical", today)).toBeCloseTo(0.5, 1);
    expect(timeWeight({ endedOn: "1990-01-01", createdAt: "1990-01-01T00:00:00Z" }, "historical", today)).toBe(0.15);
  });

  it("ranks relevant, trusted, current facts first and never includes corrected or excluded ones", () => {
    const selected = selectMemoriesForContext(
      [
        candidate("relevant-confirmed", { status: "user_confirmed", similarity: 0.9 }),
        candidate("relevant-inferred", { status: "ai_inferred", similarity: 0.9 }),
        candidate("recent-only", { recent: true }),
        candidate("old-history", { similarity: 0.9, endedOn: "2016-01-01" }),
        candidate("corrected", { status: "superseded", similarity: 1 }),
        candidate("excluded", { aiExcluded: true, similarity: 1 }),
        candidate("inferred-not-relevant", { status: "ai_inferred", recent: true }),
      ],
      today,
    );
    const ids = selected.map((m) => m.id);
    expect(ids[0]).toBe("relevant-confirmed");
    expect(ids).toContain("relevant-inferred");
    expect(ids.indexOf("relevant-inferred")).toBeGreaterThan(0); // below confirmed facts
    expect(ids).not.toContain("corrected");
    expect(ids).not.toContain("excluded");
    expect(ids).not.toContain("inferred-not-relevant"); // unconfirmed and merely recent: left out
    expect(selected.find((m) => m.id === "old-history")?.temporalStatus).toBe("historical");
  });

  it("merges the same fact found by several retrievers", () => {
    const selected = selectMemoriesForContext([candidate("a", { textRank: 0.1 }), candidate("a", { similarity: 0.8, categoryMatch: true })], today);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({ similarity: 0.8, textRank: 0.1, categoryMatch: true });
  });

  it("never sends the whole history: at most 12 facts within the character budget", () => {
    const many = Array.from({ length: 400 }, (_, i) => candidate(`m${i}`, { fact: `Long remembered fact number ${i} `.repeat(4), similarity: 0.5 + (i % 50) / 100 }));
    const selected = selectMemoriesForContext(many, today);
    expect(selected.length).toBeLessThanOrEqual(CONTEXT_BUDGET.maxItems);
    expect(renderMemoryContext(selected, today).length).toBeLessThan(CONTEXT_BUDGET.maxChars + 200);
  });

  it("separates current facts from past ones in the prompt, with source and date", () => {
    const selected = selectMemoriesForContext(
      [
        candidate("now", { fact: "Takes a daily walk", similarity: 0.8, occurredOn: "2026-06-30" }),
        candidate("then", { fact: "Ran marathons", similarity: 0.8, occurredOn: "2019-01-01", endedOn: "2021-01-01" }),
      ],
      today,
    );
    const text = renderMemoryContext(selected, today);
    expect(text).toMatch(/^Current:\n- User reported: Takes a daily walk \(about 3 months ago, 2026-06-30\)/);
    expect(text).toContain("Past (no longer current — use only as history):\n- User reported: Ran marathons (about 8 years ago, 2019-01-01; no longer current since 2021-01-01)");
    expect(renderMemoryContext([], today)).toBe("Current:\n- none relevant");
  });

  it("keeps only the relevant and most recent past items from the record", () => {
    const meds = Array.from({ length: 12 }, (_, i) => ({ name: `Med ${String.fromCharCode(65 + i)}`, stopped: `2020-01-${String(i + 1).padStart(2, "0")}` }));
    const { items, hidden } = limitPast(meds, (m) => m.name, (m) => m.stopped, "Is Med A still in my system?");
    expect(items[0]!.name).toBe("Med A"); // mentioned in the question
    expect(items.map((m) => m.name).slice(1)).toEqual(["Med L", "Med K", "Med J", "Med I"]); // most recent
    expect(hidden).toBe(7);
  });
});

describe("daily health context (pure)", () => {
  const record = (day: string, kind: DailyRecord["kind"], value: number, extra: Partial<DailyRecord> = {}): DailyRecord => ({
    day, kind, unit: "", value, min: null, max: null, sampleCount: null, source: "apple_health", isComplete: true, timeZone: "UTC", updatedAt: "", ...extra,
  });
  const day = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);

  it("picks the metrics a question is about", () => {
    expect(relevantMetrics("Why am I so tired lately?")).toEqual(expect.arrayContaining(["sleep", "steps", "resting_heart_rate"]));
    expect(relevantMetrics("my heart is racing")).toEqual(["heart_rate", "resting_heart_rate"]);
    expect(relevantMetrics("Can I take paracetamol?")).toEqual([]);
  });

  it("compares the last week with the person's usual range, never with 'normal'", () => {
    const records = [
      ...Array.from({ length: 30 }, (_, i) => record(day(-37 + i), "sleep", 420 + (i % 3) * 10)),
      ...Array.from({ length: 7 }, (_, i) => record(day(-7 + i), "sleep", 360)),
      record(today, "sleep", 100, { isComplete: false }), // today, in progress: ignored
    ];
    const { lines, metrics } = dailyHealthContext(records, ["sleep", "steps"], today);
    expect(metrics).toEqual(["sleep"]); // no step data: nothing said about steps
    expect(lines[0]).toBe(`Sleep (Apple Health): average 6 h 0 min over 7 days of the last 7 (${day(-7)} to ${day(-1)}) — below your usual range (usual about 7 h 10 min over the previous 30 days)`);
    expect(lines.join(" ")).not.toMatch(/\b(normal|abnormal|healthy)\b/i);
  });

  it("says when there isn't enough history to compare", () => {
    expect(compareToUsual([1, 2, 3], [1, 2])).toBe("unknown");
    expect(compareToUsual([10, 10, 10], [10, 10, 11, 9, 10, 10, 10])).toBe("within");
    const { lines } = dailyHealthContext([record(day(-1), "steps", 5000), record(day(-2), "steps", 7000)], ["steps"], today);
    expect(lines[0]).toContain("not enough earlier data to compare with your usual range");
    expect(formatValue("weight", 70.26)).toBe("70.3 kg");
  });
});

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe("memory lifecycle and controls (API)", () => {
  it("keeps facts for years with current, historical and superseded status, and filters by them", async () => {
    const user = await signUp(ctx);
    const current = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Allergic to penicillin", occurredOn: "2015-03-01" }).expect(201)).body;
    expect(current).toMatchObject({ category: "allergy", temporalStatus: "current", aiExcluded: false, lastUsedAt: null });
    const past = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Played football twice a week", occurredOn: "2010-09-01", endedOn: "2018-06-01" }).expect(201)).body;
    expect(past.temporalStatus).toBe("historical");
    const wrong = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Broke left arm" }).expect(201)).body;
    await ctx.http.post(`/v1/memories/${wrong.id}/supersede`).set(user.auth).send({ fact: "Broke right arm" }).expect(201);

    const list = async (q: string) => (await ctx.http.get(`/v1/memories${q}`).set(user.auth).expect(200)).body.map((m: { fact: string }) => m.fact).sort();
    expect(await list("?status=current")).toEqual(["Allergic to penicillin", "Broke right arm"]);
    expect(await list("?status=historical")).toEqual(["Played football twice a week"]);
    expect(await list("?status=superseded")).toEqual(["Broke left arm"]);
    expect(await list("")).toHaveLength(4); // everything by default, history included
    expect(await list("?category=allergy")).toEqual(["Allergic to penicillin"]);

    // "No longer true" makes it history without changing where it came from.
    const ended = (await ctx.http.post(`/v1/memories/${current.id}/end`).set(user.auth).send({}).expect(200)).body;
    expect(ended).toMatchObject({ temporalStatus: "historical", status: "user_reported" });
    await ctx.http.post(`/v1/memories/${past.id}/end`).set(user.auth).send({ endedOn: "2000-01-01" }).expect(400); // before it started

    // The correction chain, oldest first.
    const history = (await ctx.http.get(`/v1/memories/${wrong.id}/history`).set(user.auth).expect(200)).body;
    expect(history.map((m: { fact: string; temporalStatus: string }) => `${m.fact}:${m.temporalStatus}`)).toEqual(["Broke left arm:superseded", "Broke right arm:current"]);
  });

  it("lets people keep a fact but stop the AI using it, without confirming or changing it", async () => {
    const user = await signUp(ctx);
    const memories = ctx.app.get(MemoryService);
    const inferred = await memories.create(user.userId, { fact: "Often sleeps badly", source: "user_conversation", status: "ai_inferred", confidence: 0.5 });
    const excluded = (await ctx.http.patch(`/v1/memories/${inferred.id}`).set(user.auth).send({ aiExcluded: true }).expect(200)).body;
    expect(excluded).toMatchObject({ aiExcluded: true, status: "ai_inferred", confirmedAt: null }); // not confirmed by this
    await ctx.drainJobs();
    expect((await memories.relevant(user.userId, "Why do I sleep badly?")).map((m) => m.id)).not.toContain(inferred.id);
    await ctx.http.patch(`/v1/memories/${inferred.id}`).set(user.auth).send({ aiExcluded: false }).expect(200);
    expect((await memories.relevant(user.userId, "Why do I sleep badly?")).map((m) => m.id)).toContain(inferred.id);
  });

  it("deletes everything only with an explicit confirmation, and only the person's own", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "One" }).expect(201);
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Two" }).expect(201);
    const kept = (await ctx.http.post("/v1/memories").set(other.auth).send({ fact: "Someone else's" }).expect(201)).body;
    await ctx.http.delete("/v1/memories").set(user.auth).send({}).expect(400);
    await ctx.http.delete("/v1/memories").set(user.auth).send({ confirm: "yes" }).expect(400);
    expect((await ctx.http.delete("/v1/memories").set(user.auth).send({ confirm: "delete all memories" }).expect(200)).body).toEqual({ removed: 2 });
    expect((await ctx.http.get("/v1/memories").set(user.auth).expect(200)).body).toEqual([]);
    expect((await ctx.http.get("/v1/memories").set(other.auth).expect(200)).body.map((m: { id: string }) => m.id)).toEqual([kept.id]);
    await ctx.http.get(`/v1/memories/${kept.id}/history`).set(user.auth).expect(404);
    await ctx.http.post(`/v1/memories/${kept.id}/end`).set(user.auth).send({}).expect(404);
  });
});

describe("AI chat with long-term memory", () => {
  it("retrieves only relevant history — with source, date and current/past — and says what it used", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(other.auth).send({ fact: "Other person's headaches" }).expect(201);
    const headaches = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Evening headaches after screen time", occurredOn: "2026-06-30" }).expect(201)).body;
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Frequent headaches as a teenager", occurredOn: "2008-01-01", endedOn: "2012-01-01" }).expect(201);
    const excluded = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Headache diary kept privately" }).expect(201)).body;
    await ctx.http.patch(`/v1/memories/${excluded.id}`).set(user.auth).send({ aiExcluded: true }).expect(200);
    // Years of unrelated history the model must not receive.
    for (let i = 0; i < 60; i++) await ctx.app.get(MemoryService).create(user.userId, { fact: `Unrelated gardening note ${i}`, source: "user_entry", status: "user_reported" });
    await ctx.drainJobs();

    ctx.ai.on("chat", () => chatAnswer({ memorySuggestions: [] }));
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "My headache is back this evening" }).expect(201);
    const system = ctx.ai.requests.at(-1)!.system.join("\n");
    expect(system).toMatch(/Current:\n[\s\S]*User reported: Evening headaches after screen time \(about 3 months ago, 2026-06-30\)/);
    expect(system).toMatch(/Past \(no longer current — use only as history\):\n[\s\S]*Frequent headaches as a teenager/);
    expect(system).not.toContain("Other person's headaches");
    expect(system).not.toContain("Headache diary kept privately");
    expect((system.match(/Unrelated gardening note/g) ?? []).length).toBeLessThanOrEqual(4); // a few recent facts at most, never all 60

    const payload = res.body.messages[1].payload;
    expect(payload.context.memories.map((m: { fact: string }) => m.fact)).toContain("Evening headaches after screen time");
    expect(payload.context.memories.find((m: { fact: string }) => m.fact === "Frequent headaches as a teenager")?.temporalStatus).toBe("historical");
    expect(payload.context.memories.length).toBeLessThanOrEqual(CONTEXT_BUDGET.maxItems);
    const used = (await ctx.http.get("/v1/memories?status=current").set(user.auth).expect(200)).body.find((m: { id: string }) => m.id === headaches.id);
    expect(used.lastUsedAt).not.toBeNull();
  });

  it("adds a usual-range summary of relevant daily health data, and nothing when it isn't relevant", async () => {
    const user = await signUp(ctx);
    const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    const records = [
      ...Array.from({ length: 30 }, (_, i) => ({ day: dayAgo(37 - i), kind: "sleep", value: 450, isComplete: true, computedAt: new Date().toISOString() })),
      ...Array.from({ length: 7 }, (_, i) => ({ day: dayAgo(7 - i), kind: "sleep", value: 330, isComplete: true, computedAt: new Date().toISOString() })),
    ];
    await ctx.http.put("/v1/health-data/daily").set(user.auth).send({ timeZone: "UTC", records }).expect(200);
    ctx.ai.on("chat", () => chatAnswer({ memorySuggestions: [] }));
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Why am I so tired lately?" }).expect(201);
    let system = ctx.ai.requests.at(-1)!.system.join("\n");
    expect(system).toMatch(/Sleep \(Apple Health\): average 5 h 30 min over 7 days of the last 7 .* — below your usual range \(usual about 7 h 30 min/);
    expect(res.body.messages[1].payload.context.healthMetrics).toEqual(["sleep"]);
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Can I take paracetamol with food?" }).expect(201);
    system = ctx.ai.requests.at(-1)!.system.join("\n");
    expect(system).toContain("Daily health data relevant to this question:\n- none relevant");
  });

  it("gives an emergency fixed guidance without calling the model or retrieving history", async () => {
    const user = await signUp(ctx);
    const before = ctx.ai.requests.length;
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have crushing chest pain and can't breathe" }).expect(201);
    expect(res.body.messages[1].payload.kind).toBe("escalation");
    expect(ctx.ai.requests.length).toBe(before);
  });
});

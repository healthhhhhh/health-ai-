import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(() => {
  ctx.ai.requests.length = 0;
  ctx.ai.available = true;
  ctx.ai.on("chat", () => chatAnswer());
});

describe("chat safety pipeline", () => {
  it("requires AI consent", async () => {
    const user = await signUp(ctx, []);
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "hello" }).expect(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("answers routine questions with structured follow-ups and persists the exchange", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I've had a headache and mild fever since yesterday" }).expect(201);
    const [, assistant] = res.body.messages;
    expect(assistant.payload.kind).toBe("answer");
    expect(assistant.payload.followUp.options).toEqual(["Mild", "Moderate", "Severe"]);
    const convo = await ctx.http.get(`/v1/conversations/${res.body.conversation.id}`).set(user.auth).expect(200);
    expect(convo.body.messages).toHaveLength(2);
    // Memory suggestions are returned, never saved automatically.
    const memories = await ctx.http.get("/v1/memories").set(user.auth).expect(200);
    expect(memories.body).toHaveLength(0);
  });

  it("escalates emergencies with fixed copy and never calls the model", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have crushing chest pain and I can't breathe" }).expect(201);
    const assistant = res.body.messages[1];
    expect(assistant.payload.kind).toBe("escalation");
    expect(assistant.payload.escalation.actions[0].kind).toBe("call_emergency");
    expect(ctx.ai.requests).toHaveLength(0);
    const events = await ctx.db.query<{ level: string }>(`SELECT level FROM safety_events WHERE user_id = $1`, [user.userId]);
    expect(events.rows[0]?.level).toBe("emergency");
  });

  it("forces an urgent care recommendation when triage says urgent", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have a high fever and a stiff neck" }).expect(201);
    const payload = res.body.messages[1].payload;
    expect(payload.careRecommendation.level).toBe("urgent");
    expect(payload.escalation.level).toBe("urgent");
    const system = ctx.ai.requests[0]!.system.join("\n");
    expect(system).toContain("automated safety check flagged");
  });

  it("adds the fixed notice for medication-change questions", async () => {
    const user = await signUp(ctx);
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Should I stop taking my blood pressure tablets?" }).expect(201);
    expect(res.body.messages[1].payload.notice).toContain("can't advise starting, stopping or changing");
  });

  it("rewrites unsafe answers, then falls back to a safe message", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("chat", () => chatAnswer({ answer: "You definitely have migraine. Take 800 mg of ibuprofen." }));
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "What is causing my headache?" }).expect(201);
    const payload = res.body.messages[1].payload;
    expect(ctx.ai.requests).toHaveLength(2); // original + one rewrite attempt
    expect(payload.safetyAdjusted).toBe(true);
    expect(payload.answer).not.toContain("800 mg");
  });

  it("says plainly when the AI is unavailable and saves nothing", async () => {
    const user = await signUp(ctx);
    ctx.ai.available = false;
    const res = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Why do I feel tired?" }).expect(503);
    expect(res.body.error.code).toBe("ai_unavailable");
    const list = await ctx.http.get("/v1/conversations").set(user.auth).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it("includes only this user's confirmed context, labelled with its source", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(other.auth).send({ fact: "Other user secret fact" }).expect(201);
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Gets migraines when dehydrated", status: "user_confirmed" }).expect(201);
    await ctx.http.post("/v1/me/medications").set(user.auth).send({ name: "Evening tablet", instruction: "One at night", source: "clinician_provided" }).expect(201);
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "migraine again today" }).expect(201);
    const system = ctx.ai.requests[0]!.system.join("\n");
    expect(system).toContain("User confirmed: Gets migraines when dehydrated (recorded today");
    expect(system).toContain('"One at night" [clinician_provided]');
    expect(system).not.toContain("Other user secret fact");
  });

  it("continues a conversation with history, starting from a user turn", async () => {
    const user = await signUp(ctx);
    const first = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have a headache" }).expect(201);
    await ctx.http.post(`/v1/conversations/${first.body.conversation.id}/messages`).set(user.auth).send({ message: "Moderate" }).expect(201);
    const last = ctx.ai.requests.at(-1)!;
    expect(last.messages[0]!.role).toBe("user");
    expect(last.messages.at(-1)!.content).toBe("Moderate");
  });
});

describe("memories", () => {
  it("confirming or editing a memory marks it user_confirmed; search works", async () => {
    const user = await signUp(ctx);
    const created = await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Allergic to penicillin (rash)" }).expect(201);
    expect(created.body.status).toBe("user_reported");
    const edited = await ctx.http.patch(`/v1/memories/${created.body.id}`).set(user.auth).send({ fact: "Allergic to penicillin (hives)" }).expect(200);
    expect(edited.body.status).toBe("user_confirmed");
    const found = await ctx.http.get("/v1/memories?q=penicillin").set(user.auth).expect(200);
    expect(found.body).toHaveLength(1);
  });

  it("does not let clients create AI-inferred memories", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Has diabetes", status: "ai_inferred" }).expect(400);
  });
});

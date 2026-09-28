import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe("timeline", () => {
  it("adds, lists newest first and deletes the person's own entries", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/timeline").set(user.auth).send({ eventType: "symptom", title: "Headache", occurredAt: "2026-09-01T09:00:00Z" }).expect(201);
    await ctx.http.post("/v1/timeline").set(user.auth).send({ eventType: "note", title: "Slept badly", occurredAt: "2026-09-02T09:00:00Z" }).expect(201);
    const list = await ctx.http.get("/v1/timeline").set(user.auth).expect(200);
    expect(list.body.events.map((e: { title: string }) => e.title)).toEqual(["Slept badly", "Headache"]);
    expect(list.body.events[0].sourceType).toBe("user_entered");

    await ctx.http.delete(`/v1/timeline/${list.body.events[0].id}`).set(user.auth).expect(204);
    const after = await ctx.http.get("/v1/timeline").set(user.auth).expect(200);
    expect(after.body.events).toHaveLength(1);
  });

  it("only accepts entry types a person may add", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/timeline").set(user.auth).send({ eventType: "report", title: "Fake lab report" }).expect(400);
  });
});

describe("cross-user isolation", () => {
  it("never lets one person read or delete another person's data", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);

    const memory = await ctx.http.post("/v1/memories").set(owner.auth).send({ fact: "Allergic to peanuts", status: "user_reported" }).expect(201);
    const entry = await ctx.http.post("/v1/timeline").set(owner.auth).send({ eventType: "symptom", title: "Rash" }).expect(201);
    ctx.ai.on("chat", () => chatAnswer());
    const convo = await ctx.http.post("/v1/conversations").set(owner.auth).send({ message: "I have a mild headache" }).expect(201);

    expect((await ctx.http.get("/v1/memories").set(other.auth).expect(200)).body).toEqual([]);
    expect((await ctx.http.get("/v1/timeline").set(other.auth).expect(200)).body.events).toEqual([]);
    expect((await ctx.http.get("/v1/conversations").set(other.auth).expect(200)).body).toEqual([]);

    await ctx.http.get(`/v1/conversations/${convo.body.conversation.id}`).set(other.auth).expect(404);
    await ctx.http.delete(`/v1/memories/${memory.body.id}`).set(other.auth).expect(404);
    await ctx.http.delete(`/v1/timeline/${entry.body.id}`).set(other.auth).expect(404);
    await ctx.http.delete(`/v1/conversations/${convo.body.conversation.id}`).set(other.auth).expect(404);

    // Still there for the owner.
    expect((await ctx.http.get("/v1/memories").set(owner.auth).expect(200)).body).toHaveLength(1);
    expect((await ctx.http.get("/v1/timeline").set(owner.auth).expect(200)).body.events.length).toBeGreaterThan(0);
    await ctx.http.get(`/v1/conversations/${convo.body.conversation.id}`).set(owner.auth).expect(200);
  });
});

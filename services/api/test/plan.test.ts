import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const item = (overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  title: "Evening walk",
  notes: null,
  kind: "habit",
  time: "19:00",
  repeat: { type: "daily" },
  reminderEnabled: true,
  source: "user_reported",
  instruction: null,
  startDay: "2026-09-01",
  endDay: null,
  createdAt: "2026-09-01T08:00:00Z",
  ...overrides,
});

describe("plan", () => {
  it("starts empty, saves with revisions and rejects stale writes", async () => {
    const user = await signUp(ctx);
    expect((await ctx.http.get("/v1/plan").set(user.auth).expect(200)).body).toMatchObject({ revision: 0, items: [], completions: [] });

    const walk = item();
    const first = await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 0, items: [walk], completions: [] }).expect(200);
    expect(first.body.revision).toBe(1);

    const done = { itemId: walk.id, day: "2026-09-28", completedAt: "2026-09-28T19:30:00Z" };
    const second = await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 1, items: [walk], completions: [done] }).expect(200);
    expect(second.body.revision).toBe(2);

    const stale = await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 1, items: [], completions: [] }).expect(409);
    expect(stale.body.error.code).toBe("plan_conflict");
    expect((await ctx.http.get("/v1/plan").set(user.auth).expect(200)).body.completions).toEqual([done]);
  });

  it("keeps medication instructions verbatim and requires them", async () => {
    const user = await signUp(ctx);
    const instruction = "  Take 1 tablet (500 mg) twice daily with food — per Dr. Rao  ";
    await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 0, items: [item({ kind: "medication", title: "Metformin", instruction: null })], completions: [] }).expect(400);
    const med = item({ kind: "medication", title: "Metformin", instruction, source: "clinician_provided" });
    await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 0, items: [med], completions: [] }).expect(200);
    expect((await ctx.http.get("/v1/plan").set(user.auth).expect(200)).body.items[0].instruction).toBe(instruction);
  });

  it("rejects sample items and drops completions for deleted items", async () => {
    const user = await signUp(ctx);
    await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 0, items: [item({ source: "sample" })], completions: [] }).expect(400);
    const kept = item();
    const res = await ctx.http
      .put("/v1/plan")
      .set(user.auth)
      .send({ baseRevision: 0, items: [kept], completions: [{ itemId: randomUUID(), day: "2026-09-28", completedAt: "2026-09-28T10:00:00Z" }] })
      .expect(200);
    expect(res.body.completions).toEqual([]);
  });

  it("is private to each person", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);
    await ctx.http.put("/v1/plan").set(owner.auth).send({ baseRevision: 0, items: [item()], completions: [] }).expect(200);
    expect((await ctx.http.get("/v1/plan").set(other.auth).expect(200)).body.items).toEqual([]);
    await ctx.http.get("/v1/plan").expect(401);
  });
});

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

    const done = { itemId: walk.id, day: "2026-09-28", completedAt: "2026-09-28T19:30:00.000Z" };
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

  it("stores items, completions and reminders in their own tables", async () => {
    const user = await signUp(ctx);
    const walk = item({ repeat: { type: "weekdays", days: [5, 1, 3] }, time: "07:15" });
    const once = item({ title: "Book blood test", kind: "task", repeat: { type: "once", day: "2026-10-02" }, reminderEnabled: false });
    await ctx.http
      .put("/v1/plan")
      .set(user.auth)
      .send({ baseRevision: 0, items: [walk, once], completions: [{ itemId: walk.id, day: "2026-09-28", completedAt: "2026-09-28T07:20:00Z" }] })
      .expect(200);
    const { rows } = await ctx.db.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM plan_items WHERE user_id = $1) * 100 + (SELECT count(*) FROM task_completions WHERE user_id = $1) * 10 + (SELECT count(*) FROM reminders WHERE user_id = $1))::int AS n`,
      [user.userId],
    );
    expect(rows[0]!.n).toBe(212);
    const plan = (await ctx.http.get("/v1/plan").set(user.auth).expect(200)).body;
    expect(plan.items.map((i: { title: string }) => i.title)).toEqual(["Evening walk", "Book blood test"]);
    expect(plan.items[0]).toMatchObject({ time: "07:15", repeat: { type: "weekdays", days: [1, 3, 5] } });
    expect(plan.items[1].repeat).toEqual({ type: "once", day: "2026-10-02" });
    const reminders = (await ctx.http.get("/v1/reminders").set(user.auth).expect(200)).body;
    expect(reminders).toEqual([
      expect.objectContaining({ planItemId: walk.id, time: "07:15", enabled: true, channel: "device" }),
      expect.objectContaining({ planItemId: once.id, enabled: false }),
    ]);
    // Removing an item removes its completions and reminder.
    await ctx.http.put("/v1/plan").set(user.auth).send({ baseRevision: 1, items: [once], completions: [] }).expect(200);
    expect((await ctx.http.get("/v1/reminders").set(user.auth).expect(200)).body).toHaveLength(1);
  });

  it("never lets one account overwrite another's item by reusing its id", async () => {
    const owner = await signUp(ctx);
    const attacker = await signUp(ctx);
    const mine = item({ title: "Owner's item" });
    await ctx.http.put("/v1/plan").set(owner.auth).send({ baseRevision: 0, items: [mine], completions: [] }).expect(200);
    await ctx.http.put("/v1/plan").set(attacker.auth).send({ baseRevision: 0, items: [{ ...mine, title: "Hijacked" }], completions: [] }).expect(400);
    expect((await ctx.http.get("/v1/plan").set(owner.auth).expect(200)).body.items[0].title).toBe("Owner's item");
    // The failed write rolled back entirely: the attacker's plan is still empty at revision 0.
    expect((await ctx.http.get("/v1/plan").set(attacker.auth).expect(200)).body).toMatchObject({ revision: 0, items: [] });
  });

  it("is private to each person", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);
    await ctx.http.put("/v1/plan").set(owner.auth).send({ baseRevision: 0, items: [item()], completions: [] }).expect(200);
    expect((await ctx.http.get("/v1/plan").set(other.auth).expect(200)).body.items).toEqual([]);
    await ctx.http.get("/v1/plan").expect(401);
  });
});

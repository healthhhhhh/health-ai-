import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryService } from "../src/modules/memory/memory.service";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

let ctx: TestContext;
let memories: MemoryService;
beforeAll(async () => {
  ctx = await createTestContext();
  memories = ctx.app.get(MemoryService);
});
afterAll(async () => {
  await ctx.close();
});

const embedded = async (id: string) => (await ctx.db.query<{ e: boolean }>(`SELECT embedding IS NOT NULL AS e FROM health_memories WHERE id = $1`, [id])).rows[0]!.e;

describe("health memory", () => {
  it("embeds facts in the background and re-embeds edits", async () => {
    const user = await signUp(ctx);
    const memory = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Gets migraines after poor sleep" }).expect(201)).body;
    await ctx.drainJobs();
    expect(await embedded(memory.id)).toBe(true);
    await ctx.http.patch(`/v1/memories/${memory.id}`).set(user.auth).send({ fact: "Gets migraines after short nights" }).expect(200);
    await ctx.drainJobs();
    expect(await embedded(memory.id)).toBe(true);
    const { rows } = await ctx.db.query<{ n: number }>(`SELECT (embedding <=> (SELECT embedding FROM health_memories WHERE id = $1))::float8 AS n FROM health_memories WHERE id = $1`, [memory.id]);
    expect(rows[0]!.n).toBeCloseTo(0);
  });

  // The dev hash embedder only overlaps words; production uses gte-small.
  it("finds related facts by similarity, only within the person's own memories", async () => {
    const alice = await signUp(ctx);
    const bob = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(alice.auth).send({ fact: "Allergic to penicillin antibiotics" }).expect(201);
    await ctx.http.post("/v1/memories").set(alice.auth).send({ fact: "Walks the dog every morning" }).expect(201);
    await ctx.http.post("/v1/memories").set(bob.auth).send({ fact: "Allergic to penicillin" }).expect(201);
    await ctx.drainJobs();
    const aliceMatches = await memories.semanticMatches(alice.userId, "allergic to penicillin");
    expect(aliceMatches.map((m) => m.memory.fact)).toEqual(["Allergic to penicillin antibiotics"]);
    const bobMatches = await memories.semanticMatches(bob.userId, "allergic to penicillin");
    expect(bobMatches.map((m) => m.memory.fact)).toEqual(["Allergic to penicillin"]);
    const relevant = await memories.relevant(bob.userId, "Can I take antibiotics?");
    expect(relevant.every((m) => m.fact !== "Allergic to penicillin antibiotics")).toBe(true);
  });

  it("never lets the API create AI inferences or treat them as confirmed", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Might have diabetes", status: "ai_inferred" }).expect(400);
    const inferred = await memories.create(user.userId, { fact: "Often tired in the afternoon", source: "user_conversation", status: "ai_inferred", confidence: 0.5 });
    await ctx.drainJobs();
    // Similarity retrieval returns it, but still marked unconfirmed.
    const found = await memories.relevant(user.userId, "tired afternoon");
    expect(found.find((m) => m.id === inferred.id)?.status).toBe("ai_inferred");
    // It's passed to the model labelled as unconfirmed.
    ctx.ai.on("chat", () => chatAnswer({ memorySuggestions: [] }));
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Why am I tired in the afternoon?" }).expect(201);
    const prompt = ctx.ai.requests.at(-1)!.system.join("\n");
    expect(prompt).toContain("Unconfirmed AI inference — not verified; do not treat as fact: Often tired in the afternoon (recorded today");
    // Only the person's explicit confirmation changes it.
    const confirmed = (await ctx.http.patch(`/v1/memories/${inferred.id}`).set(user.auth).send({ confirm: true }).expect(200)).body;
    expect(confirmed.status).toBe("user_confirmed");
  });

  it("doesn't let one person confirm, edit or delete another's memory", async () => {
    const owner = await signUp(ctx);
    const other = await signUp(ctx);
    const inferred = await memories.create(owner.userId, { fact: "Sleeps badly", source: "user_conversation", status: "ai_inferred", confidence: 0.4 });
    await ctx.http.patch(`/v1/memories/${inferred.id}`).set(other.auth).send({ confirm: true }).expect(404);
    await ctx.http.delete(`/v1/memories/${inferred.id}`).set(other.auth).expect(404);
    expect((await ctx.db.query<{ status: string }>(`SELECT status FROM health_memories WHERE id = $1`, [inferred.id])).rows[0]!.status).toBe("ai_inferred");
  });
});

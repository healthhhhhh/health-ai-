import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { RedisRateLimitStore } from "../src/common/rate-limit";
import { BullJobQueue } from "../src/modules/documents/bull-queue";

// Runs against a real Redis (CI provides one); skipped when REDIS_URL isn't set.
const url = process.env.REDIS_URL;
const cleanup: (() => Promise<unknown>)[] = [];
afterAll(async () => {
  for (const fn of cleanup) await fn();
});

describe.skipIf(!url)("Redis", () => {
  it("shares fixed-window rate limits and resets them", async () => {
    const redis = new Redis(url!);
    const store = new RedisRateLimitStore(redis, `hm:test:${randomUUID()}:`);
    cleanup.push(() => store.close());
    const rule = { bucket: "t", limit: 2, windowMs: 60_000 };
    expect((await store.hit("k", rule)).allowed).toBe(true);
    expect((await store.hit("k", rule)).allowed).toBe(true);
    const blocked = await store.hit("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(50_000);
    expect((await store.hit("other", rule)).allowed).toBe(true);
    await store.reset();
    expect((await store.hit("k", rule)).allowed).toBe(true);
  });

  it("runs queued jobs with retries and de-duplicates by job id", async () => {
    const queue = new BullJobQueue(url!, { runWorker: true, prefix: `hm-test-${randomUUID()}` });
    cleanup.push(() => queue.onApplicationShutdown());
    const seen: string[] = [];
    let failures = 0;
    queue.register("embed-memory", async ({ memoryId }) => {
      if (memoryId === "flaky" && failures++ === 0) throw new Error("transient");
      seen.push(memoryId);
    });
    await queue.enqueue("embed-memory", { userId: "u", memoryId: "a" }, { jobId: "same" });
    await queue.enqueue("embed-memory", { userId: "u", memoryId: "a-duplicate" }, { jobId: "same" });
    await queue.enqueue("embed-memory", { userId: "u", memoryId: "flaky" }, { attempts: 3 });
    await waitFor(() => seen.length >= 2, 15_000);
    await queue.drain();
    expect(seen.sort()).toEqual(["a", "flaky"]);
    expect(failures).toBe(2);
  }, 20_000);
});

async function waitFor(condition: () => boolean, timeoutMs: number) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
}

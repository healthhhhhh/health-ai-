import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migrate } from "../src/db/database";
import { createTestContext, signUp, type TestContext } from "./helpers";

/** Phase 2B: daily health records from Apple Health, sync runs and history import. */
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const record = (day: string, kind: string, value: number, extra: Record<string, unknown> = {}) => ({
  day,
  kind,
  value,
  isComplete: true,
  computedAt: new Date().toISOString(),
  ...extra,
});
const upload = (auth: Record<string, string>, records: unknown[], extra: Record<string, unknown> = {}) =>
  ctx.http.put("/v1/health-data/daily").set(auth).send({ timeZone: "UTC", sourceDevice: "iPhone", records, ...extra });

describe("daily health records", () => {
  it("corrects a day when newer data arrives, and never lets older data overwrite it", async () => {
    const user = await signUp(ctx);
    const day = dayAgo(1);
    const noon = `${day}T12:00:00Z`;
    const evening = `${day}T23:00:00Z`;
    // Synced at noon while the day was in progress…
    let res = (await upload(user.auth, [record(day, "steps", 3000, { isComplete: false, computedAt: noon })]).expect(200)).body;
    expect(res).toEqual({ upserted: 1, unchanged: 0, ignoredOlder: 0 });
    // …then the Watch caught up and the day finished.
    res = (await upload(user.auth, [record(day, "steps", 9500, { computedAt: evening, min: 0, max: 1200, sampleCount: 80 })]).expect(200)).body;
    expect(res.upserted).toBe(1);
    // A delayed batch from before must not undo it.
    res = (await upload(user.auth, [record(day, "steps", 3000, { isComplete: false, computedAt: noon })]).expect(200)).body;
    expect(res).toEqual({ upserted: 0, unchanged: 0, ignoredOlder: 1 });
    // Re-sending the same value is a no-op.
    res = (await upload(user.auth, [record(day, "steps", 9500, { computedAt: new Date().toISOString(), min: 0, max: 1200, sampleCount: 80 })]).expect(200)).body;
    expect(res).toEqual({ upserted: 0, unchanged: 1, ignoredOlder: 0 });
    const daily = (await ctx.http.get(`/v1/health-data/daily?from=${day}&to=${day}`).set(user.auth).expect(200)).body.records;
    expect(daily).toEqual([expect.objectContaining({ day, kind: "steps", value: 9500, min: 0, max: 1200, sampleCount: 80, isComplete: true, source: "apple_health", unit: "count" })]);
  });

  it("keeps today in progress and shows it as the latest value", async () => {
    const user = await signUp(ctx);
    const today = new Date().toISOString().slice(0, 10);
    await upload(user.auth, [record(today, "steps", 2400, { isComplete: false })]).expect(200);
    const latest = (await ctx.http.get("/v1/health-data/latest").set(user.auth).expect(200)).body;
    expect(latest).toEqual([expect.objectContaining({ kind: "steps", value: 2400, source: "apple_health" })]);
    const trend = (await ctx.http.get("/v1/health-data/trends?kind=steps&days=7").set(user.auth).expect(200)).body;
    expect(trend.points).toEqual([expect.objectContaining({ date: today, value: 2400 })]);
  });

  it("prefers Apple Health's de-duplicated value for a day but keeps the person's own readings", async () => {
    const user = await signUp(ctx);
    const day = dayAgo(2);
    await ctx.http.post("/v1/health-data/measurements").set(user.auth).send({ measurements: [
      { kind: "weight", value: 70, recordedAt: `${day}T08:00:00Z`, source: "user_entered" },
      { kind: "weight", value: 72, recordedAt: `${day}T20:00:00Z`, source: "user_entered" },
      { kind: "water", value: 500, recordedAt: `${dayAgo(3)}T09:00:00Z`, source: "user_entered" },
      { kind: "water", value: 250, recordedAt: `${dayAgo(3)}T15:00:00Z`, source: "user_entered" },
    ] }).expect(201);
    let daily = (await ctx.http.get(`/v1/health-data/daily?from=${dayAgo(3)}&to=${day}`).set(user.auth).expect(200)).body.records;
    expect(daily).toEqual([
      expect.objectContaining({ day: dayAgo(3), kind: "water", value: 750, source: "user_entered", sampleCount: 2 }), // totals for cumulative kinds
      expect.objectContaining({ day, kind: "weight", value: 71, min: 70, max: 72, source: "user_entered" }), // averages for the rest
    ]);
    await upload(user.auth, [record(day, "weight", 70.5)]).expect(200);
    daily = (await ctx.http.get(`/v1/health-data/daily?from=${day}&to=${day}&kinds=weight`).set(user.auth).expect(200)).body.records;
    expect(daily).toEqual([expect.objectContaining({ value: 70.5, source: "apple_health" })]);
    const { rows } = await ctx.db.query(`SELECT source FROM daily_health_records WHERE user_id = $1 AND kind = 'weight' ORDER BY source`, [user.userId]);
    expect(rows).toEqual([{ source: "apple_health" }, { source: "user_entered" }]);
  });

  it("rejects implausible values, bad ranges and unknown time zones", async () => {
    const user = await signUp(ctx);
    await upload(user.auth, [record(dayAgo(1), "heart_rate", 900)]).expect(400);
    await upload(user.auth, [record(dayAgo(1), "sleep", 2000)]).expect(400); // more minutes than a day has
    await upload(user.auth, [record(dayAgo(1), "steps", 10, { min: 50, max: 5 })]).expect(400);
    await upload(user.auth, [record("2026-02-30", "steps", 10)]).expect(400);
    await upload(user.auth, [record(dayAgo(1), "steps", 10)], { timeZone: "Mars/Olympus" }).expect(400);
    await upload(user.auth, Array.from({ length: 501 }, (_, i) => record(dayAgo(i), "steps", 10))).expect(400);
    await ctx.http.get("/v1/health-data/daily?from=2025-01-01&to=2026-06-01").set(user.auth).expect(400); // over 400 days
    await ctx.http.get("/v1/health-data/daily?from=2026-06-01&to=2026-01-01").set(user.auth).expect(400);
  });

  it("keeps each person's daily data to themselves", async () => {
    const alice = await signUp(ctx);
    const bob = await signUp(ctx);
    await upload(alice.auth, [record(dayAgo(1), "steps", 12345)]).expect(200);
    expect((await ctx.http.get(`/v1/health-data/daily?from=${dayAgo(5)}&to=${dayAgo(0)}`).set(bob.auth).expect(200)).body.records).toEqual([]);
    expect((await ctx.http.get("/v1/health-data/latest").set(bob.auth).expect(200)).body).toEqual([]);
    await ctx.http.get(`/v1/health-data/daily?from=${dayAgo(5)}&to=${dayAgo(0)}`).expect(401);
    // A sync run belongs to its owner.
    const run = (await ctx.http.post("/v1/healthkit/sync-runs").set(alice.auth).send({ kind: "manual" }).expect(201)).body.id;
    await upload(bob.auth, [record(dayAgo(1), "steps", 1)], { syncRunId: run }).expect(404);
    await ctx.http.patch(`/v1/healthkit/sync-runs/${run}`).set(bob.auth).send({ status: "succeeded", daysSent: 1, recordsUpserted: 1 }).expect(404);
  });
});

describe("sync runs and history import", () => {
  it("tracks a history import through failure and resumption, with codes only", async () => {
    const user = await signUp(ctx);
    const deviceId = randomUUID();
    await ctx.http.put("/v1/healthkit/connection").set(user.auth).send({ deviceName: "iPhone", deviceId, scopes: ["steps", "sleep"], historyDays: 365 }).expect(200);
    let connection = (await ctx.http.get("/v1/healthkit/connection").set(user.auth).expect(200)).body;
    expect(connection.history).toEqual({ status: "not_started", from: null, daysRequested: 365 });

    // First attempt: the network drops part-way.
    const first = (await ctx.http.post("/v1/healthkit/sync-runs").set(user.auth).send({ kind: "initial_import", deviceId }).expect(201)).body.id;
    expect((await ctx.http.get("/v1/healthkit/connection").set(user.auth).expect(200)).body.history.status).toBe("importing");
    await upload(user.auth, [record(dayAgo(1), "steps", 8000)], { syncRunId: first }).expect(200);
    connection = (await ctx.http.patch(`/v1/healthkit/sync-runs/${first}`).set(user.auth).send({ status: "failed", daysSent: 1, recordsUpserted: 1, errorCode: "offline" }).expect(200)).body;
    expect(connection.history.status).toBe("failed");
    expect(connection.lastError).toEqual({ code: "offline", at: expect.any(String) });
    await ctx.http.patch(`/v1/healthkit/sync-runs/${first}`).set(user.auth).send({ status: "succeeded", daysSent: 1, recordsUpserted: 1 }).expect(404); // already finished

    // Resumed later and completed.
    const second = (await ctx.http.post("/v1/healthkit/sync-runs").set(user.auth).send({ kind: "initial_import", deviceId }).expect(201)).body.id;
    connection = (await ctx.http
      .patch(`/v1/healthkit/sync-runs/${second}`)
      .set(user.auth)
      .send({ status: "succeeded", daysSent: 364, recordsUpserted: 700, oldestDay: dayAgo(364), newestDay: dayAgo(0), historyComplete: true })
      .expect(200)).body;
    expect(connection).toMatchObject({ history: { status: "complete", from: dayAgo(364) }, lastError: null, lastSyncAt: expect.any(String) });

    // Error codes are codes, not free text (no health content can ride along).
    const third = (await ctx.http.post("/v1/healthkit/sync-runs").set(user.auth).send({ kind: "incremental" }).expect(201)).body.id;
    await ctx.http.patch(`/v1/healthkit/sync-runs/${third}`).set(user.auth).send({ status: "failed", daysSent: 0, recordsUpserted: 0, errorCode: "Heart rate 190 at 3am" }).expect(400);
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.healthSyncRuns.map((r: { status: string }) => r.status)).toEqual(["failed", "succeeded", "running"]);
    expect(exported.dailyHealth).toEqual([expect.objectContaining({ kind: "steps", value: 8000, source: "apple_health" })]);
  });

  it("requires the Apple Health sync consent and removes synced data on disconnect", async () => {
    const noConsent = await signUp(ctx, []);
    await ctx.http.post("/v1/healthkit/sync-runs").set(noConsent.auth).send({ kind: "manual" }).expect(403);
    const user = await signUp(ctx);
    await upload(user.auth, [record(dayAgo(1), "steps", 5000), record(dayAgo(1), "sleep", 420)]).expect(200);
    await ctx.http.post("/v1/health-data/measurements").set(user.auth).send({ measurements: [{ kind: "weight", value: 70, recordedAt: new Date().toISOString(), source: "user_entered" }] }).expect(201);
    const removed = (await ctx.http.delete("/v1/healthkit/connection").set(user.auth).expect(200)).body.removed;
    expect(removed).toBe(2);
    const left = (await ctx.http.get(`/v1/health-data/daily?from=${dayAgo(3)}&to=${dayAgo(0)}`).set(user.auth).expect(200)).body.records;
    expect(left.map((r: { kind: string; source: string }) => `${r.kind}:${r.source}`)).toEqual(["weight:user_entered"]); // their own readings stay
    expect((await ctx.http.get("/v1/healthkit/connection").set(user.auth).expect(200)).body).toMatchObject({ status: "disconnected", history: { status: "not_started" } });
  });
});

describe("migration 0009", () => {
  it("copies days synced by the previous iOS app and summarises readings people entered", async () => {
    const all = join(__dirname, "..", "migrations");
    const before = mkdtempSync(join(tmpdir(), "hm-migrations-"));
    for (const file of readdirSync(all).filter((f) => f < "0009")) copyFileSync(join(all, file), join(before, file));
    const db = await createDatabase({});
    try {
      await migrate(db, before);
      const id = randomUUID();
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'old@example.com')`, [id]);
      await db.query(`UPDATE profiles SET time_zone = 'America/New_York' WHERE user_id = $1`, [id]);
      await db.query(
        `INSERT INTO health_measurements (user_id, kind, value, unit, recorded_at, source, external_id) VALUES
           ($1, 'steps', 7000, 'count', '2026-08-01T16:00:00Z', 'apple_health', 'apple_health:steps:2026-08-01'),
           ($1, 'weight', 70, 'kg', '2026-08-02T02:00:00Z', 'user_entered', NULL),
           ($1, 'weight', 72, 'kg', '2026-08-02T03:00:00Z', 'user_entered', NULL)`,
        [id],
      );
      await migrate(db, all);
      const { rows } = await db.query(`SELECT day::text AS day, kind, value, source, is_complete, time_zone FROM daily_health_records WHERE user_id = $1 ORDER BY kind`, [id]);
      expect(rows).toEqual([
        { day: "2026-08-01", kind: "steps", value: 7000, source: "apple_health", is_complete: true, time_zone: "America/New_York" },
        // 02:00–03:00 UTC is the evening of 1 August in New York.
        { day: "2026-08-01", kind: "weight", value: 71, source: "user_entered", is_complete: true, time_zone: "America/New_York" },
      ]);
    } finally {
      await db.close();
    }
  });
});

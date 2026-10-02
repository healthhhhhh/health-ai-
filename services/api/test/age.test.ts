import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../src/common/rate-limit";
import { loadConfig } from "../src/config";
import { createDatabase, migrate } from "../src/db/database";
import { AGE_BANDS, AGE_SOURCES, AGE_STATUSES, assessBirthDate, bandForAge, completedYears, decide, isCalendarDay, latestDay, referenceDay } from "../src/modules/account/age";
import { AgeService } from "../src/modules/account/age.service";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

/** Age & consent Phase 2A: recording only. Synthetic data and the fake AI provider only. */

const NOW = new Date("2026-10-02T12:00:00Z"); // reference day (UTC−12): 2026-10-02

/** A date of birth `years` before today's reference day, shifted by `days`. */
function born(years: number, days = 0, now = new Date()): string {
  const [y, m, d] = referenceDay(now).split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y - years, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

describe("age bands (pure)", () => {
  it("uses the wire values shared with web and iOS (packages/shared-types, HealthMateCore AgeBand/AgeStatus)", () => {
    expect([...AGE_BANDS]).toEqual(["under_13", "13_15", "16_17", "adult"]);
    expect([...AGE_STATUSES]).toEqual(["unknown", "in_scope", "blocked_under_13", "blocked_out_of_scope", "review"]);
    expect([...AGE_SOURCES]).toEqual(["self_declared", "apple_declared_age_range", "app_store_signal", "support", "parent_declared"]);
  });

  it("counts ages on the earliest calendar date in effect anywhere (UTC−12)", () => {
    expect(referenceDay(new Date("2026-10-02T11:59:00Z"))).toBe("2026-10-01");
    expect(referenceDay(new Date("2026-10-02T12:00:00Z"))).toBe("2026-10-02");
    expect(latestDay(new Date("2026-10-02T09:59:00Z"))).toBe("2026-10-02");
    expect(latestDay(new Date("2026-10-02T10:00:00Z"))).toBe("2026-10-03");
  });

  it("only accepts real YYYY-MM-DD dates", () => {
    for (const ok of ["2000-01-01", "2024-02-29", "1999-12-31"]) expect(isCalendarDay(ok)).toBe(true);
    for (const bad of ["2023-02-29", "2026-02-30", "2026-13-01", "2026-00-10", "2026-1-1", "26-01-01", "2026-01-01T00:00:00Z", "abcd-ef-gh", "", " 2000-01-01"]) {
      expect(isCalendarDay(bad), bad).toBe(false);
    }
  });

  it("turns a year older on the birthday, not the day before", () => {
    expect(completedYears("2008-10-02", "2026-10-01")).toBe(17);
    expect(completedYears("2008-10-02", "2026-10-02")).toBe(18);
    expect(completedYears("2013-10-03", "2026-10-02")).toBe(12);
    expect(completedYears("2013-10-02", "2026-10-02")).toBe(13);
  });

  it("counts a 29 February birthday on 1 March in years without one", () => {
    expect(completedYears("2008-02-29", "2026-02-28")).toBe(17);
    expect(completedYears("2008-02-29", "2026-03-01")).toBe(18);
    expect(completedYears("2008-02-29", "2028-02-28")).toBe(19);
    expect(completedYears("2008-02-29", "2028-02-29")).toBe(20);
  });

  it("maps ages to bands at 13, 16 and 18", () => {
    expect([0, 12, 13, 15, 16, 17, 18, 90].map(bandForAge)).toEqual(["under_13", "under_13", "13_15", "13_15", "16_17", "16_17", "adult", "adult"]);
  });

  it("assesses dates of birth on the server, refusing future and implausible ones", () => {
    expect(assessBirthDate("2008-10-02", NOW)).toEqual({ band: "adult" });
    expect(assessBirthDate("2008-10-03", NOW)).toEqual({ band: "16_17" });
    expect(assessBirthDate("2010-10-03", NOW)).toEqual({ band: "13_15" });
    expect(assessBirthDate("2013-10-03", NOW)).toEqual({ band: "under_13" });
    expect(assessBirthDate("2026-10-03", NOW)).toEqual({ band: "under_13" }); // already today east of UTC−12
    expect(assessBirthDate("2026-10-05", NOW)).toEqual({ problem: "future" });
    expect(assessBirthDate("1850-01-01", NOW)).toEqual({ problem: "implausible" });
    expect(assessBirthDate("2023-02-29", NOW)).toEqual({ problem: "invalid" });
  });

  it("never lets a later assessment raise the band by itself (review policy)", () => {
    const adult = ["adult"] as const;
    expect(decide({ band: "unknown" }, "16_17", adult)).toEqual({ band: "16_17", status: "blocked_out_of_scope", outcome: "applied" });
    expect(decide({ band: "unknown" }, "under_13", adult)).toEqual({ band: "under_13", status: "blocked_under_13", outcome: "applied" });
    expect(decide({ band: "unknown" }, "adult", adult)).toEqual({ band: "adult", status: "in_scope", outcome: "applied" });
    expect(decide({ band: "13_15" }, "adult", adult)).toEqual({ band: "13_15", status: "review", outcome: "review" });
    expect(decide({ band: "adult" }, "13_15", adult)).toEqual({ band: "13_15", status: "blocked_out_of_scope", outcome: "applied" });
    expect(decide({ band: "16_17" }, "16_17", adult)).toEqual({ band: "16_17", status: "blocked_out_of_scope", outcome: "applied" });
  });
});

describe("configuration", () => {
  const config = (env: Record<string, string> = {}) => loadConfig({ NODE_ENV: "test", ...env } as NodeJS.ProcessEnv);

  it("records by default, with only adults enabled", () => {
    expect(config()).toMatchObject({ AGE_ENFORCEMENT: "record", enabledAgeBands: ["adult"] });
    expect(config({ AGE_ENFORCEMENT: "off" }).AGE_ENFORCEMENT).toBe("off");
  });

  it("refuses enforcement and minors' bands, which don't exist yet (production included)", () => {
    expect(() => config({ AGE_ENFORCEMENT: "enforce" })).toThrow(/isn't implemented/);
    expect(() => config({ ENABLED_AGE_BANDS: "adult,16_17" })).toThrow(/can only be adult/);
    expect(() => config({ ENABLED_AGE_BANDS: "under_13" })).toThrow(/can only be adult/);
    expect(() => config({ ENABLED_AGE_BANDS: "toddlers" })).toThrow(/unknown band/);
    expect(() => config({ NODE_ENV: "production", DATABASE_URL: "postgres://x", ENABLED_AGE_BANDS: "13_15", SUPABASE_URL: "https://x.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p", SUPABASE_SECRET_KEY: "s" })).toThrow(/can only be adult/);
  });
});

describe("POST /v1/me/age", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.app.get(RateLimiter).reset());

  const history = async (userId: string) =>
    (await ctx.db.query<{ band: string; source: string; outcome: string }>(`SELECT band, source, outcome FROM age_assessments WHERE user_id = $1 ORDER BY created_at`, [userId])).rows;
  const stored = async (userId: string) =>
    (await ctx.db.query<{ age_band: string; age_status: string; assessed: boolean }>(`SELECT age_band, age_status, age_assessed_at IS NOT NULL AS assessed FROM users WHERE id = $1`, [userId])).rows[0]!;

  it("requires a signed-in person", async () => {
    await ctx.http.post("/v1/me/age").send({ dateOfBirth: "1990-01-01" }).expect(401);
  });

  it("starts unknown, then records the band the server calculates", async () => {
    const user = await signUp(ctx);
    expect(await stored(user.userId)).toEqual({ age_band: "unknown", age_status: "unknown", assessed: false });
    const cases: [string, string, string][] = [
      [born(18), "adult", "in_scope"],
      [born(18, 1), "16_17", "blocked_out_of_scope"],
      [born(16, 1), "13_15", "blocked_out_of_scope"],
      [born(13, 1), "under_13", "blocked_under_13"],
    ];
    for (const [dateOfBirth, band, status] of cases) {
      const fresh = await signUp(ctx);
      const res = await ctx.http.post("/v1/me/age").set(fresh.auth).send({ dateOfBirth }).expect(200);
      expect(res.body).toMatchObject({ ageBand: band, ageStatus: status, outcome: "applied", assessedAt: expect.any(String) });
      expect(await stored(fresh.userId)).toEqual({ age_band: band, age_status: status, assessed: true });
      expect(await history(fresh.userId)).toEqual([{ band, source: "self_declared", outcome: "applied" }]);
    }
  });

  it("refuses invalid, future, malformed and impossible dates without recording anything", async () => {
    const user = await signUp(ctx);
    const tomorrowEverywhere = new Date(Date.parse(`${latestDay()}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    for (const dateOfBirth of ["2023-02-29", "2026-13-01", "1990-1-1", "01/02/1990", "1990-01-01T00:00:00Z", tomorrowEverywhere, "1800-01-01", ""]) {
      const res = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth }).expect(400);
      expect(res.body.error.code).toBe("validation_failed");
      if (dateOfBirth) expect(JSON.stringify(res.body)).not.toContain(dateOfBirth); // never echoed
    }
    for (const body of [{}, { dateOfBirth: 19900101 }, { dateOfBirth: null }]) await ctx.http.post("/v1/me/age").set(user.auth).send(body).expect(400);
    expect(await history(user.userId)).toEqual([]);
    expect((await stored(user.userId)).age_band).toBe("unknown");
  });

  it("won't take a band, status or unverified app-store signal from the client", async () => {
    const user = await signUp(ctx);
    for (const body of [
      { dateOfBirth: born(10), ageBand: "adult" },
      { dateOfBirth: born(10), ageStatus: "in_scope" },
      { dateOfBirth: born(10), source: "support" },
      { appleDeclaredAgeRange: { lowerBound: 18 } },
      { band: "adult" },
    ]) {
      await ctx.http.post("/v1/me/age").set(user.auth).send(body).expect(400);
    }
    expect(await history(user.userId)).toEqual([]);
  });

  it("holds an older band for review instead of upgrading, and a consistent answer clears the review", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(14) }).expect(200);
    const upgrade = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(30) }).expect(200);
    expect(upgrade.body).toMatchObject({ ageBand: "13_15", ageStatus: "review", outcome: "review" });
    expect(await stored(user.userId)).toMatchObject({ age_band: "13_15", age_status: "review" });
    const consistent = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(14) }).expect(200);
    expect(consistent.body).toMatchObject({ ageBand: "13_15", ageStatus: "blocked_out_of_scope", outcome: "applied" });
    const younger = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(9) }).expect(200);
    expect(younger.body).toMatchObject({ ageBand: "under_13", ageStatus: "blocked_under_13", outcome: "applied" });
    expect((await history(user.userId)).map((h) => `${h.band}:${h.outcome}`)).toEqual(["13_15:applied", "adult:review", "13_15:applied", "under_13:applied"]);
  });

  it("updates history and the account together, or not at all", async () => {
    const user = await signUp(ctx);
    const age = ctx.app.get(AgeService);
    // A history row that can't be written (invalid source) rolls the account update back too.
    await expect(age.record(user.userId, "adult", "not-a-source" as never)).rejects.toThrow();
    expect(await history(user.userId)).toEqual([]);
    expect(await stored(user.userId)).toEqual({ age_band: "unknown", age_status: "unknown", assessed: false });
    await expect(age.record(randomUUID(), "adult", "self_declared")).rejects.toMatchObject({ status: 404 });
    // Concurrent assessments apply one after the other.
    await Promise.all([born(30), born(40), born(14), born(50)].map((dateOfBirth) => ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth }).expect(200)));
    const rows = await history(user.userId);
    expect(rows).toHaveLength(4);
    const state = await stored(user.userId);
    expect(state.assessed).toBe(true);
    expect(["adult", "13_15"]).toContain(state.age_band);
  });

  it("isn't changed by editing the profile date of birth", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(15) }).expect(200);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: born(40) }).expect(200);
    expect(await stored(user.userId)).toMatchObject({ age_band: "13_15" });
    const profile = (await ctx.http.get("/v1/me").set(user.auth).expect(200)).body.profile;
    expect(profile.dateOfBirth).toBe(born(40)); // the profile field itself is untouched by age assessment
  });

  it("is exposed on the account, /v1/meta and the export — only the person's own history", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    const before = (await ctx.http.get("/v1/me/account").set(user.auth).expect(200)).body;
    expect(before).toMatchObject({ ageBand: "unknown", ageStatus: "unknown", ageAssessedAt: null });
    await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(35) }).expect(200);
    await ctx.http.post("/v1/me/age").set(other.auth).send({ dateOfBirth: born(15) }).expect(200);
    const after = (await ctx.http.get("/v1/me/account").set(user.auth).expect(200)).body;
    expect(after).toMatchObject({ ageBand: "adult", ageStatus: "in_scope", ageAssessedAt: expect.any(String) });

    expect((await ctx.http.get("/v1/meta").expect(200)).body.age).toEqual({ enforcement: "record", enabledBands: ["adult"], parentalConsent: false });

    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.account).toMatchObject({ age_band: "adult", age_status: "in_scope", age_assessed_at: expect.any(String) });
    expect(exported.ageAssessments).toEqual([{ band: "adult", source: "self_declared", outcome: "applied", created_at: expect.any(String) }]);
    expect(JSON.stringify(exported.ageAssessments)).not.toContain("13_15"); // the other person's history isn't included
  });

  it("restricts nothing and deletes nothing by age in this phase", async () => {
    const user = await signUp(ctx);
    ctx.ai.on("chat", () => chatAnswer());
    await ctx.http.post("/v1/me/conditions").set(user.auth).send({ name: "Synthetic condition" }).expect(201);
    await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(10) }).expect(200);
    expect(await stored(user.userId)).toMatchObject({ age_status: "blocked_under_13" });
    // Recorded, not enforced: the person keeps full access and their data.
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "How can I sleep better?" }).expect(201);
    const emergency = await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have crushing chest pain and can't breathe" }).expect(201);
    expect(emergency.body.messages[1].payload.kind).toBe("escalation");
    const me = (await ctx.http.get("/v1/me").set(user.auth).expect(200)).body;
    expect(me.conditions.map((c: { name: string }) => c.name)).toContain("Synthetic condition");
    expect((await ctx.db.query(`SELECT 1 FROM users WHERE id = $1 AND deletion_requested_at IS NULL`, [user.userId])).rows).toHaveLength(1);
  });

  it("can be turned off", async () => {
    const off = await createTestContext({ env: { AGE_ENFORCEMENT: "off" } });
    try {
      const user = await signUp(off);
      await off.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(30) }).expect(501);
      expect((await off.http.get("/v1/meta").expect(200)).body.age).toMatchObject({ enforcement: "off" });
    } finally {
      await off.close();
    }
  });
});

describe("age screen at sign-up", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());
  beforeEach(() => ctx.app.get(RateLimiter).reset());

  const register = (body: Record<string, unknown>) =>
    ctx.http.post("/v1/auth/register").send({ email: `screen-${randomUUID()}@example.com`, password: "correct horse battery", firstName: "Sam", ...body });
  const state = async (userId: string) => (await ctx.db.query<{ age_band: string; age_status: string }>(`SELECT age_band, age_status FROM users WHERE id = $1`, [userId])).rows[0]!;
  const historyCount = async (userId: string) => Number((await ctx.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM age_assessments WHERE user_id = $1`, [userId])).rows[0]!.n);

  it("leaves age unknown when no screen is sent (existing clients)", async () => {
    const res = await register({}).expect(201);
    expect(await state(res.body.userId)).toEqual({ age_band: "unknown", age_status: "unknown" });
    expect(await historyCount(res.body.userId)).toBe(0);
  });

  it("records a valid screen as a self-declared assessment", async () => {
    const res = await register({ ageScreen: { dateOfBirth: born(17) } }).expect(201);
    expect(await state(res.body.userId)).toEqual({ age_band: "16_17", age_status: "blocked_out_of_scope" });
    const rows = (await ctx.db.query(`SELECT band, source, outcome FROM age_assessments WHERE user_id = $1`, [res.body.userId])).rows;
    expect(rows).toEqual([{ band: "16_17", source: "self_declared", outcome: "applied" }]);
    // Sign-up itself works exactly as before: the session is usable.
    await ctx.http.get("/v1/me/account").set({ Authorization: `Bearer ${res.body.accessToken}` }).expect(200);
  });

  it("refuses an invalid screen before any account is created", async () => {
    const email = `invalid-screen-${randomUUID()}@example.com`;
    for (const ageScreen of [{ dateOfBirth: "2026-02-30" }, { dateOfBirth: born(-1) }, { dateOfBirth: born(30), ageBand: "adult" }, { band: "adult" }]) {
      await ctx.http.post("/v1/auth/register").send({ email, password: "correct horse battery", firstName: "Sam", ageScreen }).expect(400);
    }
    expect((await ctx.db.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rows).toHaveLength(0);
  });

  it("keeps the account (age unknown, no partial history) if recording the screen fails", async () => {
    const spy = vi.spyOn(AgeService.prototype, "record").mockRejectedValueOnce(new Error("synthetic failure"));
    try {
      const res = await register({ ageScreen: { dateOfBirth: born(30) } }).expect(201);
      expect(await state(res.body.userId)).toEqual({ age_band: "unknown", age_status: "unknown" });
      expect(await historyCount(res.body.userId)).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("migration 0015", () => {
  it("adds age state to existing accounts as unknown, without touching their dates of birth, and re-runs safely", async () => {
    const all = join(__dirname, "..", "migrations");
    const before = mkdtempSync(join(tmpdir(), "hm-migrations-"));
    for (const file of readdirSync(all).filter((f) => f < "0015")) copyFileSync(join(all, file), join(before, file));
    const db = await createDatabase({});
    try {
      await migrate(db, before);
      const minorByProfile = randomUUID();
      const adultByProfile = randomUUID();
      await db.query(`INSERT INTO auth.users (id, email) VALUES ($1, 'existing-minor@example.com'), ($2, 'existing-adult@example.com')`, [minorByProfile, adultByProfile]);
      await db.query(`UPDATE profiles SET date_of_birth = '2016-05-01' WHERE user_id = $1`, [minorByProfile]);
      await db.query(`UPDATE profiles SET date_of_birth = '1980-05-01' WHERE user_id = $1`, [adultByProfile]);

      expect(await migrate(db, all)).toEqual(["0015_age_and_consent_foundation.sql"]);
      const { rows } = await db.query<{ age_band: string; age_status: string; age_assessed_at: Date | null; date_of_birth: string }>(
        `SELECT u.age_band, u.age_status, u.age_assessed_at, p.date_of_birth::text AS date_of_birth FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ANY($1::uuid[]) ORDER BY p.date_of_birth`,
        [[minorByProfile, adultByProfile]],
      );
      // Not inferred from the profile date of birth, which is kept as it was.
      expect(rows).toEqual([
        { age_band: "unknown", age_status: "unknown", age_assessed_at: null, date_of_birth: "1980-05-01" },
        { age_band: "unknown", age_status: "unknown", age_assessed_at: null, date_of_birth: "2016-05-01" },
      ]);
      expect(await db.query(`SELECT 1 FROM age_assessments`).then((r) => r.rows)).toEqual([]);

      // The runner applies each file once; the SQL itself is also safe to apply again.
      expect(await migrate(db, all)).toEqual([]);
      const { readFileSync } = await import("node:fs");
      await db.exec(readFileSync(join(all, "0015_age_and_consent_foundation.sql"), "utf8"));
      expect((await db.query<{ age_band: string }>(`SELECT age_band FROM users WHERE id = $1`, [adultByProfile])).rows[0]!.age_band).toBe("unknown");

      // Inconsistent state is refused by the database itself.
      await expect(db.query(`UPDATE users SET age_band = 'adult' WHERE id = $1`, [adultByProfile])).rejects.toThrow(/users_age_state_check/);
      await expect(db.query(`UPDATE users SET age_band = 'toddler', age_status = 'in_scope', age_assessed_at = now() WHERE id = $1`, [adultByProfile])).rejects.toThrow(/users_age_band_check/);
      await expect(db.query(`INSERT INTO age_assessments (user_id, band, source, outcome) VALUES ($1, 'unknown', 'self_declared', 'applied')`, [adultByProfile])).rejects.toThrow();

      // Deleting the account removes its history.
      await db.query(`INSERT INTO age_assessments (user_id, band, source, outcome) VALUES ($1, 'adult', 'self_declared', 'applied')`, [adultByProfile]);
      await db.query(`DELETE FROM auth.users WHERE id = $1`, [adultByProfile]);
      expect((await db.query(`SELECT 1 FROM age_assessments WHERE user_id = $1`, [adultByProfile])).rows).toEqual([]);
    } finally {
      await db.close();
    }
  });
});

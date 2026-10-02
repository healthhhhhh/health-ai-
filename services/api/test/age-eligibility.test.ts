import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { RateLimiter } from "../src/common/rate-limit";
import { AccountService } from "../src/modules/account/account.service";
import {
  adultOnFor,
  bandForAge,
  bandOnDay,
  completedYears,
  effectiveAge,
  eligibilityFor,
  referenceDay,
  type AgeBand,
} from "../src/modules/account/age";
import { AgeService } from "../src/modules/account/age.service";
import { ProcessingPolicy } from "../src/modules/account/processing-policy";
import type { IdTokenVerifiers, VerifiedIdentity } from "../src/modules/auth/oauth";
import { NotificationsService } from "../src/modules/notifications/notifications.controller";
import type { PushMessage, PushOutcome, PushProvider, PushTarget } from "../src/modules/notifications/push";
import { PushService } from "../src/modules/notifications/push.service";
import { JobQueue, type JobHandler, type JobName, type JobPayloads } from "../src/modules/documents/job-queue";
import { chatAnswer, createTestContext, type TestContext } from "./helpers";

/**
 * US launch age eligibility (AGE_ENFORCEMENT=enforce; 13–15, 16–17 and adults
 * served; under-13s excluded). Synthetic data and the fake AI provider only.
 */

const RANK: Record<AgeBand, number> = { under_13: 0, "13_15": 1, "16_17": 2, adult: 3 };

/** A date of birth `years` before today's reference day, shifted by `days`. */
function born(years: number, days = 0): string {
  const [y, m, d] = referenceDay().split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y - years, m - 1, d + days)).toISOString().slice(0, 10);
}
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("birthday transitions (pure)", () => {
  it("moves a teen into the next band on the same day as their age — never early, and only a day late for 29 February", () => {
    let checked = 0;
    for (let dob = "2004-01-01"; dob <= "2014-12-31"; dob = addDays(dob, 1)) {
      const adultOn = adultOnFor(dob);
      const leapDay = dob.endsWith("-02-29");
      for (const birthday of [13, 16, 18]) {
        const [y] = dob.split("-").map(Number) as [number];
        const around = `${y + birthday}${dob.slice(4)}`.endsWith("-02-29") ? `${y + birthday}-03-01` : `${y + birthday}${dob.slice(4)}`;
        for (const day of [addDays(around, -1), around, addDays(around, 1)]) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          const truth = bandForAge(completedYears(dob, day));
          const computed = bandOnDay(adultOn, day);
          expect(RANK[computed], `${dob} on ${day}`).toBeLessThanOrEqual(RANK[truth]);
          if (!leapDay) expect(computed, `${dob} on ${day}`).toBe(truth);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(30_000);
    expect(adultOnFor("2008-02-29")).toBe("2026-03-01");
    expect(adultOnFor("2010-06-15")).toBe("2028-06-15");
  });

  it("applies birthdays only to served (or out-of-scope) teens — never to under-13 blocks, reviews or unknown ages", () => {
    const launch = ["13_15", "16_17", "adult"] as const;
    const teen = { band: "13_15", status: "in_scope", adultOn: "2027-03-10" } as const;
    expect(effectiveAge(teen, "2025-03-09", launch)).toBe(teen);
    expect(effectiveAge(teen, "2025-03-10", launch)).toEqual({ band: "16_17", status: "in_scope", adultOn: "2027-03-10" });
    expect(effectiveAge(teen, "2027-03-10", launch)).toEqual({ band: "adult", status: "in_scope", adultOn: null });
    expect(effectiveAge({ ...teen, status: "blocked_out_of_scope" }, "2027-03-10", ["adult"])).toEqual({ band: "adult", status: "in_scope", adultOn: null });
    expect(effectiveAge({ ...teen, status: "review" }, "2027-03-10", launch).band).toBe("13_15");
    expect(effectiveAge({ band: "under_13", status: "blocked_under_13", adultOn: null }, "2040-01-01", launch).band).toBe("under_13");
    expect(effectiveAge({ band: "unknown", status: "unknown", adultOn: null }, "2040-01-01", launch).band).toBe("unknown");
  });

  it("is eligible only when in scope", () => {
    expect(eligibilityFor("in_scope")).toBe("eligible");
    expect(eligibilityFor("unknown")).toBe("age_required");
    expect(eligibilityFor("review")).toBe("age_review");
    expect(eligibilityFor("blocked_under_13")).toBe("age_not_eligible");
    expect(eligibilityFor("blocked_out_of_scope")).toBe("age_not_eligible");
  });
});

/** Records deliveries (no network). */
class RecordingPushProvider implements PushProvider {
  readonly name = "log" as const;
  readonly enabled = true;
  readonly delivered: PushMessage[] = [];
  async send(_target: PushTarget, message: PushMessage): Promise<PushOutcome> {
    this.delivered.push(message);
    return { status: "sent" };
  }
}

/** Holds queued jobs until `drain`, so a test can change state between queueing and execution. */
class HeldJobQueue extends JobQueue {
  private readonly handlers = new Map<JobName, JobHandler<JobName>>();
  readonly held: { name: JobName; data: unknown }[] = [];
  register<N extends JobName>(name: N, handler: JobHandler<N>) {
    this.handlers.set(name, handler as JobHandler<JobName>);
  }
  async enqueue<N extends JobName>(name: N, data: JobPayloads[N]) {
    this.held.push({ name, data });
  }
  async drain() {
    while (this.held.length) {
      const job = this.held.shift()!;
      await this.handlers.get(job.name)!(job.data as never);
    }
  }
}

/** Accepts tokens shaped `synthetic-google:<subject>` (no network, no real Google tokens). */
const googleVerifier: IdTokenVerifiers = {
  google: {
    provider: "google",
    async verify(idToken: string): Promise<VerifiedIdentity> {
      const subject = idToken.replace("synthetic-google:", "");
      return { provider: "google", subject, email: `${subject}@example.com`, emailVerified: true, givenName: "Sam", familyName: null };
    },
  },
};

describe("with AGE_ENFORCEMENT=enforce", () => {
  let ctx: TestContext;
  const push = new RecordingPushProvider();
  beforeAll(async () => {
    ctx = await createTestContext({ env: { AGE_ENFORCEMENT: "enforce" }, idTokenVerifiers: googleVerifier, pushProvider: push, jobQueue: new HeldJobQueue() });
  });
  afterAll(() => ctx.close());
  beforeEach(async () => {
    await ctx.app.get(RateLimiter).reset();
    await ctx.drainJobs();
    ctx.ai.requests.length = 0;
  });

  const consents = ["ai_processing", "document_processing", "health_data_sync"];
  /** Registers (optionally with an age screen) and grants consents — consents are allowed whatever the age state. */
  async function register(dateOfBirth?: string) {
    await ctx.app.get(RateLimiter).reset();
    const email = `eligibility-${randomUUID()}@example.com`;
    const res = await ctx.http
      .post("/v1/auth/register")
      .send({ email, password: "correct horse battery", firstName: "Sam", timeZone: "UTC", ...(dateOfBirth ? { ageScreen: { dateOfBirth } } : {}) })
      .expect(201);
    const auth = { Authorization: `Bearer ${res.body.accessToken as string}` };
    for (const kind of consents) await ctx.http.post("/v1/me/consents").set(auth).send({ kind, granted: true }).expect(204);
    return { email, userId: res.body.userId as string, auth };
  }
  const account = async (auth: Record<string, string>) => (await ctx.http.get("/v1/me/account").set(auth).expect(200)).body;
  const stored = async (userId: string) =>
    (
      await ctx.db.query<{ age_band: string; age_status: string; age_adult_on: string | null; due: Date | null }>(
        `SELECT age_band, age_status, age_adult_on::text AS age_adult_on, age_deletion_due_at AS due FROM users WHERE id = $1`,
        [userId],
      )
    ).rows[0];
  const PDF = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF");
  async function queueReport(auth: Record<string, string>) {
    const created = await ctx.http.post("/v1/documents").set(auth).send({ kind: "report", filename: "synthetic.pdf", contentType: "application/pdf", byteSize: PDF.length }).expect(201);
    await ctx.http.put(new URL(created.body.upload.url).pathname).set("Content-Type", "application/pdf").send(PDF).expect(200);
    await ctx.http.post(`/v1/documents/${created.body.document.id}/process`).set(auth).send({}).expect(202);
    return created.body.document.id as string;
  }

  it("describes enforcement in /v1/meta, with under-13s never enabled", async () => {
    expect((await ctx.http.get("/v1/meta").expect(200)).body.age).toEqual({ enforcement: "enforce", enabledBands: ["13_15", "16_17", "adult"], parentalConsent: false });
  });

  describe("unknown age (legacy sign-up without an age screen)", () => {
    it("restricts every health route until a date of birth is given, keeping account controls available", async () => {
      const user = await register();
      expect(await account(user.auth)).toMatchObject({ ageBand: "unknown", ageStatus: "unknown", ageEligibility: "age_required", ageDeletionScheduledAt: null });
      // Setup can greet the person by the name they signed up with before their age is confirmed.
      expect(await account(user.auth)).toMatchObject({ firstName: "Sam", lastName: "" });

      const restricted: [string, () => ReturnType<typeof ctx.http.get>][] = [
        ["GET /v1/me", () => ctx.http.get("/v1/me")],
        ["PATCH /v1/me/profile", () => ctx.http.patch("/v1/me/profile").send({ sex: "female" })],
        ["POST /v1/me/conditions", () => ctx.http.post("/v1/me/conditions").send({ name: "Synthetic condition" })],
        ["GET /v1/conversations", () => ctx.http.get("/v1/conversations")],
        ["POST /v1/conversations", () => ctx.http.post("/v1/conversations").send({ message: "How can I sleep better?" })],
        ["POST /v1/documents", () => ctx.http.post("/v1/documents").send({ kind: "report", filename: "a.pdf", contentType: "application/pdf", byteSize: 10 })],
        ["GET /v1/memories", () => ctx.http.get("/v1/memories")],
        ["POST /v1/memories", () => ctx.http.post("/v1/memories").send({ fact: "Synthetic fact" })],
        ["PUT /v1/health-data/daily", () => ctx.http.put("/v1/health-data/daily").send({ records: [], timeZone: "UTC" })],
        ["GET /v1/timeline", () => ctx.http.get("/v1/timeline")],
        ["GET /v1/symptoms", () => ctx.http.get("/v1/symptoms")],
        ["GET /v1/plan", () => ctx.http.get("/v1/plan")],
        ["GET /v1/notifications", () => ctx.http.get("/v1/notifications")],
        ["POST /v1/me/devices", () => ctx.http.post("/v1/me/devices").send({ platform: "ios", token: randomBytes(32).toString("hex"), environment: "sandbox", appVersion: "1.0 (1)" })],
      ];
      for (const [label, request] of restricted) {
        const res = await request().set(user.auth);
        expect(res.status, label).toBe(403);
        expect(res.body.error, label).toEqual({ code: "age_required", message: "Add your date of birth to continue." });
      }
      expect(ctx.ai.requests).toHaveLength(0);

      // Always available: age, account summary, consents, export (deletion: below).
      await ctx.http.get("/v1/me/consents").set(user.auth).expect(200);
      await ctx.http.post("/v1/me/consents").set(user.auth).send({ kind: "voice", granted: false }).expect(204);
      await ctx.http.get("/v1/me/export").set(user.auth).expect(200);

      const assessed = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(30) }).expect(200);
      expect(assessed.body).toMatchObject({ ageBand: "adult", ageStatus: "in_scope", eligibility: "eligible", outcome: "applied" });
      await ctx.http.get("/v1/me").set(user.auth).expect(200);
      ctx.ai.on("chat", () => chatAnswer());
      await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "How can I sleep better?" }).expect(201);
    });

    it("lets a restricted account delete itself", async () => {
      const user = await register();
      await ctx.http.post("/v1/me/delete").set(user.auth).send({ password: "correct horse battery" }).expect(204);
      expect(await stored(user.userId)).toBeUndefined();
    });

    it("refuses queued work at execution time when the account isn't eligible (ProcessingPolicy)", async () => {
      const user = await register(born(30));
      const policy = ctx.app.get(ProcessingPolicy);
      expect(await policy.permitted(user.userId, "ai_processing")).toBe(true);
      // An account whose age state was reset to unknown (e.g. by support) has consent but isn't eligible.
      await ctx.db.query(`UPDATE users SET age_band = 'unknown', age_status = 'unknown', age_assessed_at = NULL WHERE id = $1`, [user.userId]);
      expect(await policy.permitted(user.userId, "ai_processing")).toBe(false);
      await expect(policy.assert(user.userId, "document_processing")).rejects.toMatchObject({ code: "age_required", status: 403 });
    });
  });

  describe("age boundaries at sign-up", () => {
    it("serves 13, 16, 17 and 18 and refuses 12 before any account exists", async () => {
      const cases: [string, AgeBand][] = [
        [born(13), "13_15"],
        [born(16, 1), "13_15"],
        [born(16), "16_17"],
        [born(18, 1), "16_17"],
        [born(18), "adult"],
      ];
      for (const [dateOfBirth, band] of cases) {
        const user = await register(dateOfBirth);
        expect(await account(user.auth), dateOfBirth).toMatchObject({ ageBand: band, ageStatus: "in_scope", ageEligibility: "eligible" });
        await ctx.http.get("/v1/me").set(user.auth).expect(200);
      }

      const email = `under13-${randomUUID()}@example.com`;
      const refused = await ctx.http.post("/v1/auth/register").send({ email, password: "correct horse battery", firstName: "Sam", ageScreen: { dateOfBirth: born(13, 1) } }).expect(403);
      expect(refused.body.error).toEqual({ code: "age_not_eligible", message: "HealthMate isn't available for your age." });
      expect(JSON.stringify(refused.body)).not.toContain(born(13, 1));
      expect((await ctx.db.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rows).toHaveLength(0);
    });

    it("keeps the date a teen turns 18 (not for adults), and never sends it or the band's date to the AI", async () => {
      const teen = await register(born(15));
      const adult = await register(born(40));
      expect((await stored(teen.userId))!.age_adult_on).toBe(adultOnFor(born(15)));
      expect((await stored(adult.userId))!.age_adult_on).toBeNull();
      ctx.ai.on("chat", () => chatAnswer());
      await ctx.http.post("/v1/conversations").set(teen.auth).send({ message: "How can I sleep better?" }).expect(201);
      const sent = JSON.stringify(ctx.ai.requests);
      for (const value of [born(15), adultOnFor(born(15)), born(15).slice(0, 4)]) expect(sent).not.toContain(value);
    });
  });

  describe("Google sign-in with an age screen", () => {
    const oauth = (subject: string, dateOfBirth: string) =>
      ctx.http.post("/v1/auth/oauth").send({ provider: "google", idToken: `synthetic-google:${subject}-0123456789`, ageScreen: { dateOfBirth } });

    it("creates nothing on a first sign-in under 13; an existing account is signed in and restricted", async () => {
      const newcomer = `newcomer-${randomUUID()}`;
      await oauth(newcomer, born(11)).expect(403);
      expect((await ctx.db.query(`SELECT 1 FROM users WHERE email = $1`, [`${newcomer}-0123456789@example.com`])).rows).toHaveLength(0);

      const existing = `existing-${randomUUID()}`;
      const first = await oauth(existing, born(30)).expect(200);
      expect(first.body.isNewUser).toBe(true);
      const again = await oauth(existing, born(11)).expect(200);
      const auth = { Authorization: `Bearer ${again.body.accessToken as string}` };
      expect(await account(auth)).toMatchObject({ ageBand: "under_13", ageStatus: "blocked_under_13", ageEligibility: "age_not_eligible", ageDeletionScheduledAt: expect.any(String) });
      expect((await ctx.http.get("/v1/me").set(auth).expect(403)).body.error.code).toBe("age_not_eligible");
    });
  });

  describe("an existing account found to belong to someone under 13", () => {
    it("is restricted at once, its queued analysis never reaches the AI, a later older answer unlocks nothing, and it's deleted when due", async () => {
      const user = await register(born(30));
      await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Synthetic remembered fact" }).expect(201);
      const reportId = await queueReport(user.auth);
      const before = Date.now();

      const res = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(11) }).expect(200);
      expect(res.body).toMatchObject({ ageBand: "under_13", ageStatus: "blocked_under_13", eligibility: "age_not_eligible", outcome: "applied" });
      const due = Date.parse(res.body.deletionScheduledAt);
      expect(due).toBeGreaterThanOrEqual(before + 72 * 3_600_000 - 5_000);
      expect(due).toBeLessThanOrEqual(Date.now() + 72 * 3_600_000 + 5_000);

      await ctx.drainJobs();
      expect(ctx.ai.requests).toHaveLength(0);
      const report = (await ctx.db.query<{ status: string }>(`SELECT status FROM medical_documents WHERE id = $1`, [reportId])).rows[0]!;
      expect(report.status).toBe("failed");
      expect((await ctx.http.get("/v1/memories").set(user.auth).expect(403)).body.error.code).toBe("age_not_eligible");

      // Retrying with an adult date: held for review, still restricted, deadline unchanged.
      const retry = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(30) }).expect(200);
      expect(retry.body).toMatchObject({ ageBand: "under_13", ageStatus: "review", eligibility: "age_review", outcome: "review", deletionScheduledAt: res.body.deletionScheduledAt });
      expect((await ctx.http.get("/v1/me").set(user.auth).expect(403)).body.error.code).toBe("age_review");
      await ctx.http.get("/v1/me/export").set(user.auth).expect(200);

      // Not yet due: nothing is deleted.
      const accounts = ctx.app.get(AccountService);
      await accounts.finishPendingDeletions();
      expect(await stored(user.userId)).toBeDefined();
      // Due: the account and everything in it go.
      await ctx.db.query(`UPDATE users SET age_deletion_due_at = now() - interval '1 minute' WHERE id = $1`, [user.userId]);
      expect(await accounts.finishPendingDeletions()).toBeGreaterThanOrEqual(1);
      expect(await stored(user.userId)).toBeUndefined();
      expect((await ctx.db.query(`SELECT 1 FROM health_memories WHERE user_id = $1`, [user.userId])).rows).toHaveLength(0);
      const audit = (await ctx.db.query<{ action: string; metadata: Record<string, unknown> }>(`SELECT action, metadata FROM audit_logs WHERE user_id = $1 ORDER BY created_at`, [user.userId])).rows;
      expect(audit).toEqual(expect.arrayContaining([{ action: "account.delete_requested", metadata: { reason: "age" } }, expect.objectContaining({ action: "account.delete" })]));
      // The audit trail never holds the band or a date.
      expect(JSON.stringify(audit)).not.toMatch(/under_13|\d{4}-\d{2}-\d{2}"/);
    });

    it("schedules deletion for under-13 accounts recorded before enforcement was on", async () => {
      const user = await register(born(30));
      await ctx.db.query(`UPDATE users SET age_band = 'under_13', age_status = 'blocked_under_13', age_adult_on = NULL WHERE id = $1`, [user.userId]);
      expect((await stored(user.userId))!.due).toBeNull();
      expect(await ctx.app.get(AgeService).scheduleUnderThirteenDeletions()).toBeGreaterThanOrEqual(1);
      expect((await stored(user.userId))!.due).toBeInstanceOf(Date);
    });

    it("gets no push notifications once restricted", async () => {
      const user = await register(born(30));
      await ctx.http.post("/v1/me/devices").set(user.auth).send({ platform: "ios", token: randomBytes(32).toString("hex"), environment: "sandbox", appVersion: "1.0 (1)" }).expect(201);
      await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(10) }).expect(200);
      const id = await ctx.app.get(NotificationsService).notify(user.userId, { category: "report", title: "Synthetic", body: "" });
      expect(await ctx.app.get(PushService).dispatch(user.userId, id!)).toEqual({ skipped: "age_restricted" });
    });
  });

  describe("birthdays", () => {
    it("moves a teen to 16–17 and then adult on their birthdays (history: birthday), with no new question", async () => {
      const user = await register(born(15));
      const today = referenceDay();
      // Their 16th birthday is today (turning 18 two years from now).
      const [y] = today.split("-").map(Number) as [number];
      await ctx.db.query(`UPDATE users SET age_adult_on = $2::date WHERE id = $1`, [user.userId, `${y + 2}${today.slice(4)}`.replace(/-02-29$/, "-03-01")]);
      expect(await account(user.auth)).toMatchObject({ ageBand: "16_17", ageStatus: "in_scope", ageEligibility: "eligible" });
      // Their 18th birthday is today.
      await ctx.db.query(`UPDATE users SET age_adult_on = $2::date WHERE id = $1`, [user.userId, today]);
      expect(await account(user.auth)).toMatchObject({ ageBand: "adult", ageStatus: "in_scope" });
      expect(await stored(user.userId)).toMatchObject({ age_band: "adult", age_adult_on: null });
      const history = (await ctx.db.query<{ band: string; source: string }>(`SELECT band, source FROM age_assessments WHERE user_id = $1 ORDER BY created_at`, [user.userId])).rows;
      expect(history).toEqual([
        { band: "13_15", source: "self_declared" },
        { band: "16_17", source: "birthday" },
        { band: "adult", source: "birthday" },
      ]);
    });

    it("keeps a served teen's younger band (and access) when they claim to be older", async () => {
      const user = await register(born(14));
      const res = await ctx.http.post("/v1/me/age").set(user.auth).send({ dateOfBirth: born(25) }).expect(200);
      expect(res.body).toMatchObject({ ageBand: "13_15", ageStatus: "in_scope", eligibility: "eligible", outcome: "review" });
      await ctx.http.get("/v1/me").set(user.auth).expect(200);
    });
  });

  describe("teens", () => {
    it("see only their own data: no other teen, adult or parent can read it", async () => {
      ctx.ai.on("chat", () => chatAnswer());
      const teen = await register(born(15));
      const otherTeen = await register(born(16));
      const adult = await register(born(45));
      const memory = (await ctx.http.post("/v1/memories").set(teen.auth).send({ fact: "Synthetic teen fact" }).expect(201)).body;
      const conversation = (await ctx.http.post("/v1/conversations").set(teen.auth).send({ message: "Synthetic private question" }).expect(201)).body;
      const report = await queueReport(teen.auth);

      for (const other of [otherTeen, adult]) {
        await ctx.http.get(`/v1/conversations/${conversation.conversation.id}`).set(other.auth).expect(404);
        await ctx.http.get(`/v1/documents/${report}`).set(other.auth).expect(404);
        const memories = (await ctx.http.get("/v1/memories").set(other.auth).expect(200)).body;
        expect(JSON.stringify(memories)).not.toContain(memory.id);
        const exported = JSON.stringify((await ctx.http.get("/v1/me/export").set(other.auth).expect(200)).body);
        for (const secret of ["Synthetic teen fact", "Synthetic private question", report]) expect(exported).not.toContain(secret);
      }
      // There is no parent or guardian access of any kind.
      for (const path of ["/v1/family", "/v1/guardians", "/v1/parents", `/v1/users/${teen.userId}/export`]) await ctx.http.get(path).set(adult.auth).expect(404);
    });

    it("get age-appropriate guidance in the AI instructions; adults don't", async () => {
      ctx.ai.on("chat", () => chatAnswer());
      const teen = await register(born(14));
      const adult = await register(born(35));
      await ctx.http.post("/v1/conversations").set(teen.auth).send({ message: "How can I sleep better?" }).expect(201);
      await ctx.http.post("/v1/conversations").set(adult.auth).send({ message: "How can I sleep better?" }).expect(201);
      const [teenRequest, adultRequest] = ctx.ai.requests;
      expect(teenRequest!.system.join("\n")).toContain("is a teenager (13–17)");
      expect(teenRequest!.system.join("\n")).toContain("Never say or imply that HealthMate will tell their parents");
      expect(adultRequest!.system.join("\n")).not.toContain("teenager");
    });
  });
});

describe("Apple Health data in AI context", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("is sent only while Apple Health permission is also current", async () => {
    await ctx.app.get(RateLimiter).reset();
    const res = await ctx.http.post("/v1/auth/register").send({ email: `ah-${randomUUID()}@example.com`, password: "correct horse battery", firstName: "Sam", timeZone: "UTC" }).expect(201);
    const auth = { Authorization: `Bearer ${res.body.accessToken as string}` };
    for (const kind of ["ai_processing", "health_data_sync"]) await ctx.http.post("/v1/me/consents").set(auth).send({ kind, granted: true }).expect(204);
    const day = addDays(new Date().toISOString().slice(0, 10), -1);
    await ctx.http.put("/v1/health-data/daily").set(auth).send({ timeZone: "UTC", records: [{ day, kind: "steps", value: 4321, isComplete: true, computedAt: new Date().toISOString() }] }).expect(200);
    ctx.ai.on("chat", () => chatAnswer());

    await ctx.http.post("/v1/conversations").set(auth).send({ message: "How have my steps been this week?" }).expect(201);
    expect(JSON.stringify(ctx.ai.requests.at(-1))).toContain("Apple Health");

    await ctx.http.post("/v1/me/consents").set(auth).send({ kind: "health_data_sync", granted: false }).expect(204);
    await ctx.http.post("/v1/conversations").set(auth).send({ message: "How have my steps been this week?" }).expect(201);
    const sent = JSON.stringify(ctx.ai.requests.at(-1));
    expect(sent).not.toContain("Apple Health");
    expect(sent).not.toContain("4,321");
    expect(sent).not.toContain("4321");
  });
});

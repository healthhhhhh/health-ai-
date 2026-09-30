import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { MemoryService } from "../src/modules/memory/memory.service";
import { describeMemory, relativeAge } from "../src/modules/memory/memory-context";
import { NotificationsService } from "../src/modules/notifications/notifications.controller";
import { ProfileService } from "../src/modules/profile/profile.service";
import { TimelineService } from "../src/modules/timeline/timeline.service";
import { pruneOperationalRecords } from "../src/retention";
import { chatAnswer, createTestContext, signUp, type TestContext } from "./helpers";

/** Phase 2A: accounts, preferences, the longitudinal record and its provenance. */
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});

describe("account and profile", () => {
  it("reports the account and remembers onboarding across devices", async () => {
    const user = await signUp(ctx);
    const before = (await ctx.http.get("/v1/me/account").set(user.auth).expect(200)).body;
    expect(before).toMatchObject({ email: user.email, emailVerified: true, signInMethods: ["password"], onboardingCompleted: false });
    await ctx.http.post("/v1/me/onboarding").set(user.auth).expect(204);
    await ctx.http.post("/v1/me/onboarding").set(user.auth).expect(204); // idempotent
    expect((await ctx.http.get("/v1/me/account").set(user.auth).expect(200)).body.onboardingCompleted).toBe(true);
    await ctx.http.get("/v1/me/account").expect(401);
  });

  it("stores goals, units and a valid time zone, and nothing it doesn't need", async () => {
    const user = await signUp(ctx);
    const updated = (await ctx.http.patch("/v1/me/profile").set(user.auth).send({ goals: ["sleep", "stress"], unitSystem: "imperial", timeZone: "America/New_York" }).expect(200)).body;
    expect(updated).toMatchObject({ goals: ["sleep", "stress"], unitSystem: "imperial", timeZone: "America/New_York" });
    expect((await ctx.http.get("/v1/me").set(user.auth).expect(200)).body.profile).toMatchObject({ goals: ["sleep", "stress"], unitSystem: "imperial" });
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ timeZone: "Mars/Olympus" }).expect(400);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ unitSystem: "cubits" }).expect(400);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ goals: Array.from({ length: 11 }, (_, i) => `g${i}`) }).expect(400);
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ dateOfBirth: "1990-13-45" }).expect(400);
    // Unknown fields (e.g. an address) are ignored, never stored.
    await ctx.http.patch("/v1/me/profile").set(user.auth).send({ address: "1 Main St" }).expect(200);
    const { rows } = await ctx.db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('address', 'phone', 'age')`);
    expect(rows).toEqual([]);
  });

  it("keeps notification preferences per person, with private defaults", async () => {
    const alice = await signUp(ctx);
    const bob = await signUp(ctx);
    const defaults = (await ctx.http.get("/v1/me/notification-preferences").set(alice.auth).expect(200)).body;
    expect(defaults).toEqual({ medication: true, task: true, appointment: true, report: true, insight: true, account: true, showDetails: false, quietHours: { enabled: false, start: "22:00", end: "07:00" } });
    const saved = (await ctx.http.put("/v1/me/notification-preferences").set(alice.auth).send({ insight: false, quietHours: { enabled: true, start: "21:30" } }).expect(200)).body;
    expect(saved).toMatchObject({ insight: false, quietHours: { enabled: true, start: "21:30", end: "07:00" } });
    expect((await ctx.http.get("/v1/me/notification-preferences").set(alice.auth).expect(200)).body.insight).toBe(false);
    expect((await ctx.http.get("/v1/me/notification-preferences").set(bob.auth).expect(200)).body.insight).toBe(true);
    await ctx.http.put("/v1/me/notification-preferences").set(alice.auth).send({ quietHours: { start: "25:00" } }).expect(400);
  });
});

describe("authentication", () => {
  it("changes the password only with the current one, and ends other sessions", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/auth/change-password").send({ currentPassword: "correct horse battery", newPassword: "a new passphrase" }).expect(401);
    await ctx.http.post("/v1/auth/change-password").set(user.auth).send({ currentPassword: "wrong", newPassword: "a new passphrase" }).expect(403);
    await ctx.http.post("/v1/auth/change-password").set(user.auth).send({ currentPassword: "correct horse battery", newPassword: "short" }).expect(400);
    await ctx.http.post("/v1/auth/change-password").set(user.auth).send({ currentPassword: "correct horse battery", newPassword: "correct horse battery" }).expect(400);
    await ctx.http.post("/v1/auth/change-password").set(user.auth).send({ currentPassword: "correct horse battery", newPassword: "a new passphrase" }).expect(204);
    await ctx.http.post("/v1/auth/login").send({ email: user.email, password: "correct horse battery" }).expect(401);
    await ctx.http.post("/v1/auth/login").send({ email: user.email, password: "a new passphrase" }).expect(200);
    // Sessions from before the change can't be renewed.
    await ctx.http.post("/v1/auth/refresh").send({ refreshToken: user.refreshToken }).expect(401);
  });

  it("answers verification and OAuth requests honestly without revealing accounts", async () => {
    await ctx.http.post("/v1/auth/resend-verification").send({ email: "nobody@example.com" }).expect(202);
    const bad = await ctx.http.post("/v1/auth/verify-email").send({ token: "not-a-real-token" }).expect(400);
    expect(bad.body.error.code).toBe("invalid_token");
    const oauth = await ctx.http.post("/v1/auth/oauth").send({ provider: "apple", timeZone: "UTC" }).expect(501);
    expect(oauth.body.error.code).toBe("not_available");
    await ctx.http.post("/v1/auth/oauth").send({ provider: "myspace" }).expect(400);
  });
});

describe("temporal accuracy", () => {
  it("keeps a stopped medication as history and never presents it as current", async () => {
    const user = await signUp(ctx);
    const a = (await ctx.http.post("/v1/me/medications").set(user.auth).send({ name: "Medication A", instruction: "As directed on the label", source: "user_reported", startedOn: "2026-01-10" }).expect(201)).body.id;
    await ctx.http.patch(`/v1/me/medications/${a}`).set(user.auth).send({ active: false, stoppedOn: "2026-07-28" }).expect(204);
    await ctx.http.post("/v1/me/medications").set(user.auth).send({ name: "Medication B", instruction: "As directed on the label", source: "user_reported", startedOn: "2026-08-01" }).expect(201);
    await ctx.http.patch(`/v1/me/medications/${a}`).set(user.auth).send({ active: false, stoppedOn: "2025-12-01" }).expect(400); // before it started: rejected by the database
    const meds = (await ctx.http.get("/v1/me").set(user.auth).expect(200)).body.medications;
    expect(meds.map((m: { name: string; active: boolean; stoppedOn: string | null }) => [m.name, m.active, m.stoppedOn])).toEqual([
      ["Medication A", false, "2026-07-28"],
      ["Medication B", true, null],
    ]);
    const summary = await ctx.app.get(ProfileService).contextSummary(user.userId, new Date("2026-09-30T12:00:00Z"));
    expect(summary).toContain('Current medications, instructions verbatim: Medication B: "As directed on the label" [user_reported, started 2026-08-01 (about 2 months ago)]');
    expect(summary).toContain("Past medications (stopped, not current): Medication A [user_reported, stopped 2026-07-28 (about 2 months ago)]");
    expect(summary.split("\n").find((l) => l.startsWith("Current"))).not.toContain("Medication A");
    // The current-state view agrees.
    const { rows } = await ctx.db.query<{ name: string }>(`SELECT name FROM current_medications WHERE user_id = $1`, [user.userId]);
    expect(rows.map((r) => r.name)).toEqual(["Medication B"]);
  });

  it("separates resolved conditions and lets people correct their own records", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    const id = (await ctx.http.post("/v1/me/conditions").set(user.auth).send({ name: "Asthma", onsetOn: "2010-05-01" }).expect(201)).body.id;
    const old = (await ctx.http.post("/v1/me/conditions").set(user.auth).send({ name: "Tennis elbow", onsetOn: "2025-03-01" }).expect(201)).body.id;
    await ctx.http.patch(`/v1/me/conditions/${old}`).set(user.auth).send({ status: "resolved", resolvedOn: "2025-09-01" }).expect(204);
    await ctx.http.patch(`/v1/me/conditions/${old}`).set(other.auth).send({ status: "active" }).expect(404);
    await ctx.http.patch(`/v1/me/conditions/${id}`).set(user.auth).send({ status: "resolved", resolvedOn: "2009-01-01" }).expect(400); // before onset
    const summary = await ctx.app.get(ProfileService).contextSummary(user.userId, new Date("2026-09-30T12:00:00Z"));
    expect(summary).toContain("Current conditions: Asthma [user_reported, since 2010-05-01 (about 16 years ago)]");
    expect(summary).toContain("Past conditions (resolved, not current): Tennis elbow [user_reported, resolved 2025-09-01 (about 13 months ago)]");
    const allergy = (await ctx.http.post("/v1/me/allergies").set(user.auth).send({ substance: "Latex", reaction: "Rash" }).expect(201)).body.id;
    await ctx.http.patch(`/v1/me/allergies/${allergy}`).set(user.auth).send({ status: "inactive" }).expect(204);
    expect(await ctx.app.get(ProfileService).contextSummary(user.userId)).not.toContain("Latex");
  });

  it("describes memories with provenance and how long ago", () => {
    expect(relativeAge("2026-09-30", "2026-09-30")).toBe("today");
    expect(relativeAge("2026-09-29", "2026-09-30")).toBe("yesterday");
    expect(relativeAge("2026-09-20", "2026-09-30")).toBe("10 days ago");
    expect(relativeAge("2026-08-30", "2026-09-30")).toBe("about 4 weeks ago");
    expect(relativeAge("2026-06-30", "2026-09-30")).toBe("about 3 months ago");
    expect(relativeAge("2023-09-30", "2026-09-30")).toBe("about 3 years ago");
    expect(describeMemory({ fact: "Evening headaches", status: "user_reported", occurredOn: "2026-06-30", createdAt: "2026-06-30T20:00:00Z" }, "2026-09-30")).toBe(
      "User reported: Evening headaches (about 3 months ago, 2026-06-30)",
    );
    expect(describeMemory({ fact: "Possible poor sleep", status: "ai_inferred", createdAt: "2026-09-28T08:00:00Z" }, "2026-09-30")).toBe(
      "Unconfirmed AI inference — not verified; do not treat as fact: Possible poor sleep (recorded 2 days ago, 2026-09-28)",
    );
    expect(describeMemory({ fact: "Ran 5 km weekly", status: "user_confirmed", occurredOn: "2025-01-01", endedOn: "2026-02-01", createdAt: "2025-01-01T00:00:00Z" }, "2026-09-30")).toContain(
      "no longer current since 2026-02-01",
    );
  });

  it("gives the AI previous history with its date and source", async () => {
    const user = await signUp(ctx);
    await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Evening headaches after screen time", occurredOn: "2026-06-30", category: "symptom" }).expect(201);
    ctx.ai.on("chat", () => chatAnswer({ memorySuggestions: [] }));
    await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "I have a headache again this evening" }).expect(201);
    const system = ctx.ai.requests.at(-1)!.system.join("\n");
    expect(system).toContain("Previous relevant history");
    expect(system).toMatch(/User reported: Evening headaches after screen time \((about \d+ (weeks|months) ago|\d+ days ago), 2026-06-30\)/);
  });
});

describe("memory corrections", () => {
  it("supersedes a fact, keeps it as history and stops using it as context", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    const memories = ctx.app.get(MemoryService);
    const wrong = (await ctx.http.post("/v1/memories").set(user.auth).send({ fact: "Allergic to penicilin", occurredOn: "2020-04-01" }).expect(201)).body;
    await ctx.http.post(`/v1/memories/${wrong.id}/supersede`).set(other.auth).send({ fact: "Planted" }).expect(404);
    const result = (await ctx.http.post(`/v1/memories/${wrong.id}/supersede`).set(user.auth).send({ fact: "Allergic to amoxicillin" }).expect(201)).body;
    expect(result.superseded).toMatchObject({ id: wrong.id, status: "superseded", priorStatus: "user_reported", supersededBy: result.replacement.id });
    expect(result.replacement).toMatchObject({ fact: "Allergic to amoxicillin", status: "user_confirmed", occurredOn: "2020-04-01" });
    // History can't be edited or superseded again…
    await ctx.http.patch(`/v1/memories/${wrong.id}`).set(user.auth).send({ fact: "rewrite" }).expect(404);
    await ctx.http.post(`/v1/memories/${wrong.id}/supersede`).set(user.auth).send({ fact: "again" }).expect(404);
    // …and is never given to the AI.
    const relevant = await memories.relevant(user.userId, "allergic penicilin amoxicillin");
    expect(relevant.map((m) => m.id)).not.toContain(wrong.id);
    // But it stays in the export, linked.
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.memories.find((m: { id: string }) => m.id === wrong.id)).toMatchObject({ status: "superseded", superseded_by: result.replacement.id, prior_status: "user_reported" });
  });

  it("never relabels an AI inference as another provenance", async () => {
    const user = await signUp(ctx);
    const inferred = await ctx.app.get(MemoryService).create(user.userId, { fact: "Might sleep poorly", source: "user_conversation", status: "ai_inferred", confidence: 0.4 });
    await expect(ctx.db.query(`UPDATE health_memories SET status = 'user_reported' WHERE id = $1`, [inferred.id])).rejects.toThrow(/AI inference/);
    await expect(ctx.db.query(`UPDATE health_memories SET status = 'clinician_provided' WHERE id = $1`, [inferred.id])).rejects.toThrow(/AI inference/);
    await expect(ctx.db.query(`UPDATE health_memories SET status = 'user_confirmed' WHERE id = $1`, [inferred.id])).rejects.toThrow(/explicit confirmation/);
    expect((await ctx.db.query<{ status: string }>(`SELECT status FROM health_memories WHERE id = $1`, [inferred.id])).rows[0]!.status).toBe("ai_inferred");
    // Structured history can't hold an inference at all.
    await expect(ctx.db.query(`INSERT INTO health_conditions (user_id, name, source) VALUES ($1, 'Insomnia', 'ai_inferred')`, [user.userId])).rejects.toThrow(/check/);
    await expect(ctx.db.query(`INSERT INTO medications (user_id, name, instruction, source) VALUES ($1, 'X', 'Y', 'ai_inferred')`, [user.userId])).rejects.toThrow(/check/);
    await expect(ctx.db.query(`INSERT INTO treatment_plans (user_id, title, source) VALUES ($1, 'Plan', 'ai_inferred')`, [user.userId])).rejects.toThrow(/check/);
  });
});

describe("records edited in place", () => {
  it("edits only the timeline entries the person added", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    const id = (await ctx.http.post("/v1/timeline").set(user.auth).send({ eventType: "note", title: "Felt dizzy", details: "After standing up" }).expect(201)).body.id;
    const edited = (await ctx.http.patch(`/v1/timeline/${id}`).set(user.auth).send({ title: "Felt light-headed", occurredAt: "2026-09-01T09:00:00Z", details: "" }).expect(200)).body;
    expect(edited).toMatchObject({ id, title: "Felt light-headed", occurredAt: "2026-09-01T09:00:00.000Z", payload: null });
    expect((await ctx.http.get(`/v1/timeline/${id}`).set(user.auth).expect(200)).body.title).toBe("Felt light-headed");
    await ctx.http.get(`/v1/timeline/${id}`).set(other.auth).expect(404);
    await ctx.http.patch(`/v1/timeline/${id}`).set(other.auth).send({ title: "x" }).expect(404);
    const deviceEntry = await ctx.app.get(TimelineService).add(user.userId, { eventType: "measurement", title: "Steps", sourceType: "device", sourceId: null, payload: null });
    await ctx.http.patch(`/v1/timeline/${deviceEntry}`).set(user.auth).send({ title: "Edited" }).expect(403);
  });

  it("renames conversations and edits care records, owner only", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    ctx.ai.on("chat", () => chatAnswer({ memorySuggestions: [] }));
    const convo = (await ctx.http.post("/v1/conversations").set(user.auth).send({ message: "Question about sleep" }).expect(201)).body.conversation.id;
    expect((await ctx.http.patch(`/v1/conversations/${convo}`).set(user.auth).send({ title: "Sleep" }).expect(200)).body.title).toBe("Sleep");
    await ctx.http.patch(`/v1/conversations/${convo}`).set(other.auth).send({ title: "Mine" }).expect(404);

    const provider = (await ctx.http.post("/v1/care/providers").set(user.auth).send({ name: "Dr Lee" }).expect(201)).body.id;
    await ctx.http.patch(`/v1/care/providers/${provider}`).set(user.auth).send({ specialty: "GP", phone: null }).expect(204);
    expect((await ctx.http.get(`/v1/care/providers/${provider}`).set(user.auth).expect(200)).body).toMatchObject({ name: "Dr Lee", specialty: "GP" });
    await ctx.http.get(`/v1/care/providers/${provider}`).set(other.auth).expect(404);
    await ctx.http.patch(`/v1/care/providers/${provider}`).set(other.auth).send({ name: "Hijack" }).expect(404);

    const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const appt = (await ctx.http.post("/v1/care/appointments").set(user.auth).send({ title: "Check-up", startsAt }).expect(201)).body.id;
    const moved = new Date(Date.now() + 8 * 86_400_000).toISOString();
    await ctx.http.patch(`/v1/care/appointments/${appt}`).set(user.auth).send({ title: "Annual check-up", startsAt: moved, careProviderId: provider, notes: "Questions to ask:\n- [ ] Sleep" }).expect(204);
    expect((await ctx.http.get(`/v1/care/appointments/${appt}`).set(user.auth).expect(200)).body).toMatchObject({ title: "Annual check-up", providerName: "Dr Lee", startsAt: moved });
    const timeline = (await ctx.http.get("/v1/timeline?types=appointment").set(user.auth).expect(200)).body.events;
    expect(timeline[0]).toMatchObject({ title: "Annual check-up", occurredAt: moved });
    await ctx.http.patch(`/v1/care/appointments/${appt}`).set(user.auth).send({ status: "completed" }).expect(204);
    await ctx.http.patch(`/v1/care/appointments/${appt}`).set(user.auth).send({ endsAt: startsAt }).expect(400); // ends before it starts
    const othersProvider = (await ctx.http.post("/v1/care/providers").set(other.auth).send({ name: "Dr Other" }).expect(201)).body.id;
    await ctx.http.patch(`/v1/care/appointments/${appt}`).set(user.auth).send({ careProviderId: othersProvider }).expect(404);
    await ctx.http.get(`/v1/care/appointments/${appt}`).set(other.auth).expect(404);
  });
});

describe("notifications", () => {
  it("lists, marks and dismisses only the person's own, and respects their preferences", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    const service = ctx.app.get(NotificationsService);
    const id = (await service.notify(user.userId, { category: "report", title: "Your report summary is ready", link: "/reports/x" }))!;
    await service.notify(user.userId, { category: "account", title: "Password changed" });
    let list = (await ctx.http.get("/v1/notifications").set(user.auth).expect(200)).body;
    expect(list.unreadCount).toBe(2);
    expect((await ctx.http.get("/v1/notifications").set(other.auth).expect(200)).body.notifications).toEqual([]);
    await ctx.http.patch(`/v1/notifications/${id}`).set(other.auth).send({ read: true }).expect(404);
    expect((await ctx.http.patch(`/v1/notifications/${id}`).set(user.auth).send({ read: true }).expect(200)).body.readAt).not.toBeNull();
    await ctx.http.post("/v1/notifications/read-all").set(user.auth).expect(204);
    list = (await ctx.http.get("/v1/notifications").set(user.auth).expect(200)).body;
    expect(list.unreadCount).toBe(0);
    await ctx.http.delete(`/v1/notifications/${id}`).set(other.auth).expect(404);
    await ctx.http.delete(`/v1/notifications/${id}`).set(user.auth).expect(204);
    // Turned off: nothing is created.
    await ctx.http.put("/v1/me/notification-preferences").set(user.auth).send({ insight: false }).expect(200);
    expect(await service.notify(user.userId, { category: "insight", title: "Weekly summary" })).toBeNull();
    // Links stay inside the app.
    await expect(service.notify(user.userId, { category: "report", title: "x", link: "https://evil.example" })).rejects.toThrow(/check/);
  });
});

describe("treatment plans", () => {
  it("records a clinician's plan as the person entered it, owner only", async () => {
    const user = await signUp(ctx);
    const other = await signUp(ctx);
    const plan = (await ctx.http.post("/v1/treatment-plans").set(user.auth).send({ title: "Physio for knee", description: "Exercises as shown by the physiotherapist", source: "clinician_provided", startedOn: "2026-09-01" }).expect(201)).body;
    expect(plan).toMatchObject({ title: "Physio for knee", status: "active", source: "clinician_provided", planItemIds: [] });
    await ctx.http.post("/v1/treatment-plans").set(user.auth).send({ title: "Guess", source: "ai_inferred" }).expect(400);
    await ctx.http.post("/v1/treatment-plans").set(user.auth).send({ title: "Backwards", startedOn: "2026-09-01", endedOn: "2026-08-01" }).expect(400);
    const done = (await ctx.http.patch(`/v1/treatment-plans/${plan.id}`).set(user.auth).send({ status: "completed" }).expect(200)).body;
    expect(done.status).toBe("completed");
    expect(done.endedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await ctx.http.get("/v1/treatment-plans").set(other.auth).expect(200)).body).toEqual([]);
    await ctx.http.patch(`/v1/treatment-plans/${plan.id}`).set(other.auth).send({ status: "stopped" }).expect(404);
    await ctx.http.delete(`/v1/treatment-plans/${plan.id}`).set(other.auth).expect(404);
    await ctx.http.delete(`/v1/treatment-plans/${plan.id}`).set(user.auth).expect(204);
  });
});

describe("export and retention", () => {
  it("exports every part of the record, including history and preferences", async () => {
    const user = await signUp(ctx);
    await ctx.http.put("/v1/me/notification-preferences").set(user.auth).send({ showDetails: true }).expect(200);
    await ctx.http.post("/v1/treatment-plans").set(user.auth).send({ title: "Plan" }).expect(201);
    const exported = (await ctx.http.get("/v1/me/export").set(user.auth).expect(200)).body;
    expect(exported.format).toBe("healthmate-export-v2");
    expect(exported.notificationPreferences).toMatchObject({ show_details: true });
    expect(exported.treatmentPlans).toHaveLength(1);
    for (const key of ["profile", "conditions", "allergies", "medications", "symptoms", "memories", "notifications", "timeline", "documents", "careProviders", "appointments"]) {
      expect(exported, key).toHaveProperty(key);
    }
  });

  it("prunes operational logs past retention but never health data", async () => {
    const user = await signUp(ctx);
    await ctx.db.query(`INSERT INTO audit_logs (user_id, action, created_at) VALUES ($1, 'auth.login', now() - interval '500 days')`, [user.userId]);
    await ctx.db.query(`INSERT INTO health_memories (user_id, fact, source, status, created_at) VALUES ($1, 'Broke wrist as a child', 'user_entry', 'user_reported', now() - interval '20 years')`, [user.userId]);
    const removed = await pruneOperationalRecords(ctx.db, loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv));
    expect(removed.audit_logs).toBeGreaterThanOrEqual(1);
    expect((await ctx.db.query(`SELECT 1 FROM health_memories WHERE user_id = $1`, [user.userId])).rows).toHaveLength(1);
    const keepForever = await pruneOperationalRecords(ctx.db, { AUDIT_LOG_RETENTION_DAYS: 0, AI_USAGE_RETENTION_DAYS: 0, SAFETY_EVENT_RETENTION_DAYS: 0 });
    expect(keepForever).toEqual({});
  });
});

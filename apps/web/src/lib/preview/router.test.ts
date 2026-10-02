import { describe, expect, it, vi } from "vitest";
import type { ConversationDetail, DocumentCreation, DocumentRecord, HealthProfile, PlanRecord } from "@healthmate/shared-types";
import { SAMPLE_NOTICE } from "@healthmate/sample-data";
import { DEFAULT_CONTROLS, type PreviewControls } from "./controls";
import { PREVIEW_FAILURE_REASON, previewFetch, withNoteTriage } from "./router";

const normal = DEFAULT_CONTROLS;
async function call<T>(path: string, method = "GET", body?: unknown, token?: string, controls: PreviewControls = normal) {
  const res = await previewFetch(path, method, body, token, controls);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
async function signIn() {
  const { body } = await call<{ accessToken: string }>("auth/login", "POST", { email: "alex.morgan@example.com", password: "any password", timeZone: "Europe/London" });
  return body.accessToken;
}

describe("preview API", () => {
  it("signs in and serves the sample account", async () => {
    const token = await signIn();
    const me = await call<HealthProfile>("me", "GET", undefined, token);
    expect(me.status).toBe(200);
    expect(me.body.profile.firstName).toBe("Alex");
    expect((await call("me", "GET", undefined, "pv.unknown")).status).toBe(401);
  });

  it("starts a new account with no goals or consents, and saves onboarding", async () => {
    const { body } = await call<{ accessToken: string; isNewUser: boolean }>("auth/oauth", "POST", { provider: "apple", timeZone: "UTC" });
    const token = body.accessToken;
    expect(body.isNewUser).toBe(true);
    expect((await call<HealthProfile>("me", "GET", undefined, token)).body.profile.goals).toEqual([]);
    const consents = await call<{ granted: boolean }[]>("me/consents", "GET", undefined, token);
    expect(consents.body.every((c) => !c.granted)).toBe(true);
    // Same shape as the real API: the profile details, not the whole health profile.
    const patched = await call<Record<string, unknown>>("me/profile", "PATCH", { firstName: "Sam", goals: ["be_active"] }, token);
    expect(patched.body).toMatchObject({ firstName: "Sam", goals: ["be_active"] });
    expect(patched.body).not.toHaveProperty("conditions");
    await call("me/notification-preferences", "PUT", { task: false }, token);
    expect((await call<{ task: boolean }>("me/notification-preferences", "GET", undefined, token)).body.task).toBe(false);
    expect((await call("me/onboarding", "POST", undefined, token)).status).toBe(204);
    expect((await call<{ onboardingCompleted: boolean }>("me/account", "GET", undefined, token)).body.onboardingCompleted).toBe(true);
  });

  it("checks age like production: adults and teens are eligible; under-13s are locked out of health data and can't unlock by retrying", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const yearsAgo = (years: number, days = 0) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCFullYear(d.getUTCFullYear() - years);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const newAccount = async () => (await call<{ accessToken: string }>("auth/oauth", "POST", { provider: "google", timeZone: "UTC" })).body.accessToken;

    const teen = await newAccount();
    const teenResult = await call<{ ageBand: string; eligibility: string }>("me/age", "POST", { dateOfBirth: yearsAgo(13) }, teen);
    expect(teenResult.body).toMatchObject({ ageBand: "13_15", eligibility: "eligible" });
    expect((await call("me", "GET", undefined, teen)).status).toBe(200);

    for (const bad of ["2020-02-30", "not-a-date", yearsAgo(-1)]) expect((await call("me/age", "POST", { dateOfBirth: bad }, teen)).status).toBe(400);

    const child = await newAccount();
    const childResult = await call<{ eligibility: string; deletionScheduledAt: string | null }>("me/age", "POST", { dateOfBirth: yearsAgo(13, 1) }, child);
    expect(childResult.body.eligibility).toBe("age_not_eligible");
    expect(childResult.body.deletionScheduledAt).toEqual(expect.any(String));
    const blocked = await call<{ error: { code: string } }>("me", "GET", undefined, child);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("age_not_eligible");
    expect((await call("health-data/daily?from=2026-01-01&to=2026-01-02", "GET", undefined, child)).status).toBe(403);
    // Account controls stay available.
    expect((await call<{ ageEligibility: string; firstName: string }>("me/account", "GET", undefined, child)).body.ageEligibility).toBe("age_not_eligible");
    expect((await call("me/consents", "GET", undefined, child)).status).toBe(200);
    // Retrying with an adult date doesn't unlock it.
    const retry = await call<{ eligibility: string }>("me/age", "POST", { dateOfBirth: yearsAgo(30) }, child);
    expect(retry.body.eligibility).toBe("age_review");
    expect((await call("me", "GET", undefined, child)).status).toBe(403);
  });

  it("returns the sign-up name with the account summary", async () => {
    const token = await signIn();
    const account = await call<{ firstName?: string }>("me/account", "GET", undefined, token);
    expect(account.body.firstName).toBe("Alex");
  });

  it("AI unavailable: meta says so and new messages are refused, other data still loads", async () => {
    const token = await signIn();
    const controls: PreviewControls = { state: "ai_unavailable" };
    const meta = await call<{ ai: { available: boolean } }>("meta", "GET", undefined, token, controls);
    expect(meta.body.ai.available).toBe(false);
    expect((await call("conversations", "POST", { message: "hello" }, token, controls)).status).toBe(503);
    expect((await call("conversations", "GET", undefined, token, controls)).status).toBe(200);
    expect((await call<HealthProfile>("me", "GET", undefined, token, controls)).status).toBe(200);
  });

  it("renames a conversation and names its timeline entry after it", async () => {
    const token = await signIn();
    const created = await call<ConversationDetail>("conversations", "POST", { message: "Tips for sleeping better" }, token);
    const id = created.body.conversation.id;
    const timeline = await call<{ events: { title: string; sourceId: string | null }[] }>("timeline", "GET", undefined, token);
    expect(timeline.body.events.find((e) => e.sourceId === id)?.title).toBe("AI chat: Tips for sleeping better");
    const renamed = await call<{ title: string }>(`conversations/${id}`, "PATCH", { title: "My sleep routine" }, token);
    expect(renamed.body.title).toBe("My sleep routine");
  });

  it("rejects the documented wrong password and short passwords", async () => {
    expect((await call("auth/login", "POST", { email: "a@b.co", password: "wrong-password" })).status).toBe(401);
    expect((await call("auth/login", "POST", { email: "a@b.co", password: "short" })).status).toBe(401);
  });

  it("verifies new accounts through the preview inbox", async () => {
    const email = `new-${Date.now()}@example.com`;
    expect((await call("auth/register", "POST", { email, password: "long enough", firstName: "Sam", timeZone: "UTC" })).status).toBe(202);
    expect((await call("auth/login", "POST", { email, password: "long enough" })).body).toMatchObject({ error: { code: "email_not_confirmed" } });
    const inbox = await call<{ emails: { link: string }[] }>(`preview/inbox?email=${encodeURIComponent(email)}`);
    const token = new URL(inbox.body.emails[0]!.link, "http://x").searchParams.get("token");
    const verified = await call<{ accessToken: string }>("auth/verify-email", "POST", { token });
    const account = await call<{ onboardingCompleted: boolean }>("me/account", "GET", undefined, verified.body.accessToken);
    expect(account.body.onboardingCompleted).toBe(false);
    expect((await call<HealthProfile>("me", "GET", undefined, verified.body.accessToken)).body.profile.firstName).toBe("Sam");
  });

  it("gives emergencies fixed guidance and labels every sample reply", async () => {
    const token = await signIn();
    const emergency = await call<ConversationDetail>("conversations", "POST", { message: "I have crushing chest pain and I can't breathe" }, token);
    expect(emergency.body.messages[1]!.payload).toMatchObject({ kind: "escalation", escalation: { level: "emergency" } });
    const normalReply = await call<ConversationDetail>("conversations", "POST", { message: "How can I sleep better?" }, token);
    expect(normalReply.body.messages[1]!.payload).toMatchObject({ kind: "answer", notice: SAMPLE_NOTICE });
    const medication = await call<ConversationDetail>("conversations", "POST", { message: "Should I stop taking my medication?" }, token);
    expect(medication.body.messages[1]!.payload).toMatchObject({ kind: "answer", safetyAdjusted: true });
  });

  it("uploads a file and returns a sample result a few seconds later", async () => {
    const token = await signIn();
    const created = await call<DocumentCreation>("documents", "POST", { kind: "report", filename: "labs.pdf", contentType: "application/pdf", byteSize: 1000 }, token);
    expect(created.body.upload.url).toMatch(/^preview-upload:\/\//);
    expect((await call("documents", "POST", { kind: "report", filename: "x.exe", contentType: "application/x-msdownload", byteSize: 10 }, token)).status).toBe(415);
    const processing = await call<{ status: string }>(`documents/${created.body.document.id}/process`, "POST", {}, token);
    expect(processing.body.status).toBe("processing");
  });

  it("a photo note describing an emergency always gets emergency guidance, like the real API", async () => {
    const token = await signIn();
    const results: Record<string, string | undefined> = {};
    for (const [label, note] of [
      ["none", undefined],
      ["emergency", "It's spreading fast and I can't breathe"],
    ] as const) {
      const created = await call<DocumentCreation>("documents", "POST", { kind: "image", purpose: "skin", filename: "arm.jpg", contentType: "image/jpeg", byteSize: 1000 }, token);
      const id = created.body.document.id;
      await call(`documents/${id}/process`, "POST", note ? { note } : {}, token);
      vi.useFakeTimers({ now: Date.now() + 5000 });
      try {
        results[label] = (await call<DocumentRecord>(`documents/${id}`, "GET", undefined, token)).body.result?.careUrgency;
      } finally {
        vi.useRealTimers();
      }
    }
    expect(results).toEqual({ none: "routine", emergency: "emergency" });
    expect(withNoteTriage({ type: "image", model: "sample", injectionDetected: false, careUrgency: "emergency" }, "a bit itchy").careUrgency).toBe("emergency");
  });

  it("a damaged file fails with a reason, so the failed state can be tried", async () => {
    const token = await signIn();
    const created = await call<DocumentCreation>("documents", "POST", { kind: "report", filename: "damaged.pdf", contentType: "application/pdf", byteSize: 1000 }, token);
    const id = created.body.document.id;
    await call(`documents/${id}/process`, "POST", {}, token);
    vi.useFakeTimers({ now: Date.now() + 5000 });
    try {
      const doc = await call<DocumentRecord>(`documents/${id}`, "GET", undefined, token);
      expect(doc.body).toMatchObject({ status: "failed", failureReason: PREVIEW_FAILURE_REASON, result: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces plan revisions like the real API", async () => {
    const token = await signIn();
    const plan = (await call<PlanRecord>("plan", "GET", undefined, token)).body;
    expect((await call("plan", "PUT", { baseRevision: plan.revision, items: plan.items, completions: [] }, token)).status).toBe(200);
    expect((await call("plan", "PUT", { baseRevision: plan.revision, items: [], completions: [] }, token)).status).toBe(409);
  });

  it("simulates empty, error, offline and permission states", async () => {
    const token = await signIn();
    expect((await call<unknown[]>("conversations", "GET", undefined, token, { state: "empty" })).body).toEqual([]);
    expect((await call<HealthProfile>("me", "GET", undefined, token, { state: "empty" })).body.medications).toEqual([]);
    expect((await call("documents", "GET", undefined, token, { state: "error" })).status).toBe(500);
    await expect(call("me", "GET", undefined, token, { state: "offline" })).rejects.toThrow();
    const consents = await call<{ granted: boolean }[]>("me/consents", "GET", undefined, token, { state: "permission" });
    expect(consents.body.every((c) => !c.granted)).toBe(true);
  });

  it("serves daily records and accepts Apple Health sync runs like the real API", async () => {
    const token = await signIn();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const daily = await call<{ records: { day: string; kind: string; source: string }[] }>(`health-data/daily?from=${weekAgo}&to=${today}&kinds=steps`, "GET", undefined, token);
    expect(daily.status).toBe(200);
    expect(daily.body.records.length).toBeGreaterThan(0);
    expect(daily.body.records.every((r) => r.kind === "steps" && r.source === "apple_health" && r.day >= weekAgo && r.day <= today)).toBe(true);
    expect((await call("health-data/daily?from=2026-09-10&to=2026-09-01", "GET", undefined, token)).status).toBe(400);

    const run = await call<{ id: string }>("healthkit/sync-runs", "POST", { kind: "initial_import" }, token);
    expect(run.status).toBe(201);
    const upload = await call<{ upserted: number }>("health-data/daily", "PUT", { timeZone: "UTC", syncRunId: run.body.id, records: [{ day: today, kind: "steps", value: 100, isComplete: false, computedAt: new Date().toISOString() }] }, token);
    expect(upload.body.upserted).toBe(1);
    const finished = await call<{ history?: { status: string } }>(`healthkit/sync-runs/${run.body.id}`, "PATCH", { status: "succeeded", daysSent: 1, recordsUpserted: 1, oldestDay: today, historyComplete: true }, token);
    expect(finished.body.history?.status).toBe("complete");
  });

  it("keeps memories with current/past status and lets people stop the AI using one, like the real API", async () => {
    const token = await signIn();
    const created = await call<{ id: string; temporalStatus: string; aiExcluded: boolean }>("memories", "POST", { fact: "Walks every morning" }, token);
    expect(created.body).toMatchObject({ temporalStatus: "current", aiExcluded: false });
    const excluded = await call<{ aiExcluded: boolean; status: string }>(`memories/${created.body.id}`, "PATCH", { aiExcluded: true }, token);
    expect(excluded.body).toMatchObject({ aiExcluded: true, status: "user_reported" }); // not confirmed by this
    const ended = await call<{ temporalStatus: string }>(`memories/${created.body.id}/end`, "POST", { endedOn: "2026-01-01" }, token);
    expect(ended.body.temporalStatus).toBe("historical");
    const past = await call<{ id: string }[]>("memories?status=historical", "GET", undefined, token);
    expect(past.body.map((m) => m.id)).toContain(created.body.id);
    expect((await call("memories", "DELETE", { confirm: "yes" }, token)).status).toBe(400);
  });

  it("marks notifications read", async () => {
    const token = await signIn();
    const list = await call<{ unreadCount: number }>("notifications", "GET", undefined, token);
    expect(list.body.unreadCount).toBeGreaterThan(0);
    await call("notifications/read-all", "POST", {}, token);
    expect((await call<{ unreadCount: number }>("notifications", "GET", undefined, token)).body.unreadCount).toBe(0);
  });
});

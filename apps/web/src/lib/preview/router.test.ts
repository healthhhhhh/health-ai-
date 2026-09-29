import { describe, expect, it } from "vitest";
import type { ConversationDetail, DocumentCreation, HealthProfile, PlanRecord } from "@healthmate/shared-types";
import { SAMPLE_NOTICE } from "@healthmate/sample-data";
import { DEFAULT_CONTROLS, type PreviewControls } from "./controls";
import { previewFetch } from "./router";

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

  it("marks notifications read", async () => {
    const token = await signIn();
    const list = await call<{ unreadCount: number }>("notifications", "GET", undefined, token);
    expect(list.body.unreadCount).toBeGreaterThan(0);
    await call("notifications/read-all", "POST", {}, token);
    expect((await call<{ unreadCount: number }>("notifications", "GET", undefined, token)).body.unreadCount).toBe(0);
  });
});

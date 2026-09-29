import { describe, expect, it } from "vitest";
import { buildSampleAccount, localDay, SAMPLE_NOTICE } from "./account";

const now = new Date("2026-09-29T09:30:00Z");
const account = buildSampleAccount(now, "Asia/Kolkata");

describe("sample account", () => {
  it("is anchored to today in the viewer's time zone", () => {
    expect(account.generatedFor).toBe(localDay(now, "Asia/Kolkata"));
    expect(account.measurements.daily.steps!.at(-1)!.date).toBe(account.generatedFor);
    expect(account.profile.profile.timeZone).toBe("Asia/Kolkata");
  });

  it("puts times of day in the viewer's local time", () => {
    const med = account.notifications.find((n) => n.category === "medication")!;
    const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }).format(new Date(med.createdAt));
    expect(local).toBe("08:00");
  });

  it("uses unique ids everywhere", () => {
    const ids = JSON.stringify(account).match(/"id":"[^"]+"/g)!;
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never invents medication names, doses or clinician instructions", () => {
    for (const m of account.profile.medications) {
      expect(m.name).toMatch(/^(Morning|Evening|Previous) medication$/);
      expect(m.instruction).toBe("As prescribed by your clinician");
    }
    for (const item of account.plan.items.filter((i) => i.kind === "medication")) {
      expect(item.instruction).toBe("As prescribed by your clinician");
    }
    expect(JSON.stringify(account)).not.toMatch(/\b\d+\s?(mg|mcg|µg|units?)\b/i);
  });

  it("keeps clinical sample content visibly generic", () => {
    for (const c of account.profile.conditions) expect(c.name).toMatch(/^Example /);
    for (const a of account.profile.allergies) expect(a.substance).toMatch(/^Example /);
    for (const f of account.sampleAnalyses.report.findings!) expect(f.name).toMatch(/^Example marker/);
  });

  it("labels every sample AI reply", () => {
    for (const r of [...account.replies.map((r) => r.answer), account.fallbackReply]) expect(r.notice).toBe(SAMPLE_NOTICE);
    for (const c of account.conversations) for (const m of c.messages.filter((m) => m.role === "assistant")) expect(m.payload && "notice" in m.payload ? m.payload.notice : null).toBe(SAMPLE_NOTICE);
  });

  it("has upcoming and past appointments, unread notifications and an overdue task", () => {
    expect(account.appointments.some((a) => a.status === "scheduled" && new Date(a.startsAt) > now)).toBe(true);
    expect(account.appointments.some((a) => new Date(a.startsAt) < now)).toBe(true);
    expect(account.notifications.some((n) => n.readAt === null)).toBe(true);
    const overdue = account.plan.items.find((i) => i.repeat.type === "once" && i.repeat.day < account.generatedFor);
    expect(overdue).toBeDefined();
  });

  it("is deterministic", () => {
    expect(JSON.stringify(buildSampleAccount(now, "Asia/Kolkata"))).toBe(JSON.stringify(account));
  });
});

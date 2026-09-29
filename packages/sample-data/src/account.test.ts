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

describe("sample health data", () => {
  const d = account.measurements.daily;
  const byDate = (kind: keyof typeof d) => new Map(d[kind]!.map((p) => [p.date, p.value]));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  // Full days only (today's steps and energy are partial).
  const fullDays = d.steps!.slice(0, -1).map((p) => p.date);

  it("covers 180 days, one person, in believable ranges", () => {
    expect(d.steps).toHaveLength(180);
    for (const p of d.sleep!) expect(p.value).toBeGreaterThanOrEqual(300), expect(p.value).toBeLessThanOrEqual(540);
    for (const date of fullDays) expect(byDate("steps").get(date)!).toBeGreaterThanOrEqual(1800), expect(byDate("steps").get(date)!).toBeLessThanOrEqual(16000);
    for (const p of d.resting_heart_rate!) expect(p.value).toBeGreaterThanOrEqual(56), expect(p.value).toBeLessThanOrEqual(72);
    for (const p of d.weight!) expect(p.value).toBeGreaterThan(71), expect(p.value).toBeLessThan(75);
  });

  it("links the metrics: activity drives energy and heart rate; average heart rate sits above resting", () => {
    const steps = byDate("steps");
    const energy = byDate("active_energy");
    const hr = byDate("heart_rate");
    const rhr = byDate("resting_heart_rate");
    const sorted = [...fullDays].sort((a, b) => steps.get(a)! - steps.get(b)!);
    const low = sorted.slice(0, 20);
    const high = sorted.slice(-20);
    expect(avg(high.map((x) => energy.get(x)!))).toBeGreaterThan(avg(low.map((x) => energy.get(x)!)) + 100);
    expect(avg(high.map((x) => hr.get(x)!))).toBeGreaterThan(avg(low.map((x) => hr.get(x)!)));
    for (const date of fullDays) expect(hr.get(date)!).toBeGreaterThan(rhr.get(date)!);
  });

  it("changes gradually: fitness lowers resting heart rate and weight drifts down, with no wild day-to-day jumps", () => {
    const first = (kind: keyof typeof d) => avg(d[kind]!.slice(0, 21).map((p) => p.value));
    const last = (kind: keyof typeof d) => avg(d[kind]!.slice(-21).map((p) => p.value));
    expect(last("resting_heart_rate")).toBeLessThan(first("resting_heart_rate"));
    expect(last("weight")).toBeLessThan(first("weight"));
    const weights = d.weight!.map((p) => p.value);
    for (let i = 1; i < weights.length; i++) expect(Math.abs(weights[i]! - weights[i - 1]!)).toBeLessThanOrEqual(0.8);
  });

  it("is the same on every run", () => {
    expect(buildSampleAccount(now, "Asia/Kolkata").measurements).toEqual(account.measurements);
  });
});

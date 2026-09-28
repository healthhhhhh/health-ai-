import { describe, expect, it } from "vitest";
import type { TimelineEventRecord } from "@healthmate/shared-types";
import { buildHomeSummary, trendOf } from "./home";

const now = new Date("2026-09-28T12:00:00Z");
const profile = { firstName: "Sam", lastName: "", dateOfBirth: null, sex: null, heightCm: null, timeZone: "UTC" };
const event = (id: string, eventType: TimelineEventRecord["eventType"], hours: number, sourceType: TimelineEventRecord["sourceType"] = "user_entered"): TimelineEventRecord => ({
  id,
  eventType,
  title: id,
  occurredAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
  sourceType,
  sourceId: null,
});
const base = { profile, timeline: [], latestMood: null, latest: [], trends: {}, now };

describe("buildHomeSummary", () => {
  it("is empty and honest without data", () => {
    const s = buildHomeSummary(base);
    expect(s.user.firstName).toBe("Sam");
    expect(s.metrics).toEqual([]);
    expect(s.tasks).toEqual([]);
    expect(s.insight).toBeUndefined();
    expect(s.unreadNotifications).toBe(0);
  });

  it("shows only today's synced measurements", () => {
    const s = buildHomeSummary({
      ...base,
      latest: [
        { kind: "steps", value: 5400, unit: "count", recordedAt: "2026-09-28T09:00:00Z", source: "apple_health" },
        { kind: "heart_rate", value: 64, unit: "bpm", recordedAt: "2026-09-26T09:00:00Z", source: "apple_health" },
      ],
      trends: { steps: { kind: "steps", unit: "count", points: [], average: 8000, previousAverage: 7800 } },
    });
    expect(s.metrics).toEqual([expect.objectContaining({ kind: "steps", value: 5400, unit: "steps", source: "apple_health", trend: "in_usual_range" })]);
  });

  it("maps timeline to recent activity and future appointments", () => {
    const s = buildHomeSummary({ ...base, timeline: [event("old-report", "report", -30, "document"), event("note", "note", -1), event("visit", "appointment", 24), event("past-visit", "appointment", -24)] });
    expect(s.recentActivity.map((a) => a.id)).toEqual(["note", "past-visit", "old-report"]);
    expect(s.recentActivity[2]).toMatchObject({ kind: "report", source: "document_extracted" });
    expect(s.upcomingAppointments.map((a) => a.title)).toEqual(["visit"]);
    expect(s.upcomingAppointments[0]?.clinicianName).toBe("");
  });

  it("keeps only today's mood", () => {
    expect(buildHomeSummary({ ...base, latestMood: { mood: "low", recordedAt: "2026-09-27T20:00:00Z" } }).todayMood).toBeUndefined();
    expect(buildHomeSummary({ ...base, latestMood: { mood: "good", recordedAt: "2026-09-28T08:00:00Z" } }).todayMood?.mood).toBe("good");
  });
});

describe("trendOf", () => {
  it("compares with the person's own previous period", () => {
    expect(trendOf(undefined)).toBe("no_baseline");
    expect(trendOf({ kind: "steps", unit: "count", points: [], average: 9000, previousAverage: null })).toBe("no_baseline");
    expect(trendOf({ kind: "steps", unit: "count", points: [], average: 9000, previousAverage: 6000 })).toBe("above_usual");
    expect(trendOf({ kind: "steps", unit: "count", points: [], average: 4000, previousAverage: 6000 })).toBe("below_usual");
  });
});

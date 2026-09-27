import type { HomeSummary } from "@healthmate/shared-types";

/**
 * SAMPLE DATA — for UI development only.
 *
 * Values mirror the design reference so screens can be compared visually.
 * They are not medical guidance and are not real user data: every record is
 * tagged `source: "sample"`. Task wording is intentionally generic — the app
 * never invents medication names, doses or clinician instructions.
 */
export function buildSampleHomeSummary(now: Date): HomeSummary {
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const ahead = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

  return {
    user: { id: "sample-user", firstName: "Alex", lastName: "Morgan", timeZone: "UTC" },
    unreadNotifications: 2,
    metrics: [
      { kind: "heart_rate", value: 72, unit: "bpm", recordedAt: ago(20), source: "sample", trend: "in_usual_range" },
      { kind: "steps", value: 6428, unit: "steps", recordedAt: ago(15), source: "sample", trend: "in_usual_range", goal: 10000 },
      { kind: "sleep", value: 432, unit: "min", recordedAt: ago(600), source: "sample", trend: "in_usual_range" },
      { kind: "calories", value: 420, unit: "kcal", recordedAt: ago(15), source: "sample", trend: "no_baseline" },
    ],
    tasks: [
      { id: "t1", title: "Morning medication", detail: "As prescribed · after breakfast", category: "medication", scheduledTime: "08:00", completed: true, source: "sample" },
      { id: "t2", title: "Drink water", detail: "3 of 5 glasses", category: "hydration", scheduledTime: "09:00", completed: false, source: "sample" },
      { id: "t3", title: "Log blood pressure", detail: "Take a reading", category: "measurement", scheduledTime: "10:00", completed: true, source: "sample" },
      { id: "t4", title: "Evening walk", detail: "30 minutes", category: "activity", scheduledTime: "18:00", completed: false, source: "sample" },
      { id: "t5", title: "Wind down for sleep", detail: "Target 7–8 hours", category: "sleep", scheduledTime: "22:30", completed: false, source: "sample" },
    ],
    recentActivity: [
      { id: "a1", kind: "report", title: "Blood test report analyzed", occurredAt: ago(120), source: "sample" },
      { id: "a2", kind: "medication", title: "Morning medication completed", occurredAt: ago(240), source: "sample" },
      { id: "a3", kind: "chat", title: "AI chat: headache follow-up", occurredAt: ago(360), source: "sample" },
      { id: "a4", kind: "sync", title: "Sleep data synced from Apple Health", occurredAt: ago(480), source: "sample" },
    ],
    upcomingAppointments: [
      { id: "ap1", title: "Annual check-up", clinicianName: "Dr. Sam Lee", specialty: "General practice", startsAt: ahead(60 * 24 * 3 + 90), mode: "in_person" },
      { id: "ap2", title: "Follow-up call", clinicianName: "Dr. Rivera", specialty: "Dermatology", startsAt: ahead(60 * 24 * 9), mode: "video" },
    ],
    insight: {
      id: "i1",
      message: "You've slept about 25 minutes longer on average this week than last week, and your step count is trending up.",
      basedOn: "your sleep and activity data from the last 14 days",
      generatedAt: ago(30),
      source: "sample",
    },
  };
}

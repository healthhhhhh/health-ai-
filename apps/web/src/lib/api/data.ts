import type {
  AccountSummary,
  ApiMeta,
  AppointmentRecord,
  HealthProfile,
  LatestMeasurement,
  MeasurementKind,
  MoodCheckIn,
  NotificationList,
  PlanRecord,
  TimelinePage,
  TrendResponse,
} from "@healthmate/shared-types";
import { cache } from "react";
import { buildHomeSummary, HOME_METRICS } from "../home";
import { dayIn, tasksForDay } from "../plan";
import { api, ApiError, publicApi } from "./server";

/** Per-request cached loaders (server only). */
export const getProfile = cache(() => api<HealthProfile>("me"));
export const getMeta = cache(() => publicApi<ApiMeta>("meta").catch(() => null));
/** Null when the API server doesn't have this endpoint yet (then onboarding is treated as done). */
export const getAccount = cache(() =>
  api<AccountSummary>("me/account").catch((error) => {
    if (error instanceof ApiError && (error.status === 404 || error.status === 501)) return null;
    throw error;
  }),
);
export const getPlan = cache(() => api<PlanRecord>("plan"));

/** Home sections that couldn't load; each shows its own retry instead of a misleading empty state. */
export type HomeSection = "activity" | "metrics" | "plan" | "appointments" | "mood";

export async function getHomeSummary(now = new Date()) {
  const failed = new Set<HomeSection>();
  const orFail = <T,>(section: HomeSection, fallback: T) => (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) throw error;
    failed.add(section);
    return fallback;
  };
  const [profile, timeline, mood, latest, plan, appointments, ...trends] = await Promise.all([
    getProfile(),
    api<TimelinePage>("timeline").catch(orFail("activity", { events: [], nextCursor: null })),
    api<{ checkIn: MoodCheckIn | null }>("check-ins/mood/latest").catch(orFail("mood", { checkIn: null })),
    api<LatestMeasurement[]>("health-data/latest").catch(orFail("metrics", [])),
    getPlan().catch(orFail("plan", { revision: 0, items: [], completions: [] })),
    // Care appointments (Preview mode); an API without them falls back to timeline appointments.
    api<AppointmentRecord[]>("care/appointments?when=upcoming").catch(() => null),
    ...HOME_METRICS.map(([kind]) => api<TrendResponse>(`health-data/trends?kind=${kind}&days=7`).catch(() => undefined)),
  ]);
  const summary = buildHomeSummary({
    profile: profile.profile,
    timeline: timeline.events,
    latestMood: mood.checkIn,
    latest,
    trends: Object.fromEntries(HOME_METRICS.map(([kind], i) => [kind, trends[i]])) as Partial<Record<MeasurementKind, TrendResponse>>,
    now,
  });
  summary.tasks = tasksForDay(plan, dayIn(now, profile.profile.timeZone));
  const upcoming = appointments
    ?.filter((a) => a.status === "scheduled" && new Date(a.startsAt) > now)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 3);
  return { ...summary, appointments: upcoming ?? null, failed: [...failed] };
}

/** Unread count for the bell; null when notifications can't be loaded (the bell still links to the list). */
export const getUnreadNotifications = cache(() =>
  api<NotificationList>("notifications")
    .then((list) => list.unreadCount)
    .catch((error) => {
      if (error instanceof ApiError && error.status === 401) throw error;
      return null;
    }),
);

/**
 * Applies a change to the plan against the latest revision, retrying if it
 * was changed elsewhere (e.g. on the iPhone) in the meantime.
 */
export async function updatePlan(change: (plan: PlanRecord) => Pick<PlanRecord, "items" | "completions">): Promise<PlanRecord> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await api<PlanRecord>("plan");
    const next = change(current);
    try {
      return await api<PlanRecord>("plan", { method: "PUT", json: { baseRevision: current.revision, ...next } });
    } catch (error) {
      if (!(error instanceof ApiError && error.code === "plan_conflict")) throw error;
    }
  }
  throw new ApiError("Your plan is being changed somewhere else. Please try again.", 409, "plan_conflict");
}

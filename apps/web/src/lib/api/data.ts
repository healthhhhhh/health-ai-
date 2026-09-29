import type {
  AccountSummary,
  ApiMeta,
  HealthProfile,
  LatestMeasurement,
  MeasurementKind,
  MoodCheckIn,
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

export async function getHomeSummary(now = new Date()) {
  const [profile, timeline, mood, latest, plan, ...trends] = await Promise.all([
    getProfile(),
    api<TimelinePage>("timeline").catch(() => ({ events: [], nextCursor: null })),
    api<{ checkIn: MoodCheckIn | null }>("check-ins/mood/latest").catch(() => ({ checkIn: null })),
    api<LatestMeasurement[]>("health-data/latest").catch(() => []),
    getPlan().catch(() => ({ revision: 0, items: [], completions: [] })),
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
  return summary;
}

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

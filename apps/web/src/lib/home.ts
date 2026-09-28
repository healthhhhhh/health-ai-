import type {
  ActivityEvent,
  ActivityKind,
  Appointment,
  DataSource,
  HealthMetric,
  HealthProfile,
  HomeSummary,
  LatestMeasurement,
  MeasurementKind,
  MetricKind,
  MetricTrend,
  MoodCheckIn,
  TimelineEventRecord,
  TrendResponse,
} from "@healthmate/shared-types";

/** Measurement kinds shown on Home, in order, with their Home metric kind. */
export const HOME_METRICS: [MeasurementKind, MetricKind][] = [
  ["heart_rate", "heart_rate"],
  ["steps", "steps"],
  ["sleep", "sleep"],
  ["active_energy", "calories"],
];

export interface HomeInputs {
  profile: HealthProfile["profile"];
  timeline: TimelineEventRecord[];
  latestMood: MoodCheckIn | null;
  latest: LatestMeasurement[];
  trends: Partial<Record<MeasurementKind, TrendResponse>>;
  now: Date;
}

/**
 * Builds Home from the person's real data. Nothing is invented: metrics come
 * from synced measurements recorded today, activity and appointments from their
 * timeline, and sections without data stay empty. Mirrors HomeSummaryBuilder (Swift).
 */
export function buildHomeSummary(inputs: HomeInputs): HomeSummary {
  const { profile, now } = inputs;
  const today = dayKey(now, profile.timeZone);
  return {
    user: { id: "me", firstName: profile.firstName, lastName: profile.lastName, timeZone: profile.timeZone },
    metrics: HOME_METRICS.flatMap(([kind, metric]) => {
      const m = inputs.latest.find((l) => l.kind === kind);
      if (!m || dayKey(new Date(m.recordedAt), profile.timeZone) !== today) return [];
      return [
        {
          kind: metric,
          value: m.value,
          unit: m.unit === "count" ? "steps" : m.unit,
          recordedAt: m.recordedAt,
          source: m.source === "apple_health" ? "apple_health" : "user_reported",
          trend: trendOf(inputs.trends[kind]),
        } satisfies HealthMetric,
      ];
    }),
    todayMood: inputs.latestMood && dayKey(new Date(inputs.latestMood.recordedAt), profile.timeZone) === today ? inputs.latestMood : undefined,
    tasks: [],
    recentActivity: inputs.timeline
      .filter((e) => new Date(e.occurredAt) <= now)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, 5)
      .map((e): ActivityEvent => ({ id: e.id, kind: activityKind(e.eventType), title: e.title, occurredAt: e.occurredAt, source: dataSource(e.sourceType) })),
    upcomingAppointments: inputs.timeline
      .filter((e) => e.eventType === "appointment" && new Date(e.occurredAt) > now)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
      .slice(0, 3)
      .map((e): Appointment => ({ id: e.id, title: e.title, clinicianName: "", specialty: "", startsAt: e.occurredAt, mode: "in_person" })),
    unreadNotifications: 0,
  };
}

/** Last period vs the one before, the same ±10% "usual range" rule as iOS. Needs a previous period to compare. */
export function trendOf(trend: TrendResponse | undefined): MetricTrend {
  if (!trend || trend.average == null || trend.previousAverage == null || trend.previousAverage <= 0) return "no_baseline";
  const change = (trend.average - trend.previousAverage) / trend.previousAverage;
  if (Math.abs(change) <= 0.1) return "in_usual_range";
  return change > 0 ? "above_usual" : "below_usual";
}

function dayKey(date: Date, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function activityKind(type: TimelineEventRecord["eventType"]): ActivityKind {
  switch (type) {
    case "report":
    case "image":
    case "medication":
    case "chat":
    case "symptom":
    case "measurement":
    case "appointment":
    case "note":
      return type;
    default:
      return "note";
  }
}

function dataSource(source: TimelineEventRecord["sourceType"]): DataSource {
  switch (source) {
    case "device":
      return "apple_health";
    case "document":
      return "document_extracted";
    case "clinician":
      return "clinician_provided";
    case "ai_summary":
      return "ai_inferred";
    default:
      return "user_reported";
  }
}

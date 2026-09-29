import type { MeasurementKind, MetricKind, TimelineEventRecord } from "@healthmate/shared-types";

/**
 * In-app destinations shared by Home, the timeline and notifications. Paths
 * are the web routes; iOS maps the same paths to screens (`AppRoute`).
 */
export const METRIC_DETAIL_KINDS: MeasurementKind[] = ["steps", "heart_rate", "resting_heart_rate", "sleep", "active_energy", "weight"];

export function metricHref(kind: MeasurementKind | MetricKind): string {
  const measurement = kind === "calories" ? "active_energy" : kind;
  return (METRIC_DETAIL_KINDS as string[]).includes(measurement) ? `/health/${measurement}` : "/health";
}

/** Where a timeline entry opens: its report, conversation, appointment or metric; otherwise the timeline. */
export function timelineHref(event: Pick<TimelineEventRecord, "eventType" | "sourceId" | "payload">): string {
  const id = event.sourceId ? encodeURIComponent(event.sourceId) : null;
  switch (event.eventType) {
    case "report":
    case "image":
      return id ? `/reports/${id}` : "/reports";
    case "chat":
      return id ? `/chat?c=${id}` : "/chat";
    case "appointment":
      return id ? `/care/appointments/${id}` : "/care";
    case "measurement": {
      const kind = event.payload?.kind;
      return typeof kind === "string" ? metricHref(kind as MeasurementKind) : "/health";
    }
    case "medication":
      return "/plans";
    default:
      return "/timeline";
  }
}

const KNOWN_LINKS = [
  /^\/home$/,
  /^\/notifications$/,
  /^\/chat(\?c=[\w-]+)?$/,
  /^\/reports(\/[\w-]+)?$/,
  /^\/health(\/[a-z_]+)?$/,
  /^\/plans(\/[\w-]+)?$/,
  /^\/care(\/appointments\/[\w-]+)?$/,
  /^\/timeline$/,
  /^\/profile$/,
  /^\/settings(\/account)?$/,
];

/** A notification's link, if it points somewhere this app has; anything else is dropped. */
export function safeInAppLink(link: string | null | undefined): string | null {
  if (!link) return null;
  return KNOWN_LINKS.some((pattern) => pattern.test(link)) ? link : null;
}

/**
 * How remembered facts are described to the AI Health Assistant: always with
 * where they came from and when, so old information is never presented as
 * current and AI inferences are never presented as facts.
 * See docs/health-memory-architecture.md §5. Pure functions (unit-tested).
 */

export type Provenance = "user_reported" | "user_confirmed" | "document_extracted" | "healthkit" | "clinician_provided" | "ai_inferred" | "superseded";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  user_reported: "User reported",
  user_confirmed: "User confirmed",
  document_extracted: "From an uploaded document (not verified by a clinician)",
  clinician_provided: "Clinician provided",
  healthkit: "From Apple Health",
  ai_inferred: "Unconfirmed AI inference — not verified; do not treat as fact",
  superseded: "Superseded — no longer accurate",
};

const MS_PER_DAY = 86_400_000;
const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / MS_PER_DAY;

/** "today", "3 days ago", "about 2 weeks ago", "about 3 months ago", "about 2 years ago" (dates as YYYY-MM-DD). */
export function relativeAge(day: string, today: string): string {
  const days = Math.round(dayNumber(today) - dayNumber(day));
  if (Number.isNaN(days)) return "date unknown";
  if (days < 0) return days === -1 ? "tomorrow" : `in ${-days} days`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`;
  if (days < 365 * 2) return `about ${Math.round(days / 30.44)} months ago`;
  return `about ${Math.round(days / 365.25)} years ago`;
}

export interface ContextMemory {
  fact: string;
  status: Provenance;
  /** When it happened / was true (YYYY-MM-DD), when known. */
  occurredOn?: string | null;
  /** When it stopped being true (YYYY-MM-DD), when known. */
  endedOn?: string | null;
  /** When HealthMate recorded it (ISO). Used when occurredOn is unknown. */
  createdAt: string;
}

/** One line, e.g. "User reported: Evening headaches (about 3 months ago, 2026-06-30)". */
export function describeMemory(memory: ContextMemory, today: string): string {
  const occurred = memory.occurredOn ?? null;
  const day = occurred ?? memory.createdAt.slice(0, 10);
  const when = occurred ? `${relativeAge(day, today)}, ${day}` : `recorded ${relativeAge(day, today)}, ${day}`;
  const ended = memory.endedOn ? `; no longer current since ${memory.endedOn}` : "";
  return `${PROVENANCE_LABEL[memory.status]}: ${memory.fact} (${when}${ended})`;
}

/** The memory section of the health context. Superseded facts are never included. */
export function describeMemories(memories: ContextMemory[], today: string): string {
  const lines = memories.filter((m) => m.status !== "superseded").map((m) => `- ${describeMemory(m, today)}`);
  return lines.length ? lines.join("\n") : "- none";
}

import type { AppointmentMode, AppointmentRecord } from "@healthmate/shared-types";

export const APPOINTMENT_MODES: { id: AppointmentMode; label: string }[] = [
  { id: "in_person", label: "In person" },
  { id: "video", label: "Video call" },
  { id: "phone", label: "Phone call" },
];

export function modeLabel(mode: AppointmentMode | null): string | null {
  return APPOINTMENT_MODES.find((m) => m.id === mode)?.label ?? null;
}

/** Upcoming (scheduled, not yet started) soonest first; everything else as past, newest first. Mirrors Swift `AppointmentList`. */
export function splitAppointments(list: AppointmentRecord[], now = new Date()) {
  const iso = now.toISOString();
  const upcoming = list.filter((a) => a.status === "scheduled" && a.startsAt >= iso).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const past = list.filter((a) => !upcoming.includes(a)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  return { upcoming, past };
}

export interface PrepQuestion {
  text: string;
  done: boolean;
}

const PREP_HEADING = "Questions to ask:";

/**
 * Appointment notes with a "Questions to ask:" checklist kept in the same text
 * ("- [ ] question" / "- [x] question"), so no extra storage is needed.
 */
export function parsePrep(notes: string | null): { notes: string; questions: PrepQuestion[] } {
  const text = notes ?? "";
  const at = text.indexOf(PREP_HEADING);
  if (at === -1) return { notes: text.trim(), questions: [] };
  const questions: PrepQuestion[] = [];
  const rest: string[] = [];
  for (const line of text.slice(at + PREP_HEADING.length).split("\n")) {
    const m = /^\s*- \[( |x)\] (.+)$/i.exec(line);
    if (m) questions.push({ done: m[1]!.toLowerCase() === "x", text: m[2]!.trim() });
    else if (line.trim()) rest.push(line);
  }
  return { notes: [text.slice(0, at).trim(), ...rest].filter(Boolean).join("\n").trim(), questions };
}

export function serializePrep(notes: string, questions: PrepQuestion[]): string | null {
  const block = questions.length ? [PREP_HEADING, ...questions.map((q) => `- [${q.done ? "x" : " "}] ${q.text.replace(/\s+/g, " ").trim()}`)].join("\n") : "";
  const out = [notes.trim(), block].filter(Boolean).join("\n\n");
  return out || null;
}

/** Suggested questions to start from; the person edits or removes them. */
export const PREP_SUGGESTIONS = [
  "What should I expect from this visit?",
  "Are there any results I should know about?",
  "Is there anything I should do differently before my next visit?",
  "Who should I contact if something changes?",
];

/** A "YYYY-MM-DD" + "HH:mm" wall-clock time in a time zone, as an ISO instant. */
export function zonedIso(day: string, time: string, timeZone: string): string {
  const guess = new Date(`${day}T${time}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() - (shown - guess.getTime())).toISOString();
}

/** The wall-clock day and time of an instant in a time zone. */
export function zonedParts(iso: string, timeZone: string): { day: string; time: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  return { day, time };
}

import type { TimelineEventRecord } from "@healthmate/shared-types";

/** Timeline filters, the same on iOS (`TimelineFilter`). */
export const TIMELINE_FILTERS = [
  { id: "all", label: "All", types: [], empty: "Reports you upload, conversations and anything you add will appear here in order." },
  { id: "reports", label: "Reports & photos", types: ["report", "image"], empty: "Reports and photos you upload appear here." },
  { id: "conversations", label: "Conversations", types: ["chat"], empty: "Conversations with the AI Health Assistant appear here." },
  { id: "symptoms", label: "Symptoms", types: ["symptom"], empty: "Symptoms you log appear here." },
  { id: "medications", label: "Medications", types: ["medication"], empty: "Medications you take from your plan appear here." },
  { id: "readings", label: "Readings", types: ["measurement"], empty: "Readings from Apple Health or that you add appear here." },
  { id: "appointments", label: "Appointments", types: ["appointment"], empty: "Appointments you add appear here." },
  { id: "notes", label: "Notes", types: ["note"], empty: "Notes you add appear here." },
] as const satisfies readonly { id: string; label: string; types: readonly TimelineEventRecord["eventType"][]; empty: string }[];

export type TimelineFilterId = (typeof TIMELINE_FILTERS)[number]["id"];

export function timelineFilter(id: string | undefined) {
  return TIMELINE_FILTERS.find((f) => f.id === id) ?? TIMELINE_FILTERS[0];
}

/** Where an entry came from (the timeline always shows its source). */
export const TIMELINE_SOURCE: Record<TimelineEventRecord["sourceType"], string> = {
  user_entered: "Added by you",
  device: "From a device",
  document: "From a report",
  clinician: "From your clinician",
  ai_summary: "AI-generated summary",
};

export const TIMELINE_TYPE: Record<TimelineEventRecord["eventType"], string> = {
  report: "Report",
  image: "Photo",
  chat: "Conversation",
  symptom: "Symptom",
  medication: "Medication",
  measurement: "Reading",
  appointment: "Appointment",
  note: "Note",
};

/** Only entries the person added can be edited or deleted (never documents, devices, clinicians or conversations). */
export function isEditable(entry: Pick<TimelineEventRecord, "sourceType" | "eventType">): boolean {
  return entry.sourceType === "user_entered" && entry.eventType !== "chat" && entry.eventType !== "measurement";
}

/** Free-text details saved with an entry, if any. */
export function entryDetails(entry: Pick<TimelineEventRecord, "payload">): string | null {
  const details = entry.payload?.details;
  return typeof details === "string" && details.trim() ? details : null;
}

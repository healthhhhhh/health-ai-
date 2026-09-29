/**
 * PREVIEW-MODE SAMPLE ACCOUNT (Phase 1 UI only).
 *
 * A fictional person, "Alex Morgan", so every screen can be shown with
 * realistic-looking data without a backend. Rules (CLAUDE.md):
 * - Every record is sample data; the apps show a Preview notice.
 * - Wellness numbers (steps, sleep, heart rate…) are realistic, generated.
 * - Clinical fields stay GENERIC: no real diagnoses, medication names, doses,
 *   test results or clinician instructions are invented. Medications read
 *   "Morning medication — as prescribed"; lab markers are "Example marker".
 * - AI-written text is marked as a sample response, never as real advice.
 */
import type {
  AccountSummary,
  AnalysisResult,
  AppointmentRecord,
  CareProviderRecord,
  ConsentRecord,
  ConversationDetail,
  DocumentRecord,
  HealthKitConnection,
  HealthProfile,
  LatestMeasurement,
  MeasurementKind,
  MemoryRecord,
  NotificationPreferences,
  NotificationRecord,
  PlanCompletionRecord,
  PlanItemRecord,
  PlanRecord,
  SymptomEventRecord,
  SymptomRecord,
  TimelineEventRecord,
  AssistantAnswer,
} from "@healthmate/shared-types";

export type SampleMood = "great" | "good" | "okay" | "low" | "unwell";

export interface DailyPoint {
  date: string;
  value: number;
  min: number;
  max: number;
  count: number;
}

export interface SampleReply {
  /** Lower-case keywords; the first reply whose keyword appears in the message is used. */
  keywords: string[];
  answer: AssistantAnswer;
}

export interface SampleAccount {
  /** The date the dataset was generated for; loaders shift every date by whole days to "today". */
  generatedFor: string;
  account: AccountSummary;
  profile: HealthProfile;
  memories: MemoryRecord[];
  consents: ConsentRecord[];
  conversations: ConversationDetail[];
  documents: DocumentRecord[];
  measurements: { latest: LatestMeasurement[]; daily: Partial<Record<MeasurementKind, DailyPoint[]>> };
  timeline: TimelineEventRecord[];
  plan: PlanRecord;
  moods: { mood: SampleMood; recordedAt: string }[];
  providers: CareProviderRecord[];
  appointments: AppointmentRecord[];
  symptoms: (SymptomRecord & { events: SymptomEventRecord[] })[];
  notifications: NotificationRecord[];
  notificationPreferences: NotificationPreferences;
  healthKit: HealthKitConnection;
  /** Controlled chat replies for Preview mode (never a real AI). */
  replies: SampleReply[];
  fallbackReply: AssistantAnswer;
  /** Results shown for files uploaded in Preview mode. */
  sampleAnalyses: { report: AnalysisResult; image: AnalysisResult; unreadableReport: AnalysisResult; poorImage: AnalysisResult };
}

export const SAMPLE_NOTICE = "Sample response in Preview mode — not a real AI and not medical advice.";
export const SAMPLE_EMAIL = "alex.morgan@example.com";
/** Days of daily measurements in the sample account: the longest chart range (90 days) plus the 90 before it to compare with. */
export const SAMPLE_HISTORY_DAYS = 180;

/** Stable, valid UUIDs: group (1–15) + index. */
export function sampleId(group: number, index: number): string {
  return `00000000-0000-4000-8${group.toString(16).padStart(3, "0")}-${index.toString(16).padStart(12, "0")}`;
}

/** Small deterministic PRNG so generated trends are identical on every run. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const answer = (overrides: Partial<AssistantAnswer> & Pick<AssistantAnswer, "answer">): AssistantAnswer => ({
  kind: "answer",
  followUp: null,
  warningSigns: [],
  careRecommendation: null,
  memorySuggestions: [],
  escalation: null,
  notice: SAMPLE_NOTICE,
  safetyAdjusted: false,
  ...overrides,
});

/** Minutes the zone is ahead of UTC at an instant. */
function zoneOffsetMinutes(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(instant / 1000) * 1000) / 60_000);
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function localDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/**
 * The sample account as of `now`, with times of day in `timeZone` (so "morning
 * medication" is in the morning wherever the viewer is).
 */
export function buildSampleAccount(now: Date, timeZone = "Europe/London"): SampleAccount {
  const today = localDay(now, timeZone);
  const day0 = new Date(`${today}T00:00:00Z`);
  /** "YYYY-MM-DD", `days` before today (negative = future). */
  const dayString = (days: number) => new Date(day0.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  /** ISO instant when the local clock reads `time` on that day. */
  const at = (days: number, time = "09:00") => {
    const [h, m] = time.split(":").map(Number);
    const wall = day0.getTime() - days * 86_400_000 + (h! * 60 + m!) * 60_000;
    let instant = wall - zoneOffsetMinutes(wall, timeZone) * 60_000;
    instant = wall - zoneOffsetMinutes(instant, timeZone) * 60_000; // settle across DST changes
    return new Date(instant).toISOString();
  };
  const random = prng(20260115);

  // ── Measurements: 180 days of one believable person ────────────────────────
  // Every metric comes from the same day: a routine (weekday/weekend), a
  // walking habit that slowly improves, and the odd poor night or quiet day.
  // More activity → more active energy and a higher average heart rate; better
  // sleep and fitness → a lower resting heart rate; weight drifts down slowly.
  const DAYS = SAMPLE_HISTORY_DAYS;
  const noise = (spread: number) => (random() + random() + random() - 1.5) * (2 * spread) / 3; // gentle bell curve
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = DAYS - 1 - i; // days before today
    const date = dayString(d);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
    const progress = i / (DAYS - 1); // 0 → 1 over the period
    return { d, date, weekday, progress, quiet: random() < 0.08, poorNight: random() < 0.07 };
  });
  const daily: SampleAccount["measurements"]["daily"] = {};
  const push = (kind: MeasurementKind, point: DailyPoint) => (daily[kind] ??= []).push(point);
  let fitness = 0; // builds with sustained activity, lowers resting heart rate over weeks
  for (const day of days) {
    const saturday = day.weekday === 6;
    const sunday = day.weekday === 0;
    // Sleep (last night): ~7h on weekdays, a lie-in at weekends, short after a poor night.
    const sleep = Math.round(418 + day.progress * 14 + (saturday || sunday ? 32 : 0) + (day.poorNight ? -85 : 0) + noise(22));
    // Steps: commute + a walking habit that grows; Saturdays are active, quiet days are low.
    const walk = 1200 + day.progress * 2100;
    let steps = 5200 + walk + (saturday ? 2600 : sunday ? 900 : 0) + noise(900);
    if (day.quiet) steps *= 0.45;
    if (day.poorNight) steps *= 0.85;
    steps = Math.max(1800, Math.round(steps));
    const exerciseMinutes = Math.max(0, Math.round((steps - 4200) / 110 + noise(4)));
    fitness = fitness * 0.94 + exerciseMinutes * 0.06;
    const restingHr = Math.round(67.5 - fitness * 0.09 + (day.poorNight ? 2.5 : 0) + (sleep < 400 ? 1 : 0) + noise(1.4));
    const heartRate = Math.round(restingHr + 9 + steps / 1400 + noise(1.5));
    const activeEnergy = Math.round(95 + steps * 0.036 + exerciseMinutes * 1.8 + noise(18));
    const weight = Math.round((73.6 - day.progress * 1.2 + noise(0.18)) * 10) / 10;
    const water = Math.round((1500 + exerciseMinutes * 6 + noise(180)) / 50) * 50;

    push("sleep", { date: day.date, value: sleep, min: sleep, max: sleep, count: 1 });
    push("steps", { date: day.date, value: steps, min: steps, max: steps, count: 24 });
    push("resting_heart_rate", { date: day.date, value: restingHr, min: restingHr - 1, max: restingHr + 1, count: 1 });
    push("heart_rate", { date: day.date, value: heartRate, min: restingHr - 3, max: Math.round(heartRate + 38 + exerciseMinutes * 0.4), count: 24 });
    push("active_energy", { date: day.date, value: activeEnergy, min: activeEnergy, max: activeEnergy, count: 24 });
    push("water", { date: day.date, value: water, min: water, max: water, count: 6 });
    // Weighed most mornings (not usually on Sundays).
    if (!sunday || day.d === 0) push("weight", { date: day.date, value: weight, min: weight, max: weight, count: 1 });
  }
  // Today is partial: steps and energy so far.
  const partial = (kind: MeasurementKind, fraction: number) => {
    const today = daily[kind]!.at(-1)!;
    today.value = Math.round(today.value * fraction);
  };
  partial("steps", 0.62);
  partial("active_energy", 0.55);
  partial("water", 0.5);
  const unitOf: Record<string, string> = { steps: "count", heart_rate: "bpm", resting_heart_rate: "bpm", sleep: "min", active_energy: "kcal", weight: "kg", water: "ml" };
  const latest: LatestMeasurement[] = (Object.keys(daily) as MeasurementKind[]).map((kind) => ({
    kind,
    value: daily[kind]!.at(-1)!.value,
    unit: unitOf[kind]!,
    recordedAt: at(0, kind === "sleep" ? "07:05" : kind === "weight" ? "07:20" : "08:40"),
    source: "apple_health",
  }));

  // ── Profile (generic clinical fields — see header) ────────────────────────
  const profile: HealthProfile = {
    profile: { firstName: "Alex", lastName: "Morgan", dateOfBirth: "1989-06-14", sex: "prefer_not_to_say", heightCm: 172, timeZone, goals: ["sleep_better", "be_active", "prepare_appointments"] },
    conditions: [
      { id: sampleId(1, 1), name: "Example long-term condition", status: "active", source: "clinician_provided", notes: "Sample entry — shows how a condition from your clinician appears." },
      { id: sampleId(1, 2), name: "Example past condition", status: "resolved", source: "user_reported", notes: null },
    ],
    allergies: [{ id: sampleId(2, 1), substance: "Example allergy", reaction: "Sample reaction description", severity: "mild", source: "user_reported" }],
    medications: [
      { id: sampleId(3, 1), name: "Morning medication", instruction: "As prescribed by your clinician", source: "clinician_provided", active: true },
      { id: sampleId(3, 2), name: "Evening medication", instruction: "As prescribed by your clinician", source: "clinician_provided", active: true },
      { id: sampleId(3, 3), name: "Previous medication", instruction: "As prescribed by your clinician", source: "user_reported", active: false },
    ],
  };

  const memories: MemoryRecord[] = [
    { id: sampleId(4, 1), fact: "Prefers walking in the morning before work", source: "user_entry", status: "user_reported", createdAt: at(21, "08:10") },
    { id: sampleId(4, 2), fact: "Usually sleeps around 7 hours on weeknights", source: "user_conversation", status: "user_confirmed", createdAt: at(14, "21:30") },
    { id: sampleId(4, 3), fact: "Uploaded an example blood test report", source: "document", status: "document_extracted", createdAt: at(2, "10:05") },
    { id: sampleId(4, 4), fact: "May sleep less on busy workdays", source: "user_conversation", status: "ai_inferred", createdAt: at(1, "19:40") },
  ];

  const consents: ConsentRecord[] = [
    { kind: "ai_processing", granted: true, version: "2026-09" },
    { kind: "document_processing", granted: true, version: "2026-09" },
    { kind: "health_data_sync", granted: true, version: "2026-09" },
    { kind: "voice", granted: false, version: "2026-09" },
  ];

  // ── Conversations (sample assistant replies, clearly marked) ──────────────
  const conversation = (index: number, title: string, daysAgo: number, turns: [string, AssistantAnswer][]): ConversationDetail => {
    const messages = turns.flatMap(([question, reply], i) => {
      const t = at(daysAgo, `1${Math.min(9, 2 + i)}:${String(10 + i * 7).padStart(2, "0")}`);
      return [
        { id: sampleId(5, index * 100 + i * 2), role: "user" as const, content: question, payload: null, triageLevel: "routine" as const, createdAt: t },
        { id: sampleId(5, index * 100 + i * 2 + 1), role: "assistant" as const, content: reply.answer, payload: reply, triageLevel: "routine" as const, createdAt: t },
      ];
    });
    return { conversation: { id: sampleId(6, index), title, createdAt: messages[0]!.createdAt, updatedAt: messages.at(-1)!.createdAt }, messages };
  };
  const headacheReply = answer({
    answer:
      "Headaches after long stretches of screen time are common and often linked to eye strain, posture, dehydration or skipped breaks. Many people find the 20-20-20 habit helps: every 20 minutes, look at something about 20 feet away for 20 seconds. Regular water and a short walk can help too.",
    followUp: { question: "How long do these headaches usually last?", options: ["Under an hour", "A few hours", "Most of the day"], allowsMultiple: false },
    warningSigns: ["A sudden, severe headache — the worst you've had", "Headache with fever and a stiff neck", "Headache with weakness, numbness or trouble speaking"],
    careRecommendation: { level: "routine", text: "If headaches keep coming back or change in pattern, mention it at your next check-up." },
    memorySuggestions: [{ fact: "Gets headaches after long screen sessions" }],
  });
  const sleepReply = answer({
    answer:
      "A steady routine is one of the most helpful things for sleep: a similar bedtime and wake time every day, a wind-down period without screens, and a cool, dark room. Your sample data shows you've been sleeping a little longer this month — keeping the same wake-up time on weekends can help that stick.",
    followUp: { question: "What usually gets in the way of sleep for you?", options: ["Screens late at night", "Stress", "Irregular schedule", "Something else"], allowsMultiple: true },
    careRecommendation: { level: "self_care", text: "Worth raising with a clinician if poor sleep lasts several weeks or affects your days." },
  });
  const checkupReply = answer({
    answer:
      "Good idea to prepare. You could bring: a list of your current medications (as written on the label), any symptoms and when they started, questions about recent test results, and anything you'd like to change about your plan. I've added a few suggestions below — edit them to fit you.",
    followUp: { question: "Would you like these saved as a checklist for your appointment?", options: ["Yes, save them", "Not now"], allowsMultiple: false },
  });
  const conversations: ConversationDetail[] = [
    conversation(1, "Headaches after screen time", 1, [["I get headaches after long days on my laptop. Any tips?", headacheReply]]),
    conversation(2, "Improving my sleep routine", 6, [["How can I build a better sleep routine?", sleepReply]]),
    conversation(3, "Preparing for my check-up", 12, [["What should I ask at my annual check-up?", checkupReply]]),
  ];

  // ── Reports & photos (sample analyses) ────────────────────────────────────
  const reportResult: AnalysisResult = {
    type: "report",
    model: "sample",
    injectionDetected: false,
    readable: true,
    documentType: "lab_results",
    summary:
      "Sample summary: this example lab report lists five markers. Four are within the lab's reference range and one is marked above it. Only your clinician can say what the results mean for you.",
    findings: [
      { name: "Example marker A", value: "5.2", unit: "mmol/L", referenceRange: "3.5 – 5.5", flag: "within_range", page: 1, explanation: "Sample explanation: this value sits inside the range printed on the report." },
      { name: "Example marker B", value: "142", unit: "mmol/L", referenceRange: "135 – 145", flag: "within_range", page: 1, explanation: "Sample explanation: inside the printed reference range." },
      { name: "Example marker C", value: "6.8", unit: "mmol/L", referenceRange: "< 5.0", flag: "high", page: 1, explanation: "Sample explanation: marked above the printed range. Ask your clinician what this means for you." },
      { name: "Example marker D", value: "13.9", unit: "g/dL", referenceRange: "12.0 – 15.5", flag: "within_range", page: 2, explanation: "Sample explanation: inside the printed reference range." },
      { name: "Example marker E", value: "88", unit: "fL", referenceRange: "80 – 100", flag: "within_range", page: 2, explanation: "Sample explanation: inside the printed reference range." },
    ],
    suggestedQuestions: ["What does the marked result mean for me?", "Do I need a repeat test, and when?", "Is there anything I should change before the next test?"],
  };
  const imageResult: AnalysisResult = {
    type: "image",
    model: "sample",
    injectionDetected: false,
    quality: "good",
    qualityIssue: null,
    supported: true,
    bodyArea: "Forearm",
    observations: ["Sample observation: a small area of redness is visible", "Sample observation: the edges look even in this photo"],
    possibleCauses: [
      { name: "Sample possibility A", likelihood: "possible" },
      { name: "Sample possibility B", likelihood: "less_likely" },
    ],
    recommendations: ["Sample: take another photo in a few days in the same light to compare", "Sample: show this to a clinician if it changes"],
    warningSigns: ["Spreading redness or warmth", "Fever", "Rapid change in size or colour"],
    careUrgency: "routine",
  };
  const documents: DocumentRecord[] = [
    { id: sampleId(7, 1), kind: "report", purpose: null, filename: "Example blood test.pdf", contentType: "application/pdf", byteSize: 284_311, status: "ready", failureReason: null, result: reportResult, createdAt: at(2, "10:02"), processedAt: at(2, "10:03") },
    { id: sampleId(7, 2), kind: "image", purpose: "skin", filename: "Forearm photo.jpg", contentType: "image/jpeg", byteSize: 1_204_551, status: "ready", failureReason: null, result: imageResult, createdAt: at(4, "18:40"), processedAt: at(4, "18:41") },
    { id: sampleId(7, 3), kind: "report", purpose: null, filename: "Example clinic letter.pdf", contentType: "application/pdf", byteSize: 96_020, status: "processing", failureReason: null, result: null, createdAt: at(0, "08:55"), processedAt: null },
    { id: sampleId(7, 4), kind: "report", purpose: null, filename: "Scan_0412.jpg", contentType: "image/jpeg", byteSize: 402_118, status: "failed", failureReason: "We couldn't read this file. Try a clearer, well-lit photo or the original PDF.", result: null, createdAt: at(9, "12:20"), processedAt: at(9, "12:21") },
  ];

  // ── Plan: medications, tasks and habits with 3 weeks of completions ───────
  const item = (index: number, fields: Omit<PlanItemRecord, "id" | "startDay" | "endDay" | "createdAt" | "notes" | "instruction" | "source"> & Partial<PlanItemRecord>): PlanItemRecord => ({
    id: sampleId(8, index),
    notes: null,
    instruction: null,
    source: "user_reported",
    startDay: dayString(30),
    endDay: null,
    createdAt: at(30, "09:00"),
    ...fields,
  });
  const items: PlanItemRecord[] = [
    item(1, { title: "Morning medication", kind: "medication", time: "08:00", repeat: { type: "daily" }, reminderEnabled: true, source: "clinician_provided", instruction: "As prescribed by your clinician", notes: "With breakfast" }),
    item(2, { title: "Evening medication", kind: "medication", time: "20:00", repeat: { type: "daily" }, reminderEnabled: true, source: "clinician_provided", instruction: "As prescribed by your clinician" }),
    item(3, { title: "Drink water", kind: "habit", time: "09:00", repeat: { type: "daily" }, reminderEnabled: false, notes: "Aim for 6–8 glasses" }),
    item(4, { title: "Evening walk", kind: "habit", time: "18:30", repeat: { type: "weekdays", days: [1, 2, 3, 4, 5] }, reminderEnabled: true, notes: "30 minutes" }),
    item(5, { title: "Stretching", kind: "habit", time: "07:30", repeat: { type: "weekdays", days: [1, 3, 5] }, reminderEnabled: false, notes: "10 minutes" }),
    item(6, { title: "Wind down for sleep", kind: "habit", time: "22:30", repeat: { type: "daily" }, reminderEnabled: true, notes: "No screens for 30 minutes" }),
    item(7, { title: "Log blood pressure", kind: "task", time: "10:00", repeat: { type: "weekdays", days: [1, 4] }, reminderEnabled: true, notes: "Take a reading and add it to your timeline" }),
    item(8, { title: "Book annual check-up", kind: "task", time: "12:00", repeat: { type: "once", day: dayString(-1) }, reminderEnabled: true, startDay: dayString(3) }),
    item(9, { title: "Upload latest blood test", kind: "task", time: "17:00", repeat: { type: "once", day: dayString(2) }, reminderEnabled: false, startDay: dayString(4) }),
  ];
  const completions: PlanCompletionRecord[] = [];
  for (let d = 21; d >= 0; d--) {
    const date = dayString(d);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
    for (const it of items) {
      const due = it.repeat.type === "daily" || (it.repeat.type === "weekdays" && it.repeat.days.includes(weekday)) || (it.repeat.type === "once" && it.repeat.day === date);
      if (!due || date < it.startDay) continue;
      const [h] = it.time.split(":").map(Number);
      if (d === 0 && h! >= 10) continue; // later today: not done yet
      const adherence = it.kind === "medication" ? 0.93 : 0.72;
      if (random() < adherence) completions.push({ itemId: it.id, day: date, completedAt: at(d, it.time) });
    }
  }
  const plan: PlanRecord = { revision: 12, items, completions };

  const moods: SampleAccount["moods"] = [
    { mood: "good", recordedAt: at(1, "08:30") },
    { mood: "great", recordedAt: at(2, "08:12") },
    { mood: "okay", recordedAt: at(3, "09:02") },
  ];

  // ── Care ──────────────────────────────────────────────────────────────────
  const providers: CareProviderRecord[] = [
    { id: sampleId(9, 1), name: "Dr. Sam Lee", specialty: "General practice", phone: "+44 20 7946 0001", address: "Riverside Health Centre, 12 Mill Lane, London", website: "https://example.com/riverside", notes: "Main GP", createdAt: at(200) },
    { id: sampleId(9, 2), name: "Dr. Maya Rivera", specialty: "Dermatology", phone: "+44 20 7946 0002", address: "Northbank Skin Clinic, 4 Canal Street, London", website: null, notes: null, createdAt: at(60) },
    { id: sampleId(9, 3), name: "Northside Pharmacy", specialty: "Pharmacy", phone: "+44 20 7946 0003", address: "88 High Street, London", website: null, notes: "Open until 9pm", createdAt: at(120) },
  ];
  const appointments: AppointmentRecord[] = [
    { id: sampleId(10, 1), title: "Annual check-up", careProviderId: providers[0]!.id, providerName: providers[0]!.name, startsAt: at(-3, "10:30"), endsAt: at(-3, "11:00"), location: "Riverside Health Centre", mode: "in_person", status: "scheduled", notes: "Bring medication list" },
    { id: sampleId(10, 2), title: "Follow-up call", careProviderId: providers[1]!.id, providerName: providers[1]!.name, startsAt: at(-9, "15:00"), endsAt: at(-9, "15:20"), location: null, mode: "video", status: "scheduled", notes: null },
    { id: sampleId(10, 3), title: "Skin check", careProviderId: providers[1]!.id, providerName: providers[1]!.name, startsAt: at(40, "09:15"), endsAt: at(40, "09:45"), location: "Northbank Skin Clinic", mode: "in_person", status: "completed", notes: null },
    { id: sampleId(10, 4), title: "Blood test", careProviderId: providers[0]!.id, providerName: providers[0]!.name, startsAt: at(18, "08:40"), endsAt: null, location: "Riverside Health Centre", mode: "in_person", status: "cancelled", notes: "Rescheduled" },
  ];

  const symptoms: SampleAccount["symptoms"] = [
    {
      id: sampleId(11, 1),
      name: "Headache",
      bodyArea: "Head",
      status: "active",
      notes: "Usually after long screen days",
      firstNotedOn: dayString(12),
      createdAt: at(12, "18:00"),
      lastLoggedAt: at(1, "18:20"),
      lastSeverity: 3,
      events: [
        { id: sampleId(12, 1), severity: 3, occurredAt: at(1, "18:20"), notes: "After a long day at the laptop", triageLevel: "routine" },
        { id: sampleId(12, 2), severity: 4, occurredAt: at(5, "17:45"), notes: null, triageLevel: "routine" },
        { id: sampleId(12, 3), severity: 2, occurredAt: at(12, "18:00"), notes: "Mild", triageLevel: "routine" },
      ],
    },
    {
      id: sampleId(11, 2),
      name: "Tiredness",
      bodyArea: null,
      status: "resolved",
      notes: null,
      firstNotedOn: dayString(35),
      createdAt: at(35, "20:00"),
      lastLoggedAt: at(28, "20:00"),
      lastSeverity: 2,
      events: [{ id: sampleId(12, 4), severity: 2, occurredAt: at(28, "20:00"), notes: null, triageLevel: "routine" }],
    },
  ];

  // ── Timeline ──────────────────────────────────────────────────────────────
  let t = 0;
  const event = (eventType: TimelineEventRecord["eventType"], title: string, occurredAt: string, sourceType: TimelineEventRecord["sourceType"], sourceId: string | null = null, payload: Record<string, unknown> | null = null): TimelineEventRecord => ({
    id: sampleId(13, ++t),
    eventType,
    title,
    occurredAt,
    sourceType,
    sourceId,
    payload,
  });
  const timeline: TimelineEventRecord[] = [
    event("report", "Example clinic letter uploaded", at(0, "08:55"), "document", documents[2]!.id),
    event("medication", "Morning medication taken", at(0, "08:04"), "user_entered"),
    event("measurement", "Sleep synced from Apple Health", at(0, "07:06"), "device", null, { kind: "sleep" }),
    event("symptom", "Headache", at(1, "18:20"), "user_entered", symptoms[0]!.events[0]!.id, { severity: 3 }),
    event("chat", "AI chat: headaches after screen time", at(1, "12:17"), "ai_summary", conversations[0]!.conversation.id),
    event("report", "Example blood test analysed", at(2, "10:03"), "document", documents[0]!.id),
    event("note", "Started a morning walking habit", at(3, "08:15"), "user_entered"),
    event("image", "Forearm photo checked", at(4, "18:41"), "document", documents[1]!.id),
    event("symptom", "Headache", at(5, "17:45"), "user_entered", symptoms[0]!.events[1]!.id, { severity: 4 }),
    event("chat", "AI chat: improving my sleep routine", at(6, "12:17"), "ai_summary", conversations[1]!.conversation.id),
    event("measurement", "Blood pressure logged", at(7, "10:05"), "user_entered", null, { note: "Sample reading" }),
    event("note", "Felt more rested this week", at(8, "21:10"), "user_entered"),
    event("chat", "AI chat: preparing for my check-up", at(12, "12:17"), "ai_summary", conversations[2]!.conversation.id),
    event("symptom", "Headache", at(12, "18:00"), "user_entered", symptoms[0]!.events[2]!.id, { severity: 2 }),
    event("appointment", "Blood test (cancelled)", at(18, "08:40"), "user_entered", appointments[3]!.id),
    event("symptom", "Tiredness", at(28, "20:00"), "user_entered", symptoms[1]!.events[0]!.id, { severity: 2 }),
    event("appointment", "Skin check with Dr. Maya Rivera", at(40, "09:15"), "clinician", appointments[2]!.id),
  ];

  // ── Notifications ─────────────────────────────────────────────────────────
  let n = 0;
  const note = (category: NotificationRecord["category"], title: string, body: string, createdAt: string, read: boolean, link: string | null, aiGenerated = false): NotificationRecord => ({
    id: sampleId(14, ++n),
    category,
    title,
    body,
    createdAt,
    readAt: read ? createdAt : null,
    link,
    aiGenerated,
  });
  const notifications: NotificationRecord[] = [
    note("medication", "Time for your morning medication", "Morning medication · as prescribed", at(0, "08:00"), false, `/plans/${items[0]!.id}`),
    note("report", "Your report is being read", "Example clinic letter — we'll let you know when the summary is ready.", at(0, "08:56"), false, `/reports/${documents[2]!.id}`),
    note("appointment", "Check-up in 3 days", "Annual check-up with Dr. Sam Lee · Riverside Health Centre", at(0, "07:30"), false, `/care/appointments/${appointments[0]!.id}`),
    note("insight", "Your sleep is trending up", "You've slept about 20 minutes longer on average this month than last month.", at(1, "09:00"), true, "/health/sleep", true),
    note("report", "Summary ready: Example blood test", "Tap to see a plain-language summary and questions for your clinician.", at(2, "10:03"), true, `/reports/${documents[0]!.id}`),
    note("task", "Book annual check-up", "Due tomorrow", at(2, "12:00"), true, `/plans/${items[7]!.id}`),
    note("account", "New sign-in on iPhone", "If this wasn't you, change your password in Settings.", at(6, "19:02"), true, "/settings/account"),
  ];

  const notificationPreferences: NotificationPreferences = {
    medication: true,
    task: true,
    appointment: true,
    report: true,
    insight: false,
    account: true,
    showDetails: false,
    quietHours: { enabled: true, start: "22:00", end: "07:00" },
  };

  const healthKit: HealthKitConnection = {
    status: "connected",
    deviceName: "Alex's iPhone",
    scopes: ["steps", "heart_rate", "resting_heart_rate", "sleep", "active_energy", "weight"],
    connectedAt: at(45, "20:15"),
    disconnectedAt: null,
    lastSyncAt: at(0, "07:06"),
  };

  const account: AccountSummary = { email: SAMPLE_EMAIL, emailVerified: true, signInMethods: ["password", "apple"], createdAt: at(210, "19:00"), onboardingCompleted: true };

  const replies: SampleReply[] = [
    { keywords: ["headache", "migraine", "head hurts"], answer: headacheReply },
    { keywords: ["sleep", "tired", "insomnia", "rest"], answer: sleepReply },
    { keywords: ["check-up", "checkup", "appointment", "doctor", "ask"], answer: checkupReply },
    {
      keywords: ["water", "hydrat", "drink"],
      answer: answer({
        answer: "Most adults do well with regular drinks through the day — thirst and pale-yellow urine are useful guides. Needs vary with activity, heat and health conditions, so your clinician can give personal advice.",
        careRecommendation: { level: "self_care", text: "Ask your clinician if you've been told to limit fluids." },
      }),
    },
    {
      keywords: ["report", "result", "blood test", "lab"],
      answer: answer({
        answer: "I can explain what's written on a report in plain language. In Preview mode, open Reports to see an example summary. For what results mean for you, your clinician is the right person to ask.",
        followUp: { question: "Would you like to upload a report?", options: ["Upload a report", "Not now"], allowsMultiple: false },
      }),
    },
    {
      keywords: ["walk", "exercise", "steps", "activity"],
      answer: answer({
        answer: "Building activity gradually works best: add a few minutes to your usual walk each week and pick times you can keep. Your sample data shows your steps trending up this month.",
        memorySuggestions: [{ fact: "Wants to walk more" }],
      }),
    },
  ];
  const fallbackReply = answer({
    answer:
      "This is Preview mode, so answers come from a small set of examples rather than a real AI. Try asking about sleep, headaches, hydration, activity, reports or preparing for an appointment.",
    followUp: { question: "Pick a topic to see an example answer", options: ["Sleep routine", "Headaches", "Preparing for a check-up"], allowsMultiple: false },
  });

  return {
    generatedFor: today,
    account,
    profile,
    memories,
    consents,
    conversations,
    documents,
    measurements: { latest, daily },
    timeline,
    plan,
    moods,
    providers,
    appointments,
    symptoms,
    notifications,
    notificationPreferences,
    healthKit,
    replies,
    fallbackReply,
    sampleAnalyses: {
      report: reportResult,
      image: imageResult,
      unreadableReport: { type: "report", model: "sample", injectionDetected: false, readable: false, summary: "We couldn't read this document. Try a clearer photo or the original PDF.", findings: [], suggestedQuestions: [] },
      poorImage: { type: "image", model: "sample", injectionDetected: false, quality: "poor", qualityIssue: "The photo is too blurry to describe. Retake it in good light, holding the phone steady.", supported: true, observations: [], possibleCauses: [], recommendations: [], warningSigns: [] },
    },
  };
}

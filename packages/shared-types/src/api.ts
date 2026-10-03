/**
 * Response shapes of the HealthMate REST API (services/api, `/v1`).
 * Mirrored in Swift in `HealthMateCore/API/APIModels.swift` — keep in sync.
 */

export type ISO = string;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse extends TokenPair {
  userId: string;
}

/** `POST /v1/auth/register`: a session, or (Supabase with email confirmation on, HTTP 202) a pending confirmation. */
export type RegisterResponse = AuthResponse | { confirmationRequired: true };

/**
 * Age bands, computed by the server only. With `AGE_ENFORCEMENT=enforce` (always
 * in production) only `in_scope` accounts may use health features; the US launch
 * serves 13_15, 16_17 and adult. Under-13s are never served.
 */
export type AgeBand = "unknown" | "under_13" | "13_15" | "16_17" | "adult";
/** `blocked_*`: the band isn't served (enforced only with `enforce`). `review`: a blocked account claimed an older band; a person must resolve it. */
export type AgeStatus = "unknown" | "in_scope" | "blocked_under_13" | "blocked_out_of_scope" | "review";
export type AgeEnforcement = "off" | "record" | "enforce";
/**
 * What the server enforces now (always `eligible` unless enforcing). The other
 * values are also the `error.code` of the 403 a restricted account gets.
 */
export type AgeEligibility = "eligible" | "age_required" | "age_review" | "age_not_eligible";

/** Optional self-declared date of birth sent with sign-up or Google sign-in. Never a band. */
export interface AgeScreen {
  /** `YYYY-MM-DD`. */
  dateOfBirth: string;
}

/** `POST /v1/me/age`. Strict: any other field (a band, status or app-store signal) is refused. */
export type AgeAssessmentRequest = AgeScreen;

export interface AgeAssessmentResponse {
  ageBand: Exclude<AgeBand, "unknown">;
  ageStatus: Exclude<AgeStatus, "unknown">;
  assessedAt: ISO;
  /** applied: now the account's band; review: claimed an older band than the one on record, which was kept. */
  outcome: "applied" | "review";
  /** Absent from older servers. */
  eligibility?: AgeEligibility;
  /** Set when the account was found to belong to someone under 13; it is deleted then. Absent from older servers. */
  deletionScheduledAt?: ISO | null;
}

export interface ApiMeta {
  apiVersion: number;
  /** `recipients`: outside AI companies that receive data (named on consent screens); absent from older servers and Preview. */
  ai: { available: boolean; demo?: boolean; recipients?: string[] };
  /** Absent from older servers and Preview. `parentalConsent` is always false: it doesn't exist. */
  age?: { enforcement: AgeEnforcement; enabledBands: Exclude<AgeBand, "unknown">[]; parentalConsent: false };
  /** Phase 1 Preview mode: sample data, no backend. */
  preview?: boolean;
}

export type ProfileSource = "user_reported" | "clinician_provided" | "document_extracted";

export interface ProfileDetails {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  sex: string | null;
  heightCm: number | null;
  timeZone: string;
  /** What the person wants help with (onboarding); ids from HEALTH_GOALS. */
  goals?: string[];
  /** Preferred units for display (Phase 2A; stored with the account). */
  unitSystem?: UnitSystem;
}

export type UnitSystem = "metric" | "imperial";

/**
 * Provenance and time carried by every structured fact (Phase 2A; optional so
 * older servers and Preview mode still decode). Dates are YYYY-MM-DD.
 * See docs/health-memory-architecture.md.
 */
export interface FactMeta {
  sourceRef?: string | null;
  confidence?: number;
  confirmedAt?: ISO | null;
  createdAt?: ISO;
  updatedAt?: ISO;
}

export interface ConditionRecord extends FactMeta {
  id: string;
  name: string;
  status: string;
  source: ProfileSource;
  notes: string | null;
  onsetOn?: string | null;
  /** Resolved conditions are history, never "current". */
  resolvedOn?: string | null;
}

export interface AllergyRecord extends FactMeta {
  id: string;
  substance: string;
  reaction: string | null;
  severity: string | null;
  source: ProfileSource;
  status?: "active" | "inactive";
  notedOn?: string | null;
}

/** `instruction` is the clinician's or label's wording, exactly as entered. */
export interface MedicationRecord extends FactMeta {
  id: string;
  name: string;
  instruction: string;
  source: ProfileSource;
  active: boolean;
  startedOn?: string | null;
  /** A stopped medication is history (with its stop date), not a correction. */
  stoppedOn?: string | null;
}

export interface HealthProfile {
  profile: ProfileDetails;
  conditions: ConditionRecord[];
  allergies: AllergyRecord[];
  medications: MedicationRecord[];
}

export type MemoryStatus = "user_reported" | "user_confirmed" | "document_extracted" | "healthkit" | "clinician_provided" | "ai_inferred" | "superseded";

export type MemoryCategory = "condition" | "medication" | "allergy" | "symptom" | "measurement" | "procedure" | "lifestyle" | "family_history" | "other";

export interface MemoryRecord {
  id: string;
  fact: string;
  source: string;
  status: MemoryStatus;
  createdAt: ISO;
  /** When it happened / was true (YYYY-MM-DD), when known. */
  occurredOn?: string | null;
  /** When it stopped being true (YYYY-MM-DD). */
  endedOn?: string | null;
  category?: MemoryCategory | null;
  confidence?: number;
  confirmedAt?: ISO | null;
  /** A correction replaced this fact; `priorStatus` keeps where it originally came from. */
  supersededBy?: string | null;
  supersededAt?: ISO | null;
  priorStatus?: Exclude<MemoryStatus, "superseded"> | null;
  /** Phase 2C: current / historical (ended) / superseded (corrected). */
  temporalStatus?: "current" | "historical" | "superseded";
  /** Kept, but never given to the AI Health Assistant. */
  aiExcluded?: boolean;
  /** When this fact last informed an AI answer. */
  lastUsedAt?: ISO | null;
}

/** `POST /v1/memories/:id/supersede` */
export interface MemorySupersedeResult {
  superseded: MemoryRecord;
  replacement: MemoryRecord;
}

/** A clinician's plan as the person recorded it (`/v1/treatment-plans`). */
export interface TreatmentPlanRecord {
  id: string;
  title: string;
  /** Verbatim from the clinician or letter; never generated. */
  description: string | null;
  careProviderId: string | null;
  source: ProfileSource;
  sourceRef: string | null;
  status: "active" | "completed" | "stopped";
  startedOn: string | null;
  endedOn: string | null;
  planItemIds: string[];
  createdAt: ISO;
  updatedAt: ISO;
}

export type TriageLevel = "informational" | "routine" | "urgent" | "emergency";
export type EscalationActionKind = "call_emergency" | "crisis_support" | "contact_clinician" | "find_care";

export interface Escalation {
  level: TriageLevel;
  title: string;
  body: string;
  actions: { kind: EscalationActionKind; label: string }[];
}

export type CareLevel = "self_care" | "routine" | "soon" | "urgent" | "emergency";

export interface AssistantAnswer {
  kind: "answer";
  answer: string;
  followUp: { question: string; options: string[]; allowsMultiple: boolean } | null;
  warningSigns: string[];
  careRecommendation: { level: CareLevel; text: string } | null;
  memorySuggestions: { fact: string }[];
  /** Phase 2C: what the answer was based on (optional for older servers and Preview). */
  context?: AnswerContext;
  escalation: Escalation | null;
  notice: string | null;
  safetyAdjusted: boolean;
}

/** The few facts and data an answer used — never the whole history. */
export interface AnswerContext {
  memories: { id: string; fact: string; status: MemoryStatus; temporalStatus: "current" | "historical"; occurredOn: string | null }[];
  usedProfile: boolean;
  /** Daily health metrics summarised for the answer, e.g. "sleep". */
  healthMetrics: MeasurementKind[];
}

export type AssistantPayload = AssistantAnswer | { kind: "escalation"; escalation: Escalation };

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload: AssistantPayload | null;
  triageLevel: TriageLevel | null;
  createdAt: ISO;
}

export interface ConversationRecord {
  id: string;
  title: string;
  createdAt: ISO;
  updatedAt: ISO;
}

export interface ConversationDetail {
  conversation: ConversationRecord;
  messages: ChatMessageRecord[];
}

export type DocumentKind = "report" | "image";
export type DocumentStatus = "awaiting_upload" | "processing" | "ready" | "failed";
export type ImagePurpose = "skin" | "wound" | "swelling" | "other";

export interface ReportFinding {
  name: string;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  flag: "within_range" | "high" | "low" | "abnormal" | "not_stated";
  page: number | null;
  explanation: string;
}

export interface AnalysisResult {
  type: DocumentKind;
  model: string;
  injectionDetected: boolean;
  readable?: boolean;
  documentType?: string;
  summary?: string;
  findings?: ReportFinding[];
  suggestedQuestions?: string[];
  quality?: "good" | "poor";
  qualityIssue?: string | null;
  supported?: boolean;
  bodyArea?: string | null;
  observations?: string[];
  possibleCauses?: { name: string; likelihood: "possible" | "less_likely" }[];
  recommendations?: string[];
  warningSigns?: string[];
  careUrgency?: CareLevel;
}

export interface DocumentRecord {
  id: string;
  kind: DocumentKind;
  purpose: ImagePurpose | null;
  filename: string;
  contentType: string;
  byteSize: number;
  status: DocumentStatus;
  failureReason: string | null;
  result: AnalysisResult | null;
  createdAt: ISO;
  processedAt: ISO | null;
}

export interface DocumentCreation {
  document: DocumentRecord;
  upload: { method: "PUT"; url: string; headers: Record<string, string> };
}

export type MeasurementKind =
  | "heart_rate"
  | "resting_heart_rate"
  | "steps"
  | "sleep"
  | "active_energy"
  | "weight"
  | "blood_pressure_systolic"
  | "blood_pressure_diastolic"
  | "blood_glucose"
  | "water";

export interface TrendResponse {
  kind: MeasurementKind;
  unit: string;
  points: { date: string; value: number; min: number; max: number; count: number }[];
  average: number | null;
  previousAverage: number | null;
}

export interface LatestMeasurement {
  kind: MeasurementKind;
  value: number;
  unit: string;
  recordedAt: ISO;
  source: string;
}

export type TimelineEventType = "symptom" | "medication" | "measurement" | "report" | "image" | "chat" | "note" | "appointment";
export type TimelineSource = "user_entered" | "device" | "document" | "clinician" | "ai_summary";

export interface TimelineEventRecord {
  id: string;
  eventType: TimelineEventType;
  title: string;
  occurredAt: ISO;
  sourceType: TimelineSource;
  sourceId: string | null;
  payload?: Record<string, unknown> | null;
}

export interface TimelinePage {
  events: TimelineEventRecord[];
  nextCursor: string | null;
}

export type ConsentKind = "ai_processing" | "document_processing" | "health_data_sync" | "voice";

export interface ConsentRecord {
  kind: ConsentKind;
  granted: boolean;
  version: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export type PlanItemKind = "task" | "medication" | "habit";
export type PlanRepeat = { type: "daily" } | { type: "weekdays"; days: number[] } | { type: "once"; day: string };

/** For medications, `instruction` is the clinician's or label's wording exactly as entered. */
export interface PlanItemRecord {
  id: string;
  title: string;
  notes: string | null;
  kind: PlanItemKind;
  /** "HH:mm" local time. */
  time: string;
  repeat: PlanRepeat;
  reminderEnabled: boolean;
  source: "user_reported" | "clinician_provided";
  instruction: string | null;
  /** "YYYY-MM-DD" */
  startDay: string;
  endDay: string | null;
  createdAt: ISO;
}

export interface PlanCompletionRecord {
  itemId: string;
  day: string;
  completedAt: ISO;
}

export interface PlanRecord {
  revision: number;
  items: PlanItemRecord[];
  completions: PlanCompletionRecord[];
}

// ── Care, symptoms, HealthKit, reminders (API: services/api) ────────────────

export interface CareProviderRecord {
  id: string;
  name: string;
  specialty: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  createdAt: ISO;
}

export type AppointmentMode = "in_person" | "video" | "phone";
export type AppointmentStatus = "scheduled" | "completed" | "cancelled";

export interface AppointmentRecord {
  id: string;
  title: string;
  careProviderId: string | null;
  providerName: string | null;
  startsAt: ISO;
  endsAt: ISO | null;
  location: string | null;
  mode: AppointmentMode | null;
  status: AppointmentStatus;
  notes: string | null;
}

export interface SymptomRecord {
  id: string;
  name: string;
  bodyArea: string | null;
  status: "active" | "resolved";
  notes: string | null;
  firstNotedOn: string | null;
  createdAt: ISO;
  lastLoggedAt: ISO | null;
  lastSeverity: number | null;
}

export interface SymptomEventRecord {
  id: string;
  severity: number | null;
  occurredAt: ISO;
  notes: string | null;
  triageLevel: TriageLevel | null;
}

export interface HealthKitConnection {
  status: "never_connected" | "connected" | "disconnected";
  deviceName: string | null;
  scopes: MeasurementKind[];
  connectedAt: ISO | null;
  disconnectedAt: ISO | null;
  lastSyncAt: ISO | null;
  /** Phase 2B: the first import of past Apple Health data (optional for older servers). */
  history?: { status: "not_started" | "importing" | "complete" | "failed"; from: string | null; daysRequested: number | null };
  /** The last sync problem, as a code (never health content). */
  lastError?: { code: string; at: ISO } | null;
}

/** One day of one metric (`GET /v1/health-data/daily`): Apple Health preferred over readings entered by hand. */
export interface DailyHealthRecord {
  /** The person's local day, YYYY-MM-DD (sleep: the day they woke up). */
  day: string;
  kind: MeasurementKind;
  unit: string;
  /** Daily total (steps, sleep, active energy, water) or daily average (the rest). */
  value: number;
  min: number | null;
  max: number | null;
  sampleCount: number | null;
  source: "apple_health" | "user_entered";
  /** false while the day is still in progress. */
  isComplete: boolean;
  timeZone: string;
  updatedAt: ISO;
}

export interface ReminderRecord {
  id: string;
  planItemId: string;
  title: string;
  time: string;
  enabled: boolean;
  channel: "device" | "push";
}

// ── Contracts first defined by Preview mode (Phase 1); served by the API in Phase 2 ──

export type NotificationCategory = "medication" | "task" | "appointment" | "report" | "insight" | "account";

export interface NotificationRecord {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  createdAt: ISO;
  readAt: ISO | null;
  /** In-app destination, e.g. "/reports/<id>" (web path; iOS maps it to a screen). */
  link: string | null;
  /** AI-written content is labelled in the UI. */
  aiGenerated: boolean;
}

export interface NotificationPreferences {
  medication: boolean;
  task: boolean;
  appointment: boolean;
  report: boolean;
  insight: boolean;
  account: boolean;
  /** Show health details on the lock screen / in push previews. */
  showDetails: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
}

export type OAuthProvider = "google" | "apple";

/**
 * `POST /v1/auth/oauth` (Phase 2D). `idToken` is what Google Sign-In returned
 * on the device; without it (or for Apple, not set up yet) the server answers 501.
 */
export interface OAuthSignInRequest {
  provider: OAuthProvider;
  idToken?: string;
  /** The value the app asked the provider to embed in the token. */
  nonce?: string;
  timeZone?: string;
  firstName?: string;
  lastName?: string;
  /** Optional age screen, recorded only after the token is verified. With enforcement, an age that isn't served creates no account (403). */
  ageScreen?: AgeScreen;
}

export interface OAuthSignInResponse extends AuthResponse {
  /** First sign-in: the account was just created (clients open onboarding). */
  isNewUser: boolean;
}

/** `POST /v1/me/devices` (Phase 2D). The token is write-only. */
export interface PushDeviceRegistration {
  platform: "ios";
  /** APNs device token, hex. */
  token: string;
  environment: "sandbox" | "production";
  appVersion?: string;
}

/** `GET /v1/me/devices` → `{ devices: PushDevice[] }`. */
export interface PushDevice {
  id: string;
  platform: "ios";
  environment: "sandbox" | "production";
  appVersion: string | null;
  createdAt: ISO;
  lastRegisteredAt: ISO;
  /** false once the push service reported the token as no longer valid. */
  active: boolean;
}

export interface AccountSummary {
  email: string;
  emailVerified: boolean;
  signInMethods: ("password" | OAuthProvider)[];
  createdAt: ISO;
  onboardingCompleted: boolean;
  /** The name given at sign-up (readable before the age check, unlike the health profile). Absent from older servers. */
  firstName?: string;
  lastName?: string;
  /** Absent from older servers and Preview. */
  ageBand?: AgeBand;
  ageStatus?: AgeStatus;
  ageAssessedAt?: ISO | null;
  ageEligibility?: AgeEligibility;
  /** Set when the account was found to belong to someone under 13. */
  ageDeletionScheduledAt?: ISO | null;
}

export interface NotificationList {
  notifications: NotificationRecord[];
  unreadCount: number;
}

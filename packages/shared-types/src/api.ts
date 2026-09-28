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

export interface ApiMeta {
  apiVersion: number;
  ai: { available: boolean; demo?: boolean };
}

export type ProfileSource = "user_reported" | "clinician_provided" | "document_extracted";

export interface ProfileDetails {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  sex: string | null;
  heightCm: number | null;
  timeZone: string;
}

export interface ConditionRecord {
  id: string;
  name: string;
  status: string;
  source: ProfileSource;
  notes: string | null;
}

export interface AllergyRecord {
  id: string;
  substance: string;
  reaction: string | null;
  severity: string | null;
  source: ProfileSource;
}

/** `instruction` is the clinician's or label's wording, exactly as entered. */
export interface MedicationRecord {
  id: string;
  name: string;
  instruction: string;
  source: ProfileSource;
  active: boolean;
}

export interface HealthProfile {
  profile: ProfileDetails;
  conditions: ConditionRecord[];
  allergies: AllergyRecord[];
  medications: MedicationRecord[];
}

export type MemoryStatus = "user_reported" | "user_confirmed" | "document_extracted" | "healthkit" | "clinician_provided" | "ai_inferred" | "superseded";

export interface MemoryRecord {
  id: string;
  fact: string;
  source: string;
  status: MemoryStatus;
  createdAt: ISO;
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
  escalation: Escalation | null;
  notice: string | null;
  safetyAdjusted: boolean;
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

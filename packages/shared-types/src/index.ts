/**
 * HealthMate shared domain model.
 *
 * These types describe the API contract shared by the web app, the iOS app
 * (mirrored in apps/ios/Packages/HealthMateCore) and the future NestJS backend.
 * When the backend lands, generate these from its OpenAPI schema instead of
 * editing by hand.
 */

export type ISODateString = string;

/**
 * Where a piece of health information came from. Every health fact shown in
 * the UI carries its provenance (spec §8.4, §12.2).
 */
export type DataSource =
  | "user_reported"
  | "document_extracted"
  | "wearable"
  | "apple_health"
  | "clinician_provided"
  | "ai_inferred"
  | "user_confirmed"
  | "sample"; // demo/mock data — never shown as the user's real data without a label

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  /** IANA timezone, used for greetings and reminder scheduling. */
  timeZone: string;
}

export type MetricKind = "heart_rate" | "steps" | "sleep" | "calories" | "water" | "weight" | "blood_pressure";

/**
 * A metric's relation to the user's own recent baseline. This is a comparison,
 * not a clinical judgement — UI copy must say "your usual range", never "healthy".
 */
export type MetricTrend = "in_usual_range" | "above_usual" | "below_usual" | "no_baseline";

export interface HealthMetric {
  kind: MetricKind;
  /** Numeric value in the canonical unit (bpm, steps, minutes, kcal, glasses, kg). */
  value: number;
  unit: string;
  recordedAt: ISODateString;
  source: DataSource;
  trend: MetricTrend;
  /** Optional daily goal the user set themselves (e.g. 10,000 steps). */
  goal?: number;
}

export type Mood = "great" | "good" | "okay" | "low" | "unwell";

export interface MoodCheckIn {
  mood: Mood;
  recordedAt: ISODateString;
}

export type TaskCategory = "medication" | "hydration" | "measurement" | "activity" | "supplement" | "sleep" | "other";

export interface PlanTask {
  id: string;
  title: string;
  detail?: string;
  category: TaskCategory;
  /** Local time of day, "HH:mm". */
  scheduledTime: string;
  completed: boolean;
  /**
   * Who authored the underlying instruction. The app never invents medical
   * instructions: medication tasks must be clinician_provided or user_reported.
   */
  source: DataSource;
}

export type ActivityKind = "report" | "image" | "medication" | "chat" | "sync" | "symptom" | "measurement" | "note" | "appointment";

export interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  occurredAt: ISODateString;
  source: DataSource;
}

export interface Appointment {
  id: string;
  title: string;
  clinicianName: string;
  specialty: string;
  startsAt: ISODateString;
  mode: "in_person" | "video";
}

/**
 * An AI-generated observation. Always rendered with an "AI-generated" label and
 * with the data it was based on, so the user can judge it themselves.
 */
export interface AIInsight {
  id: string;
  message: string;
  basedOn: string;
  generatedAt: ISODateString;
  source: "ai_inferred" | "sample";
}

export interface HomeSummary {
  user: UserProfile;
  metrics: HealthMetric[];
  todayMood?: MoodCheckIn;
  tasks: PlanTask[];
  recentActivity: ActivityEvent[];
  upcomingAppointments: Appointment[];
  insight?: AIInsight;
  unreadNotifications: number;
}

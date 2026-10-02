import type { OAuthProvider } from "../auth/oauth";
import { Inject, Injectable } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { completedYears, isCalendarDay, MAX_AGE_YEARS, type AccountAgeBand, type AgeStatus } from "../account/age";
import { relativeAge } from "../memory/memory-context";

/** Sources a person can attribute a profile fact to. The AI is never one of them. */
export type ProfileSource = "user_reported" | "clinician_provided" | "document_extracted";
export type UnitSystem = "metric" | "imperial";

export interface Profile {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  sex: string | null;
  heightCm: number | null;
  timeZone: string;
  goals: string[];
  unitSystem: UnitSystem;
}

/** Provenance and time shared by every structured fact (docs/health-memory-architecture.md §2). */
interface FactMeta {
  sourceRef: string | null;
  confidence: number;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Condition extends FactMeta { id: string; name: string; status: "active" | "resolved"; source: ProfileSource; notes: string | null; onsetOn: string | null; resolvedOn: string | null }
export interface Allergy extends FactMeta { id: string; substance: string; reaction: string | null; severity: string | null; status: "active" | "inactive"; source: ProfileSource; notedOn: string | null }
export interface Medication extends FactMeta { id: string; name: string; instruction: string; source: ProfileSource; active: boolean; startedOn: string | null; stoppedOn: string | null }

export interface HealthProfile {
  profile: Profile;
  conditions: Condition[];
  allergies: Allergy[];
  medications: Medication[];
}

export interface NotificationPreferences {
  medication: boolean;
  task: boolean;
  appointment: boolean;
  report: boolean;
  insight: boolean;
  account: boolean;
  showDetails: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
}

const iso = (d: Date | string | null) => (d === null ? null : d instanceof Date ? d.toISOString() : d);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type MetaRow = { source_ref: string | null; confidence: number; confirmed_at: Date | null; created_at: Date; updated_at: Date };
const meta = (r: MetaRow): FactMeta => ({ sourceRef: r.source_ref, confidence: Number(r.confidence), confirmedAt: iso(r.confirmed_at), createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)! });
const META = "source_ref, confidence, confirmed_at, created_at, updated_at";

/** The person's own local date (their time zone), for "is this still current?". */
export function localDay(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Past items are history: the AI gets the ones the question mentions plus the
 * few most recent, not years of stopped medications. Current items are always sent.
 */
export const PAST_ITEMS_IN_CONTEXT = 5;
export function limitPast<T>(items: T[], name: (item: T) => string, endedAt: (item: T) => string, question: string): { items: T[]; hidden: number } {
  const q = question.toLowerCase();
  const mentioned = items.filter((item) => q.includes(name(item).toLowerCase()));
  const recent = [...items].sort((a, b) => endedAt(b).localeCompare(endedAt(a))).filter((item) => !mentioned.includes(item)).slice(0, Math.max(0, PAST_ITEMS_IN_CONTEXT - mentioned.length));
  const shown = [...mentioned, ...recent];
  return { items: shown, hidden: items.length - shown.length };
}
const more = (hidden: number) => (hidden > 0 ? ` (and ${hidden} older past item${hidden === 1 ? "" : "s"} not shown)` : "");

@Injectable()
export class ProfileService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The current record. Superseded (corrected) rows are history: in the export, not here. */
  async get(userId: string): Promise<HealthProfile> {
    const [p, c, a, m] = await Promise.all([
      this.db.query<{ first_name: string; last_name: string; date_of_birth: string | null; sex: string | null; height_cm: number | null; time_zone: string; goals: string[]; unit_system: UnitSystem }>(
        `SELECT first_name, last_name, date_of_birth::text AS date_of_birth, sex, height_cm, time_zone, goals, unit_system FROM profiles WHERE user_id = $1`,
        [userId],
      ),
      this.db.query<MetaRow & { id: string; name: string; status: "active" | "resolved"; source: ProfileSource; notes: string | null; onset_on: string | null; resolved_on: string | null }>(
        `SELECT id, name, status, source, notes, onset_on::text AS onset_on, resolved_on::text AS resolved_on, ${META} FROM health_conditions WHERE user_id = $1 AND superseded_at IS NULL ORDER BY created_at`,
        [userId],
      ),
      this.db.query<MetaRow & { id: string; substance: string; reaction: string | null; severity: string | null; status: "active" | "inactive"; source: ProfileSource; noted_on: string | null }>(
        `SELECT id, substance, reaction, severity, status, source, noted_on::text AS noted_on, ${META} FROM allergies WHERE user_id = $1 AND superseded_at IS NULL ORDER BY created_at`,
        [userId],
      ),
      this.db.query<MetaRow & { id: string; name: string; instruction: string; source: ProfileSource; active: boolean; started_on: string | null; stopped_on: string | null }>(
        `SELECT id, name, instruction, source, active, started_on::text AS started_on, stopped_on::text AS stopped_on, ${META} FROM medications WHERE user_id = $1 AND superseded_at IS NULL ORDER BY created_at`,
        [userId],
      ),
    ]);
    const row = p.rows[0];
    if (!row) throw notFound("Profile");
    return {
      profile: { firstName: row.first_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, sex: row.sex, heightCm: row.height_cm, timeZone: row.time_zone, goals: row.goals ?? [], unitSystem: row.unit_system },
      conditions: c.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, source: r.source, notes: r.notes, onsetOn: r.onset_on, resolvedOn: r.resolved_on, ...meta(r) })),
      allergies: a.rows.map((r) => ({ id: r.id, substance: r.substance, reaction: r.reaction, severity: r.severity, status: r.status, source: r.source, notedOn: r.noted_on, ...meta(r) })),
      medications: m.rows.map((r) => ({ id: r.id, name: r.name, instruction: r.instruction, source: r.source, active: r.active, startedOn: r.started_on, stoppedOn: r.stopped_on, ...meta(r) })),
    };
  }

  async updateProfile(userId: string, patch: Partial<Profile>) {
    const current = (await this.get(userId)).profile;
    const next = { ...current, ...patch };
    await this.db.query(
      `UPDATE profiles SET first_name = $2, last_name = $3, date_of_birth = $4, sex = $5, height_cm = $6, time_zone = $7, goals = $8, unit_system = $9 WHERE user_id = $1`,
      [userId, next.firstName, next.lastName, next.dateOfBirth, next.sex, next.heightCm, next.timeZone, next.goals, next.unitSystem],
    );
    return next;
  }

  async completeOnboarding(userId: string) {
    await this.db.query(`UPDATE profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()) WHERE user_id = $1`, [userId]);
  }

  async account(userId: string) {
    type Row = {
      email: string; auth_provider: "local" | "supabase"; has_password: boolean; email_verified_at: Date | null; created_at: Date; onboarding_completed_at: Date | null;
      identities: { provider: OAuthProvider; created_at: string }[]; age_band: AccountAgeBand; age_status: AgeStatus; age_assessed_at: Date | null;
    };
    const { rows } = await this.db.query<Row>(
      `SELECT u.email, u.auth_provider, u.password_hash IS NOT NULL AS has_password, u.email_verified_at, u.created_at, p.onboarding_completed_at,
              u.age_band, u.age_status, u.age_assessed_at,
              COALESCE((SELECT json_agg(json_build_object('provider', i.provider, 'created_at', i.created_at) ORDER BY i.provider) FROM auth_identities i WHERE i.user_id = u.id), '[]') AS identities
         FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row) throw notFound("Account");
    // Local accounts know whether a password exists. Supabase keeps passwords itself: an
    // account whose first identity arrived with it (within a minute) was created by that
    // sign-in and has no password; every other Supabase account signed up with one.
    const createdByIdentity = row.identities.some((i) => Math.abs(new Date(i.created_at).getTime() - row.created_at.getTime()) < 60_000);
    const hasPassword = row.auth_provider === "local" ? row.has_password : !createdByIdentity;
    return {
      email: row.email,
      // Local (development) accounts have no email step.
      emailVerified: row.auth_provider === "local" || row.email_verified_at !== null,
      signInMethods: [...(hasPassword ? (["password"] as const) : []), ...row.identities.map((i) => i.provider)],
      createdAt: row.created_at.toISOString(),
      onboardingCompleted: row.onboarding_completed_at !== null,
      // As stored; ProfileController applies birthdays and adds eligibility (AgeService).
      ageBand: row.age_band,
      ageStatus: row.age_status,
      ageAssessedAt: row.age_assessed_at?.toISOString() ?? null,
    };
  }

  async notificationPreferences(userId: string, tx: Queryable = this.db): Promise<NotificationPreferences> {
    type Row = { medication: boolean; task: boolean; appointment: boolean; report: boolean; insight: boolean; account: boolean; show_details: boolean; quiet_hours_enabled: boolean; quiet_start: string; quiet_end: string };
    const cols = `medication, task, appointment, report, insight, account, show_details, quiet_hours_enabled, to_char(quiet_start, 'HH24:MI') AS quiet_start, to_char(quiet_end, 'HH24:MI') AS quiet_end`;
    let { rows } = await tx.query<Row>(`SELECT ${cols} FROM notification_preferences WHERE user_id = $1`, [userId]);
    if (!rows[0]) ({ rows } = await tx.query<Row>(`INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id RETURNING ${cols}`, [userId]));
    const r = rows[0]!;
    return {
      medication: r.medication,
      task: r.task,
      appointment: r.appointment,
      report: r.report,
      insight: r.insight,
      account: r.account,
      showDetails: r.show_details,
      quietHours: { enabled: r.quiet_hours_enabled, start: r.quiet_start, end: r.quiet_end },
    };
  }

  async setNotificationPreferences(userId: string, patch: Partial<Omit<NotificationPreferences, "quietHours">> & { quietHours?: Partial<NotificationPreferences["quietHours"]> }) {
    return this.db.transaction(async (tx) => {
      const current = await this.notificationPreferences(userId, tx);
      const next: NotificationPreferences = { ...current, ...patch, quietHours: { ...current.quietHours, ...(patch.quietHours ?? {}) } };
      await tx.query(
        `UPDATE notification_preferences SET medication = $2, task = $3, appointment = $4, report = $5, insight = $6, account = $7, show_details = $8,
           quiet_hours_enabled = $9, quiet_start = $10::time, quiet_end = $11::time WHERE user_id = $1`,
        [userId, next.medication, next.task, next.appointment, next.report, next.insight, next.account, next.showDetails, next.quietHours.enabled, next.quietHours.start, next.quietHours.end],
      );
      return next;
    });
  }

  async addCondition(userId: string, input: { name: string; status: "active" | "resolved"; source: ProfileSource; notes?: string | null; onsetOn?: string | null; resolvedOn?: string | null; sourceRef?: string | null }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO health_conditions (user_id, name, status, source, notes, onset_on, resolved_on, source_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, input.name, input.status, input.source, input.notes ?? null, input.onsetOn ?? null, input.resolvedOn ?? null, input.sourceRef ?? null],
    );
    return rows[0]!.id;
  }

  /** The person's own correction or update. Resolving keeps the condition as history. */
  async updateCondition(userId: string, id: string, patch: { name?: string; status?: "active" | "resolved"; notes?: string | null; onsetOn?: string | null; resolvedOn?: string | null }) {
    const { rows } = await this.db.query(
      `UPDATE health_conditions SET
         name = COALESCE($3, name),
         status = COALESCE($4, status),
         notes = CASE WHEN $5 THEN $6 ELSE notes END,
         onset_on = CASE WHEN $7 THEN $8::date ELSE onset_on END,
         resolved_on = CASE WHEN $9 THEN $10::date WHEN $4 = 'active' THEN NULL ELSE resolved_on END
       WHERE id = $2 AND user_id = $1 AND superseded_at IS NULL RETURNING id`,
      [userId, id, patch.name ?? null, patch.status ?? null, patch.notes !== undefined, patch.notes ?? null, patch.onsetOn !== undefined, patch.onsetOn ?? null, patch.resolvedOn !== undefined, patch.resolvedOn ?? null],
    );
    if (!rows.length) throw notFound("Condition");
  }

  async addAllergy(userId: string, input: { substance: string; reaction?: string | null; severity?: string | null; source: ProfileSource; notedOn?: string | null; sourceRef?: string | null }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO allergies (user_id, substance, reaction, severity, source, noted_on, source_ref) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, input.substance, input.reaction ?? null, input.severity ?? null, input.source, input.notedOn ?? null, input.sourceRef ?? null],
    );
    return rows[0]!.id;
  }

  async updateAllergy(userId: string, id: string, patch: { substance?: string; reaction?: string | null; severity?: string | null; status?: "active" | "inactive" }) {
    const { rows } = await this.db.query(
      `UPDATE allergies SET substance = COALESCE($3, substance), reaction = CASE WHEN $4 THEN $5 ELSE reaction END,
         severity = CASE WHEN $6 THEN $7 ELSE severity END, status = COALESCE($8, status)
       WHERE id = $2 AND user_id = $1 AND superseded_at IS NULL RETURNING id`,
      [userId, id, patch.substance ?? null, patch.reaction !== undefined, patch.reaction ?? null, patch.severity !== undefined, patch.severity ?? null, patch.status ?? null],
    );
    if (!rows.length) throw notFound("Allergy");
  }

  /** Stores the instruction verbatim — no normalisation, no generated text. */
  async addMedication(userId: string, input: { name: string; instruction: string; source: ProfileSource; startedOn?: string | null; sourceRef?: string | null }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO medications (user_id, name, instruction, source, started_on, source_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, input.name, input.instruction, input.source, input.startedOn ?? null, input.sourceRef ?? null],
    );
    return rows[0]!.id;
  }

  /**
   * Records what the person reports: that they take it (again) or stopped it,
   * and when. HealthMate never decides this — it only keeps the record.
   * Stopping keeps the medication as history with its stop date.
   */
  async setMedicationStatus(userId: string, id: string, patch: { active: boolean; startedOn?: string | null; stoppedOn?: string | null }) {
    const { rows } = await this.db.query(
      `UPDATE medications SET active = $3,
         started_on = CASE WHEN $4 THEN $5::date ELSE started_on END,
         stopped_on = CASE WHEN $3 THEN NULL WHEN $6 THEN $7::date ELSE COALESCE(stopped_on, current_date) END
       WHERE id = $2 AND user_id = $1 AND superseded_at IS NULL RETURNING id`,
      [userId, id, patch.active, patch.startedOn !== undefined, patch.startedOn ?? null, patch.stoppedOn !== undefined, patch.stoppedOn ?? null],
    );
    if (!rows.length) throw notFound("Medication");
  }

  async remove(userId: string, table: "health_conditions" | "allergies" | "medications", id: string) {
    const { rows } = await this.db.query(`DELETE FROM ${table} WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows.length) throw notFound();
  }

  /**
   * Compact, source-labelled summary for the AI context. Separates what is
   * current from what is past, with dates, so old information is never
   * presented as current. Never includes more than needed.
   */
  async contextSummary(userId: string, now = new Date(), question = ""): Promise<string> {
    const { profile, conditions, allergies, medications } = await this.get(userId);
    const today = localDay(profile.timeZone, now);
    const when = (label: string, day: string | null) => (day && DAY.test(day) ? `, ${label} ${day} (${relativeAge(day, today)})` : "");
    const lines: string[] = [];
    // Age in whole years, never the date of birth: general health information can depend on
    // age (screening ages, typical ranges), but nothing needs the exact date, which would only
    // add identifying detail for the AI provider. Omitted when the date is unusable.
    const age = ageInYears(profile.dateOfBirth, today);
    if (age !== null) lines.push(`Age: ${age} years`);
    if (profile.sex) lines.push(`Sex: ${profile.sex}`);

    const activeConditions = conditions.filter((c) => c.status === "active");
    const pastConditions = limitPast(conditions.filter((c) => c.status === "resolved"), (c) => c.name, (c) => c.resolvedOn ?? c.updatedAt, question);
    if (activeConditions.length) lines.push(`Current conditions: ${activeConditions.map((c) => `${c.name} [${c.source}${when("since", c.onsetOn)}]`).join("; ")}`);
    if (pastConditions.items.length) lines.push(`Past conditions (resolved, not current): ${pastConditions.items.map((c) => `${c.name} [${c.source}${when("resolved", c.resolvedOn)}]`).join("; ")}${more(pastConditions.hidden)}`);

    const activeAllergies = allergies.filter((a) => a.status === "active");
    if (activeAllergies.length) lines.push(`Allergies: ${activeAllergies.map((a) => `${a.substance}${a.reaction ? ` – ${a.reaction}` : ""} [${a.source}]`).join("; ")}`);

    const isCurrent = (m: Medication) => m.active && (!m.stoppedOn || m.stoppedOn > today);
    const current = medications.filter(isCurrent);
    const past = limitPast(medications.filter((m) => !isCurrent(m)), (m) => m.name, (m) => m.stoppedOn ?? m.updatedAt, question);
    if (current.length) lines.push(`Current medications, instructions verbatim: ${current.map((m) => `${m.name}: "${m.instruction}" [${m.source}${when("started", m.startedOn)}]`).join("; ")}`);
    if (past.items.length) lines.push(`Past medications (stopped, not current): ${past.items.map((m) => `${m.name} [${m.source}${when("stopped", m.stoppedOn)}]`).join("; ")}${more(past.hidden)}`);
    return lines.join("\n");
  }
}

/** Completed years on `today` (the person's local date), or null for a missing, malformed, future or implausible date. */
export function ageInYears(dateOfBirth: string | null, today: string): number | null {
  if (!dateOfBirth || !isCalendarDay(dateOfBirth) || dateOfBirth > today) return null;
  const years = completedYears(dateOfBirth, today);
  return years > MAX_AGE_YEARS ? null : years;
}

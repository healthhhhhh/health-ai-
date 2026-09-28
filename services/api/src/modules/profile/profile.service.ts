import { Inject, Injectable } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";

/** Sources a person can attribute a profile fact to. The AI is never one of them. */
export type ProfileSource = "user_reported" | "clinician_provided" | "document_extracted";

export interface Profile {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  sex: string | null;
  heightCm: number | null;
  timeZone: string;
}

export interface Condition { id: string; name: string; status: "active" | "resolved"; source: ProfileSource; notes: string | null; createdAt: string }
export interface Allergy { id: string; substance: string; reaction: string | null; severity: string | null; source: ProfileSource; createdAt: string }
export interface Medication { id: string; name: string; instruction: string; source: ProfileSource; active: boolean; createdAt: string }

export interface HealthProfile {
  profile: Profile;
  conditions: Condition[];
  allergies: Allergy[];
  medications: Medication[];
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

@Injectable()
export class ProfileService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(userId: string): Promise<HealthProfile> {
    const [p, c, a, m] = await Promise.all([
      this.db.query<{ first_name: string; last_name: string; date_of_birth: string | null; sex: string | null; height_cm: number | null; time_zone: string }>(
        `SELECT first_name, last_name, date_of_birth::text AS date_of_birth, sex, height_cm, time_zone FROM profiles WHERE user_id = $1`,
        [userId],
      ),
      this.db.query<{ id: string; name: string; status: "active" | "resolved"; source: ProfileSource; notes: string | null; created_at: Date }>(
        `SELECT id, name, status, source, notes, created_at FROM health_conditions WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
      this.db.query<{ id: string; substance: string; reaction: string | null; severity: string | null; source: ProfileSource; created_at: Date }>(
        `SELECT id, substance, reaction, severity, source, created_at FROM allergies WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
      this.db.query<{ id: string; name: string; instruction: string; source: ProfileSource; active: boolean; created_at: Date }>(
        `SELECT id, name, instruction, source, active, created_at FROM medications WHERE user_id = $1 ORDER BY created_at`,
        [userId],
      ),
    ]);
    const row = p.rows[0];
    if (!row) throw notFound("Profile");
    return {
      profile: { firstName: row.first_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, sex: row.sex, heightCm: row.height_cm, timeZone: row.time_zone },
      conditions: c.rows.map((r) => ({ id: r.id, name: r.name, status: r.status, source: r.source, notes: r.notes, createdAt: iso(r.created_at) })),
      allergies: a.rows.map((r) => ({ id: r.id, substance: r.substance, reaction: r.reaction, severity: r.severity, source: r.source, createdAt: iso(r.created_at) })),
      medications: m.rows.map((r) => ({ id: r.id, name: r.name, instruction: r.instruction, source: r.source, active: r.active, createdAt: iso(r.created_at) })),
    };
  }

  async updateProfile(userId: string, patch: Partial<Profile>) {
    const current = (await this.get(userId)).profile;
    const next = { ...current, ...patch };
    await this.db.query(
      `UPDATE profiles SET first_name = $2, last_name = $3, date_of_birth = $4, sex = $5, height_cm = $6, time_zone = $7, updated_at = now() WHERE user_id = $1`,
      [userId, next.firstName, next.lastName, next.dateOfBirth, next.sex, next.heightCm, next.timeZone],
    );
    return next;
  }

  async addCondition(userId: string, input: { name: string; status: "active" | "resolved"; source: ProfileSource; notes?: string | null }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO health_conditions (user_id, name, status, source, notes) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, input.name, input.status, input.source, input.notes ?? null],
    );
    return rows[0]!.id;
  }

  async addAllergy(userId: string, input: { substance: string; reaction?: string | null; severity?: string | null; source: ProfileSource }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO allergies (user_id, substance, reaction, severity, source) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [userId, input.substance, input.reaction ?? null, input.severity ?? null, input.source],
    );
    return rows[0]!.id;
  }

  /** Stores the instruction verbatim — no normalisation, no generated text. */
  async addMedication(userId: string, input: { name: string; instruction: string; source: ProfileSource }) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO medications (user_id, name, instruction, source) VALUES ($1, $2, $3, $4) RETURNING id`,
      [userId, input.name, input.instruction, input.source],
    );
    return rows[0]!.id;
  }

  async setMedicationActive(userId: string, id: string, active: boolean) {
    const { rows } = await this.db.query(`UPDATE medications SET active = $3 WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id, active]);
    if (!rows.length) throw notFound("Medication");
  }

  async remove(userId: string, table: "health_conditions" | "allergies" | "medications", id: string) {
    const { rows } = await this.db.query(`DELETE FROM ${table} WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows.length) throw notFound();
  }

  /** Compact, source-labelled summary for the AI context. Never includes more than needed. */
  async contextSummary(userId: string): Promise<string> {
    const { profile, conditions, allergies, medications } = await this.get(userId);
    const lines: string[] = [];
    if (profile.dateOfBirth) lines.push(`Date of birth: ${profile.dateOfBirth}`);
    if (profile.sex) lines.push(`Sex: ${profile.sex}`);
    const active = conditions.filter((c) => c.status === "active");
    if (active.length) lines.push(`Conditions (${active.map((c) => `${c.name} [${c.source}]`).join("; ")})`);
    if (allergies.length) lines.push(`Allergies (${allergies.map((a) => `${a.substance}${a.reaction ? ` – ${a.reaction}` : ""} [${a.source}]`).join("; ")})`);
    const meds = medications.filter((m) => m.active);
    if (meds.length) lines.push(`Current medications, instructions verbatim (${meds.map((m) => `${m.name}: "${m.instruction}" [${m.source}]`).join("; ")})`);
    return lines.join("\n");
  }
}

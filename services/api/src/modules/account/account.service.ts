import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../../common/audit";
import { ApiError } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
import { AuthService } from "../auth/auth.service";
import { TokenService } from "../auth/token.service";
import { STORAGE, type ObjectStorage } from "../documents/storage";

export type ConsentKind = "ai_processing" | "document_processing" | "health_data_sync" | "voice";
export const CONSENT_VERSION = "2026-09";

/** Data controls: export, delete, consent (spec §16.2, FR-015). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /** Everything we hold about the user, as JSON. Operational logs are excluded (they hold no health content). */
  async export(userId: string) {
    const q = async (sql: string) => (await this.db.query(sql, [userId])).rows;
    const [account, profile, conditions, allergies, medications, memories, conversations, messages, documents, measurements, timeline, consents, moodCheckIns, plan] = await Promise.all([
      q(`SELECT email, created_at FROM users WHERE id = $1`),
      q(`SELECT first_name, last_name, date_of_birth::text AS date_of_birth, sex, height_cm, time_zone FROM profiles WHERE user_id = $1`),
      q(`SELECT name, status, source, notes, created_at FROM health_conditions WHERE user_id = $1`),
      q(`SELECT substance, reaction, severity, source, created_at FROM allergies WHERE user_id = $1`),
      q(`SELECT name, instruction, source, active, created_at FROM medications WHERE user_id = $1`),
      q(`SELECT fact, source, status, confidence, occurred_on::text AS occurred_on, created_at FROM health_memories WHERE user_id = $1`),
      q(`SELECT id, title, created_at FROM conversations WHERE user_id = $1`),
      q(`SELECT conversation_id, role, content, triage_level, created_at FROM messages WHERE user_id = $1 ORDER BY created_at`),
      q(`SELECT kind, purpose, filename, content_type, byte_size, status, result, created_at FROM documents WHERE user_id = $1`),
      q(`SELECT kind, value, unit, recorded_at, source FROM health_measurements WHERE user_id = $1 ORDER BY recorded_at`),
      q(`SELECT event_type, title, occurred_at, source_type, payload FROM timeline_events WHERE user_id = $1 ORDER BY occurred_at`),
      q(`SELECT kind, granted, version, created_at FROM consents WHERE user_id = $1 ORDER BY created_at`),
      q(`SELECT mood, recorded_at FROM mood_checkins WHERE user_id = $1 ORDER BY recorded_at`),
      q(`SELECT revision, document, updated_at FROM plans WHERE user_id = $1`),
    ]);
    await this.audit.log("account.export", userId);
    return {
      exportedAt: new Date().toISOString(),
      format: "healthmate-export-v1",
      account: account[0] ?? null,
      profile: profile[0] ?? null,
      conditions,
      allergies,
      medications,
      memories,
      conversations,
      messages,
      documents,
      measurements,
      timeline,
      consents,
      moodCheckIns,
      plan: plan[0] ?? null,
    };
  }

  /** Permanently deletes the account, its records and stored files. Requires the password. */
  async delete(userId: string, password: string) {
    if (!(await this.auth.verifyPassword(userId, password))) {
      throw new ApiError("forbidden", "Password is incorrect.", HttpStatus.FORBIDDEN);
    }
    const { rows: files } = await this.db.query<{ storage_key: string }>(`SELECT storage_key FROM documents WHERE user_id = $1`, [userId]);
    await this.db.transaction(async (tx) => {
      await this.tokens.revokeAll(userId, tx);
      // ON DELETE CASCADE removes every health table's rows.
      await tx.query(`DELETE FROM users WHERE id = $1`, [userId]);
      await this.audit.log("account.delete", userId, { files: files.length }, tx);
    });
    await Promise.all(files.map((f) => this.storage.delete(f.storage_key).catch(() => undefined)));
  }

  async consents(userId: string) {
    const { rows } = await this.db.query<{ kind: ConsentKind; granted: boolean; version: string; created_at: Date }>(
      `SELECT DISTINCT ON (kind) kind, granted, version, created_at FROM consents WHERE user_id = $1 ORDER BY kind, created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ kind: r.kind, granted: r.granted, version: r.version, updatedAt: r.created_at.toISOString() }));
  }

  /** Consent history is append-only so it remains auditable. */
  async setConsent(userId: string, kind: ConsentKind, granted: boolean) {
    await this.db.query(`INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, $2, $3, $4)`, [userId, kind, granted, CONSENT_VERSION]);
    await this.audit.log("consent.update", userId, { kind, granted });
  }

  async hasConsent(userId: string, kind: ConsentKind): Promise<boolean> {
    const { rows } = await this.db.query<{ granted: boolean }>(`SELECT granted FROM consents WHERE user_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`, [userId, kind]);
    return rows[0]?.granted ?? false;
  }

  async requireConsent(userId: string, kind: ConsentKind) {
    if (!(await this.hasConsent(userId, kind))) {
      throw new ApiError("forbidden", "Please review and accept how HealthMate processes this data before continuing.", HttpStatus.FORBIDDEN);
    }
  }
}

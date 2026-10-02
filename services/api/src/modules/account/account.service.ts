import { accountHasPassword, findLinkedUser } from "../auth/identity-links";
import type { VerifiedIdentity } from "../auth/oauth";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AuditService } from "../../common/audit";
import { ApiError } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { IDENTITY, type IdentityProvider } from "../auth/identity";
import { STORAGE, type ObjectStorage } from "../documents/storage";
import { MemoryService } from "../memory/memory.service";
import { CONSENT_REQUIRED_MESSAGE, ProcessingPolicy, type ConsentKind } from "./processing-policy";

export type { ConsentKind } from "./processing-policy";

/** Shown on reports and photos whose queued analysis was stopped by a withdrawal. */
export const PERMISSION_WITHDRAWN_REASON = "Analysis was stopped because permission for report and photo analysis was withdrawn.";
export const CONSENT_VERSION = "2026-09";

/** Data controls: export, delete, consent (spec §16.2, FR-015). */
@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(IDENTITY) private readonly identity: IdentityProvider,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(ProcessingPolicy) private readonly policy: ProcessingPolicy,
    @Inject(MemoryService) private readonly memories: MemoryService,
  ) {}

  /** Everything we hold about the user, as JSON. Operational logs are excluded (they hold no health content). */
  async export(userId: string) {
    const q = async (sql: string) => (await this.db.query(sql, [userId])).rows;
    const sections = {
      account: q(`SELECT email, email_verified_at, created_at, age_band, age_status, age_assessed_at, age_adult_on::text AS age_adult_on, age_deletion_due_at FROM users WHERE id = $1`),
      // How the age band was assessed (no dates of birth are kept here).
      ageAssessments: q(`SELECT band, source, outcome, created_at FROM age_assessments WHERE user_id = $1 ORDER BY created_at`),
      signInIdentities: q(`SELECT provider, email, created_at, last_sign_in_at FROM auth_identities WHERE user_id = $1 ORDER BY created_at`),
      // Device tokens are never exported (they're only useful for sending pushes).
      pushDevices: q(`SELECT platform, environment, app_version, created_at, last_registered_at, disabled_at FROM push_devices WHERE user_id = $1 ORDER BY created_at`),
      profile: q(
        `SELECT first_name, last_name, date_of_birth::text AS date_of_birth, sex, height_cm, time_zone, goals, unit_system, onboarding_completed_at FROM profiles WHERE user_id = $1`,
      ),
      notificationPreferences: q(
        `SELECT medication, task, appointment, report, insight, account, show_details, quiet_hours_enabled, quiet_start::text AS quiet_start, quiet_end::text AS quiet_end FROM notification_preferences WHERE user_id = $1`,
      ),
      // Full history, including stopped/resolved and superseded (corrected) rows with their links.
      conditions: q(
        `SELECT id, name, status, source, source_ref, notes, onset_on::text AS onset_on, resolved_on::text AS resolved_on, confidence, confirmed_at, superseded_by, superseded_at, created_at, updated_at
           FROM health_conditions WHERE user_id = $1 ORDER BY created_at`,
      ),
      allergies: q(
        `SELECT id, substance, reaction, severity, status, source, source_ref, noted_on::text AS noted_on, confidence, confirmed_at, superseded_by, superseded_at, created_at, updated_at
           FROM allergies WHERE user_id = $1 ORDER BY created_at`,
      ),
      medications: q(
        `SELECT id, name, instruction, source, source_ref, active, started_on::text AS started_on, stopped_on::text AS stopped_on, confidence, confirmed_at, superseded_by, superseded_at, created_at, updated_at
           FROM medications WHERE user_id = $1 ORDER BY created_at`,
      ),
      treatmentPlans: q(
        `SELECT id, title, description, care_provider_id, source, source_ref, status, started_on::text AS started_on, ended_on::text AS ended_on, confidence, confirmed_at, superseded_by, superseded_at, created_at, updated_at
           FROM treatment_plans WHERE user_id = $1 ORDER BY created_at`,
      ),
      notifications: q(`SELECT category, title, body, link, ai_generated, read_at, created_at FROM notifications WHERE user_id = $1 ORDER BY created_at`),
      symptoms: q(
        `SELECT s.name, s.body_area, s.status, s.source, s.source_ref, s.notes, s.first_noted_on::text AS first_noted_on, s.resolved_on::text AS resolved_on, s.created_at,
                COALESCE((SELECT json_agg(json_build_object('severity', e.severity, 'occurredAt', e.occurred_at, 'notes', e.notes, 'triageLevel', e.triage_level) ORDER BY e.occurred_at)
                          FROM symptom_events e WHERE e.symptom_id = s.id), '[]') AS events
           FROM symptoms s WHERE s.user_id = $1 ORDER BY s.created_at`,
      ),
      memories: q(
        `SELECT id, fact, category, source, source_id, status, prior_status, confidence, occurred_on::text AS occurred_on, ended_on::text AS ended_on, confirmed_at, superseded_by, superseded_at, ai_excluded, last_used_at, created_at, updated_at
           FROM health_memories WHERE user_id = $1 ORDER BY created_at`,
      ),
      conversations: q(`SELECT id, title, created_at FROM conversations WHERE user_id = $1 ORDER BY created_at`),
      messages: q(`SELECT conversation_id, role, content, triage_level, created_at FROM messages WHERE user_id = $1 ORDER BY created_at`),
      documents: q(
        `SELECT 'report' AS kind, NULL AS purpose, d.filename, d.content_type, d.byte_size, d.status, d.document_type, d.created_at,
                (SELECT a.result FROM document_analysis a WHERE a.document_id = d.id ORDER BY a.created_at DESC LIMIT 1) AS result
           FROM medical_documents d WHERE d.user_id = $1
         UNION ALL
         SELECT 'image', i.purpose, i.filename, i.content_type, i.byte_size, i.status, NULL, i.created_at,
                (SELECT a.result FROM image_analysis a WHERE a.image_id = i.id ORDER BY a.created_at DESC LIMIT 1)
           FROM health_images i WHERE i.user_id = $1
         ORDER BY created_at`,
      ),
      measurements: q(`SELECT kind, value, unit, recorded_at, source FROM health_measurements WHERE user_id = $1 ORDER BY recorded_at`),
      dailyHealth: q(
        `SELECT day::text AS day, kind, unit, value, min_value, max_value, sample_count, source, is_complete, time_zone, source_device, computed_at, updated_at
           FROM daily_health_records WHERE user_id = $1 ORDER BY day, kind, source`,
      ),
      healthSyncRuns: q(`SELECT kind, status, days_sent, records_upserted, oldest_day::text AS oldest_day, newest_day::text AS newest_day, error_code, started_at, finished_at FROM health_sync_runs WHERE user_id = $1 ORDER BY started_at`),
      healthKit: q(
        `SELECT status, device_name, scopes, connected_at, disconnected_at, last_sync_at, history_status, history_from::text AS history_from, history_days_requested FROM healthkit_connections WHERE user_id = $1`,
      ),
      timeline: q(`SELECT event_type, title, occurred_at, source_type, payload FROM timeline_events WHERE user_id = $1 ORDER BY occurred_at`),
      consents: q(`SELECT kind, granted, version, created_at FROM consents WHERE user_id = $1 ORDER BY created_at`),
      moodCheckIns: q(`SELECT mood, recorded_at FROM mood_checkins WHERE user_id = $1 ORDER BY recorded_at`),
      plan: q(`SELECT revision, updated_at FROM plans WHERE user_id = $1`),
      planItems: q(
        `SELECT id, treatment_plan_id, title, notes, kind, time_of_day::text AS time_of_day, repeat_type, repeat_days, repeat_day::text AS repeat_day, reminder_enabled, source, instruction,
                start_day::text AS start_day, end_day::text AS end_day, created_at
           FROM plan_items WHERE user_id = $1 ORDER BY position`,
      ),
      taskCompletions: q(`SELECT plan_item_id, day::text AS day, completed_at FROM task_completions WHERE user_id = $1 ORDER BY day`),
      careProviders: q(`SELECT name, specialty, phone, address, website, notes, created_at FROM care_providers WHERE user_id = $1 AND deleted_at IS NULL ORDER BY created_at`),
      appointments: q(`SELECT title, starts_at, ends_at, location, mode, status, notes, created_at FROM appointments WHERE user_id = $1 AND deleted_at IS NULL ORDER BY starts_at`),
    };
    const entries = await Promise.all(Object.entries(sections).map(async ([key, rows]) => [key, await rows] as const));
    const data = Object.fromEntries(entries) as Record<keyof typeof sections, Record<string, unknown>[]>;
    await this.audit.log("account.export", userId);
    return {
      exportedAt: new Date().toISOString(),
      format: "healthmate-export-v2",
      ...data,
      account: data.account[0] ?? null,
      profile: data.profile[0] ?? null,
      notificationPreferences: data.notificationPreferences[0] ?? null,
      plan: data.plan[0] ? { ...data.plan[0], items: data.planItems, completions: data.taskCompletions } : null,
    };
  }

  /**
   * Permanently deletes the account: stored files, then every database row
   * (cascade from the identity). Requires the password. Safe to repeat: the
   * account is marked first, and `finishPendingDeletions` completes any
   * deletion interrupted part-way (e.g. Storage unavailable).
   */
  /**
   * Needs the password, or a fresh sign-in with an identity linked to this account. An
   * account without a password (e.g. created with Google) may instead confirm with its
   * signed-in session plus an explicit typed confirmation (`DELETE`), since the apps
   * can't always get a fresh provider token; password accounts must still use the password.
   */
  async delete(userId: string, proof: { password: string } | { identity: VerifiedIdentity } | { confirmation: "DELETE" }) {
    let method: "password" | "identity" | "confirmation";
    if ("password" in proof) {
      method = "password";
      if (!(await this.identity.verifyPassword(userId, proof.password))) throw new ApiError("forbidden", "Password is incorrect.", HttpStatus.FORBIDDEN);
    } else if ("identity" in proof) {
      method = "identity";
      if ((await findLinkedUser(this.db, proof.identity.provider, proof.identity.subject)) !== userId) {
        throw new ApiError("forbidden", "That sign-in doesn't belong to this account.", HttpStatus.FORBIDDEN);
      }
    } else {
      method = "confirmation";
      if (await accountHasPassword(this.db, userId)) throw new ApiError("forbidden", "Confirm with your password instead.", HttpStatus.FORBIDDEN);
    }
    await this.db.query(`UPDATE users SET deletion_requested_at = COALESCE(deletion_requested_at, now()) WHERE id = $1`, [userId]);
    await this.audit.log("account.delete_requested", userId, { method });
    await this.purge(userId);
  }

  /**
   * Completes deletions that were requested but interrupted, and deletes accounts
   * found to belong to someone under 13 once their deletion is due (AgeService).
   * Returns how many finished.
   */
  async finishPendingDeletions(olderThanMinutes = 10): Promise<number> {
    const due = await this.db.query<{ id: string }>(
      // Backdated so this sweep picks them up below.
      `UPDATE users SET deletion_requested_at = now() - make_interval(mins => $1 + 1) WHERE age_deletion_due_at <= now() AND deletion_requested_at IS NULL RETURNING id`,
      [olderThanMinutes],
    );
    for (const { id } of due.rows) await this.audit.log("account.delete_requested", id, { reason: "age" });
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM users WHERE deletion_requested_at < now() - make_interval(mins => $1) LIMIT 50`,
      [olderThanMinutes],
    );
    let done = 0;
    for (const { id } of rows) {
      try {
        await this.purge(id);
        done += 1;
      } catch {
        // Retried on the next sweep.
      }
    }
    return done;
  }

  private async purge(userId: string) {
    const { rows } = await this.db.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM medical_documents WHERE user_id = $1) + (SELECT count(*) FROM health_images WHERE user_id = $1))::int AS n`,
      [userId],
    );
    // Files first: if Storage fails the account still exists and the deletion can be retried.
    await this.storage.deleteUserFiles(userId);
    await this.identity.deleteIdentity(userId);
    await this.audit.log("account.delete", userId, { files: rows[0]?.n ?? 0 });
  }

  async consents(userId: string) {
    const { rows } = await this.db.query<{ kind: ConsentKind; granted: boolean; version: string; created_at: Date }>(
      `SELECT DISTINCT ON (kind) kind, granted, version, created_at FROM consents WHERE user_id = $1 ORDER BY kind, created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({ kind: r.kind, granted: r.granted, version: r.version, updatedAt: r.created_at.toISOString() }));
  }

  /**
   * Consent history is append-only so it remains auditable. A withdrawal of
   * report and photo analysis also stops analyses that are queued but not yet
   * finished, in the same transaction and under the consent lock
   * (`ProcessingPolicy`), so a job can't store a result after it. Repeating a
   * withdrawal is harmless: it adds a history row and finds nothing left to stop.
   */
  async setConsent(userId: string, kind: ConsentKind, granted: boolean) {
    const stopped = await this.db.transaction(async (tx) => {
      await ProcessingPolicy.lockForChange(tx, userId, kind);
      await tx.query(`INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, $2, $3, $4)`, [userId, kind, granted, CONSENT_VERSION]);
      return !granted && kind === "document_processing" ? stopQueuedAnalyses(tx, userId) : 0;
    });
    await this.audit.log("consent.update", userId, { kind, granted, ...(stopped ? { stopped } : {}) });
    // Memories saved while AI processing was off weren't embedded (MemoryService.embed).
    if (granted && kind === "ai_processing") await this.memories.queueMissingEmbeddings(userId);
  }

  async hasConsent(userId: string, kind: ConsentKind): Promise<boolean> {
    return this.policy.permitted(userId, kind);
  }

  async requireConsent(userId: string, kind: ConsentKind) {
    if (!(await this.hasConsent(userId, kind))) throw new ApiError("forbidden", CONSENT_REQUIRED_MESSAGE, HttpStatus.FORBIDDEN);
  }
}

/**
 * Marks the person's reports and photos still waiting for (or in) analysis as
 * stopped. Their queued jobs then find nothing to do; a call already handed to
 * an AI provider can't be recalled, but its result is discarded (DocumentsService).
 * The photo note is cleared: it was kept only for the analysis.
 */
export async function stopQueuedAnalyses(tx: Queryable, userId: string): Promise<number> {
  const reports = await tx.query(
    `UPDATE medical_documents SET status = 'failed', failure_reason = $2, processed_at = now() WHERE user_id = $1 AND status = 'processing' RETURNING id`,
    [userId, PERMISSION_WITHDRAWN_REASON],
  );
  const images = await tx.query(
    `UPDATE health_images SET status = 'failed', failure_reason = $2, note = NULL, processed_at = now() WHERE user_id = $1 AND status = 'processing' RETURNING id`,
    [userId, PERMISSION_WITHDRAWN_REASON],
  );
  return reports.rows.length + images.rows.length;
}

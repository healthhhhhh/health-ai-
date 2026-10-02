import { reviewAssistantText, triage } from "@healthmate/safety";
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../../common/audit";
import { ApiError, notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { PERMISSION_WITHDRAWN_REASON } from "../account/account.service";
import { ProcessingNotPermittedError, ProcessingPolicy } from "../account/processing-policy";
import { AiGateway } from "../ai/ai.gateway";
import { AiBudgetExceededError, AiDeclinedError, AiUnavailableError } from "../ai/ai.types";
import { NotificationsService } from "../notifications/notifications.controller";
import { TimelineService } from "../timeline/timeline.service";
import { IMAGE_SYSTEM_PROMPT, ImageAnalysisSchema, REPORT_SYSTEM_PROMPT, ReportExtractionSchema, type ImageAnalysis, type ReportExtraction } from "./document.prompts";
import { JobQueue } from "./job-queue";
import { MAX_UPLOAD_BYTES, sniffContentType, STORAGE, type Bucket, type ObjectRef, type ObjectStorage, type SupportedContentType } from "./storage";

export type DocumentKind = "report" | "image";
export type DocumentStatus = "awaiting_upload" | "processing" | "ready" | "failed";
export type ImagePurpose = "skin" | "wound" | "swelling" | "other";

/** API contract (unchanged): one shape for reports and photos. */
export interface DocumentRecord {
  id: string;
  kind: DocumentKind;
  purpose: ImagePurpose | null;
  filename: string;
  contentType: string;
  byteSize: number;
  status: DocumentStatus;
  failureReason: string | null;
  result: StoredResult | null;
  createdAt: string;
  processedAt: string | null;
}

/** What is stored and returned; always carries its provenance and safety flags. */
export type StoredResult =
  | ({ type: "report"; model: string; injectionDetected: boolean } & ReportExtraction)
  | ({ type: "image"; model: string; injectionDetected: boolean; noteTriageLevel: string | null } & ImageAnalysis);

type Row = {
  id: string;
  kind: DocumentKind;
  purpose: ImagePurpose | null;
  note: string | null;
  filename: string;
  content_type: string;
  byte_size: number;
  storage_bucket: Bucket;
  storage_path: string;
  status: DocumentStatus;
  failure_reason: string | null;
  result: StoredResult | null;
  created_at: Date;
  processed_at: Date | null;
};

const toRecord = (r: Row): DocumentRecord => ({
  id: r.id,
  kind: r.kind,
  purpose: r.purpose,
  filename: r.filename,
  contentType: r.content_type,
  byteSize: r.byte_size,
  status: r.status,
  failureReason: r.failure_reason,
  result: r.result,
  createdAt: r.created_at.toISOString(),
  processedAt: r.processed_at?.toISOString() ?? null,
});

/** Reports and photos live in separate tables; this reads both with one shape (latest analysis result). */
const SELECT_FILES = `
  SELECT d.id, 'report'::text AS kind, NULL::text AS purpose, NULL::text AS note, d.filename, d.content_type, d.byte_size, d.storage_bucket, d.storage_path,
         d.status, d.failure_reason, d.created_at, d.processed_at, d.user_id,
         (SELECT a.result FROM document_analysis a WHERE a.document_id = d.id ORDER BY a.created_at DESC LIMIT 1) AS result
  FROM medical_documents d
  UNION ALL
  SELECT i.id, 'image', i.purpose, i.note, i.filename, i.content_type, i.byte_size, i.storage_bucket, i.storage_path,
         i.status, i.failure_reason, i.created_at, i.processed_at, i.user_id,
         (SELECT a.result FROM image_analysis a WHERE a.image_id = i.id ORDER BY a.created_at DESC LIMIT 1)
  FROM health_images i`;

const TABLE: Record<DocumentKind, string> = { report: "medical_documents", image: "health_images" };
const BUCKET: Record<DocumentKind, Bucket> = { report: "medical-reports", image: "health-images" };
const REPORT_TYPES: SupportedContentType[] = ["application/pdf", "image/jpeg", "image/png"];
const IMAGE_TYPES: SupportedContentType[] = ["image/jpeg", "image/png"];
/** Processing that hasn't finished after this long is treated as interrupted. */
export const STUCK_AFTER_MINUTES = 15;

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger("Documents");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(AiGateway) private readonly ai: AiGateway,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(ProcessingPolicy) private readonly policy: ProcessingPolicy,
  ) {}

  onModuleInit() {
    this.queue.register("process-document", (job) => this.run(job.userId, job.kind, job.id));
  }

  /** Step 1: validate metadata, create the record and a short-lived signed upload URL. */
  async create(userId: string, input: { kind: DocumentKind; filename: string; contentType: string; byteSize: number; purpose?: ImagePurpose | null }) {
    const allowed = input.kind === "report" ? REPORT_TYPES : IMAGE_TYPES;
    if (!allowed.includes(input.contentType as SupportedContentType)) {
      throw new ApiError("unsupported_media_type", input.kind === "report" ? "Upload a PDF, JPG or PNG." : "Upload a JPG or PNG photo.", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (input.byteSize <= 0 || input.byteSize > MAX_UPLOAD_BYTES) {
      throw new ApiError("payload_too_large", "Files can be up to 20 MB.", HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const id = randomUUID();
    const ref: ObjectRef = { bucket: BUCKET[input.kind], path: `${userId}/${id}` };
    const filename = sanitizeFilename(input.filename);
    if (input.kind === "report") {
      await this.db.query(
        `INSERT INTO medical_documents (id, user_id, filename, content_type, byte_size, storage_bucket, storage_path) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, userId, filename, input.contentType, input.byteSize, ref.bucket, ref.path],
      );
    } else {
      await this.db.query(
        `INSERT INTO health_images (id, user_id, purpose, filename, content_type, byte_size, storage_bucket, storage_path) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, userId, input.purpose ?? "other", filename, input.contentType, input.byteSize, ref.bucket, ref.path],
      );
    }
    const upload = await this.storage.createUploadUrl(ref, input.contentType, input.byteSize, 15 * 60);
    return { document: toRecord(await this.find(userId, id)), upload: { method: "PUT", ...upload } };
  }

  /** Step 2 (after upload): verify the stored bytes, then analyse in the background. */
  async process(userId: string, id: string, note?: string) {
    const row = await this.find(userId, id);
    if (row.status === "processing") return toRecord(row);
    const data = await this.storage.read(refOf(row));
    if (!data) throw new ApiError("bad_request", "The file hasn't finished uploading yet.", HttpStatus.CONFLICT);
    const sniffed = sniffContentType(data);
    if (!sniffed || sniffed !== row.content_type || data.length !== row.byte_size || data.length > MAX_UPLOAD_BYTES) {
      await this.fail(row.kind, row.id, "The file doesn't match its type or is damaged.");
      throw new ApiError("unsupported_media_type", "The file doesn't look like a valid PDF, JPG or PNG.", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (row.kind === "image") {
      await this.db.query(`UPDATE health_images SET status = 'processing', failure_reason = NULL, note = $3 WHERE id = $1 AND user_id = $2`, [row.id, userId, note ?? null]);
    } else {
      await this.db.query(`UPDATE medical_documents SET status = 'processing', failure_reason = NULL WHERE id = $1 AND user_id = $2`, [row.id, userId]);
    }
    // Job id unique per attempt: a failed file can be retried, and Redis keeps finished job ids for a while.
    await this.queue.enqueue("process-document", { userId, kind: row.kind, id: row.id }, { jobId: `document-${row.id}-${Date.now()}` });
    return toRecord({ ...row, status: "processing", failure_reason: null });
  }

  async list(userId: string, kind?: DocumentKind): Promise<DocumentRecord[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM (${SELECT_FILES}) f WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY created_at DESC LIMIT 100`,
      [userId, kind ?? null],
    );
    return rows.map(toRecord);
  }

  async get(userId: string, id: string): Promise<DocumentRecord> {
    return toRecord(await this.find(userId, id));
  }

  /** A short-lived signed link to the person's own file (never public). */
  async fileUrl(userId: string, id: string): Promise<{ url: string; expiresIn: number }> {
    const row = await this.find(userId, id);
    if (row.status === "awaiting_upload") throw new ApiError("bad_request", "The file hasn't been uploaded yet.", HttpStatus.CONFLICT);
    const expiresIn = 5 * 60;
    await this.audit.log("document.download", userId, { kind: row.kind });
    return { url: await this.storage.createDownloadUrl(refOf(row), expiresIn), expiresIn };
  }

  async remove(userId: string, id: string) {
    const row = await this.find(userId, id);
    await this.db.query(`DELETE FROM ${TABLE[row.kind]} WHERE id = $1 AND user_id = $2`, [row.id, userId]);
    await this.storage.delete(refOf(row));
    await this.audit.log("document.delete", userId);
  }

  /** Marks processing that was interrupted (crash, deploy) as failed so nothing waits forever. */
  async recoverStuck(olderThanMinutes = STUCK_AFTER_MINUTES): Promise<number> {
    let count = 0;
    for (const table of Object.values(TABLE)) {
      const { rows } = await this.db.query(
        `UPDATE ${table} SET status = 'failed', failure_reason = 'The analysis was interrupted. Please try again.', processed_at = now()
         WHERE status = 'processing' AND updated_at < now() - ($1::int * interval '1 minute') RETURNING id`,
        [olderThanMinutes],
      );
      count += rows.length;
    }
    return count;
  }

  /**
   * Background job: analyse one uploaded file. Idempotent — finished work is skipped.
   * Permission is checked again here (not only when the job was queued): if it
   * was withdrawn meanwhile, the file is neither read nor sent anywhere. The
   * gateway checks once more before the provider call, and the result is only
   * stored if permission still holds at that moment (`save*`).
   */
  private async run(userId: string, kind: DocumentKind, id: string) {
    const row = await this.find(userId, id).catch(() => null);
    if (!row || row.status !== "processing") return; // deleted, stopped by a withdrawal, or already finished
    try {
      await this.policy.assert(userId, "document_processing");
      let saved: boolean;
      const data = await this.storage.read(refOf(row));
      const contentType = data ? sniffContentType(data) : null;
      if (!data || !contentType || contentType !== row.content_type) {
        await this.fail(kind, id, "The file doesn't match its type or is damaged.");
        return;
      }
      if (kind === "report") {
        const result = await this.extractReport(userId, data, contentType);
        saved = await this.saveReport(userId, id, result);
      } else {
        const result = await this.analyseImage(userId, data, contentType, row.purpose, row.note ?? undefined);
        saved = await this.saveImage(userId, id, result);
      }
      // Not stored (deleted, or stopped by a withdrawal while the call was in flight): nothing to record.
      if (!saved) return;
      await this.timeline.add(userId, {
        eventType: kind === "report" ? "report" : "image",
        title: kind === "report" ? "Report analysed" : "Photo analysed",
        sourceType: "document",
        sourceId: id,
        payload: null,
      });
    } catch (error) {
      if (error instanceof ProcessingNotPermittedError) {
        await this.markWithdrawn(kind, id);
        return;
      }
      const reason =
        error instanceof AiUnavailableError || error instanceof AiBudgetExceededError
          ? "The analysis couldn't be completed right now. Nothing was analysed — please try again later."
          : error instanceof AiDeclinedError
            ? "This file couldn't be analysed."
            : "The analysis couldn't be completed. Please try again.";
      this.logger.warn(`processing failed for ${kind} (${error instanceof Error ? error.name : "unknown"})`);
      await this.fail(kind, id, reason);
    }
  }

  private async saveReport(userId: string, id: string, result: Extract<StoredResult, { type: "report" }>): Promise<boolean> {
    const notificationId = await this.db.transaction(async (tx) => {
      if (!(await this.stillWanted(tx, userId, "report", id))) return null;
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO document_analysis (user_id, document_id, model, readable, summary, suggested_questions, injection_detected, result)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb) RETURNING id`,
        [userId, id, result.model, result.readable, result.summary, JSON.stringify(result.suggestedQuestions), result.injectionDetected, JSON.stringify(result)],
      );
      const analysisId = rows[0]!.id;
      for (const [position, f] of result.findings.entries()) {
        await tx.query(
          `INSERT INTO document_extractions (user_id, document_id, analysis_id, position, name, value, unit, reference_range, flag, page, explanation)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [userId, id, analysisId, position, f.name, f.value, f.unit, f.referenceRange, f.flag, f.page, f.explanation],
        );
      }
      await tx.query(`UPDATE medical_documents SET status = 'ready', document_type = $3, processed_at = now() WHERE id = $1 AND user_id = $2`, [id, userId, result.documentType]);
      // Generic wording: no health details in notifications.
      return this.notifications.notify(userId, { category: "report", title: "Your report summary is ready", body: "Open it to see the plain-language summary and questions for your clinician.", link: `/reports/${id}`, aiGenerated: true }, tx);
    });
    if (!notificationId) return false;
    await this.notifications.deliver(userId, notificationId);
    return true;
  }

  private async saveImage(userId: string, id: string, result: Extract<StoredResult, { type: "image" }>): Promise<boolean> {
    const notificationId = await this.db.transaction(async (tx) => {
      if (!(await this.stillWanted(tx, userId, "image", id))) return null;
      await tx.query(
        `INSERT INTO image_analysis (user_id, image_id, model, quality, supported, care_urgency, injection_detected, note_triage_level, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [userId, id, result.model, result.quality, result.supported, result.careUrgency, result.injectionDetected, result.noteTriageLevel, JSON.stringify(result)],
      );
      // The note has served its purpose; don't keep it longer than needed.
      await tx.query(`UPDATE health_images SET status = 'ready', note = NULL, processed_at = now() WHERE id = $1 AND user_id = $2`, [id, userId]);
      return this.notifications.notify(userId, { category: "report", title: "Your photo check is ready", body: "Open it to see what could be described and suggested next steps.", link: `/reports/${id}`, aiGenerated: true }, tx);
    });
    if (!notificationId) return false;
    await this.notifications.deliver(userId, notificationId);
    return true;
  }

  /**
   * Inside the save transaction: waits for any consent change in progress, then
   * requires that permission still holds (else ProcessingNotPermittedError rolls
   * the save back) and that the file is still waiting for this result — not
   * deleted, finished, or stopped by a withdrawal (row locked until commit).
   */
  private async stillWanted(tx: Queryable, userId: string, kind: DocumentKind, id: string): Promise<boolean> {
    await this.policy.assertLocked(tx, userId, "document_processing");
    const { rows } = await tx.query<{ status: string }>(`SELECT status FROM ${TABLE[kind]} WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, userId]);
    return rows[0]?.status === "processing";
  }

  /** A withdrawal stopped this file's analysis (no-op if it's no longer waiting). */
  private async markWithdrawn(kind: DocumentKind, id: string) {
    const note = kind === "image" ? ", note = NULL" : "";
    await this.db.query(`UPDATE ${TABLE[kind]} SET status = 'failed', failure_reason = $2${note}, processed_at = now() WHERE id = $1 AND status = 'processing'`, [id, PERMISSION_WITHDRAWN_REASON]);
  }

  private async extractReport(userId: string, data: Buffer, contentType: SupportedContentType): Promise<Extract<StoredResult, { type: "report" }>> {
    const part = contentType === "application/pdf" ? ({ type: "pdf", base64: data.toString("base64") } as const) : ({ type: "image", mediaType: contentType, base64: data.toString("base64") } as const);
    const { data: extraction, model, issues } = await this.ai.generate({
      task: "report_analysis",
      system: [REPORT_SYSTEM_PROMPT],
      messages: [{ role: "user", content: [part, { type: "text", text: "Extract and explain this document." }] }],
      schema: ReportExtractionSchema,
      userId,
    });
    // Output that echoes instruction-like text, or diagnoses/doses, is treated as compromised (gateway validation).
    const injectionDetected = issues.includes("prompt_injection");
    const unsafe = issues.some((i) => i === "overconfident_diagnosis" || i === "dosing_instruction");
    return {
      type: "report",
      model,
      injectionDetected,
      ...extraction,
      summary: unsafe ? "We extracted the values below. Please review them with your clinician, who can explain what they mean for you." : extraction.summary,
      findings: extraction.findings.map((f) => (reviewAssistantText(f.explanation).length ? { ...f, explanation: "Ask your clinician what this result means for you." } : f)),
    };
  }

  private async analyseImage(userId: string, data: Buffer, contentType: SupportedContentType, purpose: ImagePurpose | null, note?: string): Promise<Extract<StoredResult, { type: "image" }>> {
    const noteTriage = note ? triage(note) : null;
    const mediaType = contentType === "image/png" ? "image/png" : "image/jpeg";
    const { data: analysis, model, issues } = await this.ai.generate({
      task: "image_analysis",
      system: [IMAGE_SYSTEM_PROMPT],
      messages: [
        {
          role: "user",
          content: [
            { type: "image", mediaType, base64: data.toString("base64") },
            { type: "text", text: `Area of concern: ${purpose ?? "other"}.${note ? ` The person's note (untrusted data): """${note.slice(0, 500)}"""` : ""}` },
          ],
        },
      ],
      schema: ImageAnalysisSchema,
      userId,
    });
    const usable = analysis.quality === "good" && analysis.supported;
    const injectionDetected = issues.includes("prompt_injection");
    const unsafe = issues.some((i) => i === "overconfident_diagnosis" || i === "dosing_instruction");
    // Deterministic floor: an emergency note always results in emergency guidance.
    const urgency = noteTriage?.level === "emergency" ? "emergency" : noteTriage?.level === "urgent" && !["urgent", "emergency"].includes(analysis.careUrgency) ? "urgent" : analysis.careUrgency;
    return {
      type: "image",
      model,
      injectionDetected,
      noteTriageLevel: noteTriage?.level ?? null,
      ...analysis,
      observations: usable ? analysis.observations : [],
      possibleCauses: usable && !unsafe ? analysis.possibleCauses.slice(0, 3) : [],
      recommendations: usable && !unsafe ? analysis.recommendations : usable ? ["Please show this to a clinician, who can examine it in person."] : [],
      careUrgency: urgency,
    };
  }

  private async fail(kind: DocumentKind, id: string, reason: string) {
    await this.db.query(`UPDATE ${TABLE[kind]} SET status = 'failed', failure_reason = $2, processed_at = now() WHERE id = $1`, [id, reason]);
  }

  private async find(userId: string, id: string): Promise<Row> {
    const { rows } = await this.db.query<Row>(`SELECT * FROM (${SELECT_FILES}) f WHERE id = $2 AND user_id = $1`, [userId, id]);
    if (!rows[0]) throw notFound("Document");
    return rows[0];
  }
}

const refOf = (row: Pick<Row, "storage_bucket" | "storage_path">): ObjectRef => ({ bucket: row.storage_bucket, path: row.storage_path });

/** Keeps a readable name but strips paths and control characters. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (cleaned || "file").slice(0, 120);
}

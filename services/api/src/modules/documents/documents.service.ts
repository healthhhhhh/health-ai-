import { detectPromptInjection, reviewAssistantText, triage } from "@healthmate/safety";
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../../common/audit";
import { ApiError, notFound } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
import { AiGateway } from "../ai/ai.gateway";
import { AiDeclinedError, AiUnavailableError } from "../ai/ai.types";
import { TimelineService } from "../timeline/timeline.service";
import { IMAGE_SYSTEM_PROMPT, ImageAnalysisSchema, REPORT_SYSTEM_PROMPT, ReportExtractionSchema, type ImageAnalysis, type ReportExtraction } from "./document.prompts";
import { JobQueue } from "./job-queue";
import { MAX_UPLOAD_BYTES, sniffContentType, STORAGE, type ObjectStorage, type SupportedContentType } from "./storage";

export type DocumentKind = "report" | "image";
export type DocumentStatus = "awaiting_upload" | "processing" | "ready" | "failed";
export type ImagePurpose = "skin" | "wound" | "swelling" | "other";

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
  filename: string;
  content_type: string;
  byte_size: number;
  storage_key: string;
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

const COLUMNS = "id, kind, purpose, filename, content_type, byte_size, storage_key, status, failure_reason, result, created_at, processed_at";
const REPORT_TYPES: SupportedContentType[] = ["application/pdf", "image/jpeg", "image/png"];
const IMAGE_TYPES: SupportedContentType[] = ["image/jpeg", "image/png"];

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger("Documents");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
    @Inject(AiGateway) private readonly ai: AiGateway,
    @Inject(JobQueue) private readonly queue: JobQueue,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Step 1: validate metadata, create the record and a short-lived upload URL. */
  async create(userId: string, input: { kind: DocumentKind; filename: string; contentType: string; byteSize: number; purpose?: ImagePurpose | null }) {
    const allowed = input.kind === "report" ? REPORT_TYPES : IMAGE_TYPES;
    if (!allowed.includes(input.contentType as SupportedContentType)) {
      throw new ApiError("unsupported_media_type", input.kind === "report" ? "Upload a PDF, JPG or PNG." : "Upload a JPG or PNG photo.", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    if (input.byteSize <= 0 || input.byteSize > MAX_UPLOAD_BYTES) {
      throw new ApiError("payload_too_large", "Files can be up to 20 MB.", HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const id = randomUUID();
    const storageKey = `${userId}/${id}`;
    const { rows } = await this.db.query<Row>(
      `INSERT INTO documents (id, user_id, kind, purpose, filename, content_type, byte_size, storage_key, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'awaiting_upload') RETURNING ${COLUMNS}`,
      [id, userId, input.kind, input.kind === "image" ? (input.purpose ?? "other") : null, sanitizeFilename(input.filename), input.contentType, input.byteSize, storageKey],
    );
    const upload = await this.storage.createUploadUrl(storageKey, input.contentType, input.byteSize, 15 * 60);
    return { document: toRecord(rows[0]!), upload: { method: "PUT", ...upload } };
  }

  /** Step 2 (after upload): verify the stored bytes, then process in the background. */
  async process(userId: string, id: string, note?: string) {
    const row = await this.find(userId, id);
    if (row.status === "processing") return toRecord(row);
    const data = await this.storage.read(row.storage_key);
    if (!data) throw new ApiError("bad_request", "The file hasn't finished uploading yet.", HttpStatus.CONFLICT);
    const sniffed = sniffContentType(data);
    if (!sniffed || sniffed !== row.content_type || data.length > MAX_UPLOAD_BYTES) {
      await this.fail(row.id, "The file doesn't match its type or is damaged.");
      throw new ApiError("unsupported_media_type", "The file doesn't look like a valid PDF, JPG or PNG.", HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    await this.db.query(`UPDATE documents SET status = 'processing', failure_reason = NULL WHERE id = $1`, [row.id]);
    this.queue.enqueue(() => this.run(userId, row, data, sniffed, note));
    return toRecord({ ...row, status: "processing", failure_reason: null });
  }

  async list(userId: string, kind?: DocumentKind): Promise<DocumentRecord[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM documents WHERE user_id = $1 AND ($2::text IS NULL OR kind = $2) ORDER BY created_at DESC LIMIT 100`,
      [userId, kind ?? null],
    );
    return rows.map(toRecord);
  }

  async get(userId: string, id: string): Promise<DocumentRecord> {
    return toRecord(await this.find(userId, id));
  }

  async remove(userId: string, id: string) {
    const row = await this.find(userId, id);
    await this.db.query(`DELETE FROM documents WHERE id = $1 AND user_id = $2`, [row.id, userId]);
    await this.storage.delete(row.storage_key);
    await this.audit.log("document.delete", userId);
  }

  private async run(userId: string, row: Row, data: Buffer, contentType: SupportedContentType, note?: string) {
    try {
      const result = row.kind === "report" ? await this.extractReport(userId, data, contentType) : await this.analyseImage(userId, data, contentType, row.purpose, note);
      await this.db.query(`UPDATE documents SET status = 'ready', result = $2::jsonb, model = $3, processed_at = now() WHERE id = $1`, [row.id, JSON.stringify(result), result.model]);
      await this.timeline.add(userId, {
        eventType: row.kind === "report" ? "report" : "image",
        title: row.kind === "report" ? "Report analysed" : "Photo analysed",
        sourceType: "document",
        sourceId: row.id,
        payload: null,
      });
    } catch (error) {
      const reason =
        error instanceof AiUnavailableError
          ? "The analysis couldn't be completed right now. Nothing was analysed — please try again later."
          : error instanceof AiDeclinedError
            ? "This file couldn't be analysed."
            : "The analysis couldn't be completed. Please try again.";
      this.logger.warn(`processing failed for document (${error instanceof Error ? error.name : "unknown"})`);
      await this.fail(row.id, reason);
    }
  }

  private async extractReport(userId: string, data: Buffer, contentType: SupportedContentType): Promise<StoredResult> {
    const part = contentType === "application/pdf" ? ({ type: "pdf", base64: data.toString("base64") } as const) : ({ type: "image", mediaType: contentType, base64: data.toString("base64") } as const);
    const { data: extraction, model } = await this.ai.generate({
      feature: "document_extraction",
      system: [REPORT_SYSTEM_PROMPT],
      messages: [{ role: "user", content: [part, { type: "text", text: "Extract and explain this document." }] }],
      schema: ReportExtractionSchema,
      effort: "high",
      userId,
    });
    const texts = [extraction.summary, ...extraction.findings.map((f) => f.explanation), ...extraction.suggestedQuestions];
    // Output that echoes instruction-like text, or diagnoses/doses, is treated as compromised.
    const injectionDetected = extraction.containsInstructionsToAi || texts.some((t) => detectPromptInjection(t));
    const unsafe = texts.some((t) => reviewAssistantText(t).length > 0);
    return {
      type: "report",
      model,
      injectionDetected,
      ...extraction,
      summary: unsafe ? "We extracted the values below. Please review them with your clinician, who can explain what they mean for you." : extraction.summary,
      findings: extraction.findings.map((f) => (reviewAssistantText(f.explanation).length ? { ...f, explanation: "Ask your clinician what this result means for you." } : f)),
    };
  }

  private async analyseImage(userId: string, data: Buffer, contentType: SupportedContentType, purpose: ImagePurpose | null, note?: string): Promise<StoredResult> {
    const noteTriage = note ? triage(note) : null;
    const mediaType = contentType === "image/png" ? "image/png" : "image/jpeg";
    const { data: analysis, model } = await this.ai.generate({
      feature: "image_analysis",
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
      effort: "high",
      userId,
    });
    const usable = analysis.quality === "good" && analysis.supported;
    const texts = [...analysis.observations, ...analysis.recommendations, ...analysis.warningSigns, ...analysis.possibleCauses.map((c) => c.name)];
    const injectionDetected = analysis.containsInstructionsToAi || texts.some((t) => detectPromptInjection(t));
    const unsafe = texts.some((t) => reviewAssistantText(t).length > 0);
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

  private async fail(id: string, reason: string) {
    await this.db.query(`UPDATE documents SET status = 'failed', failure_reason = $2, processed_at = now() WHERE id = $1`, [id, reason]);
  }

  private async find(userId: string, id: string): Promise<Row> {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM documents WHERE id = $2 AND user_id = $1`, [userId, id]);
    if (!rows[0]) throw notFound("Document");
    return rows[0];
  }
}

/** Keeps a readable name but strips paths and control characters. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim();
  return (cleaned || "file").slice(0, 120);
}

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { JobQueue } from "../documents/job-queue";
import { EMBEDDINGS, toVectorLiteral, type EmbeddingProvider } from "./embeddings";

/**
 * Provenance of a remembered fact (spec §8.4). `ai_inferred` is never shown as
 * confirmed history and only becomes `user_confirmed` when the person
 * explicitly confirms it (which sets `confirmed_at`; the database enforces this).
 */
export type MemoryStatus = "user_reported" | "user_confirmed" | "document_extracted" | "healthkit" | "clinician_provided" | "ai_inferred" | "superseded";
export type MemorySource = "user_conversation" | "user_entry" | "document" | "wearable" | "clinician";

export interface Memory {
  id: string;
  fact: string;
  source: MemorySource;
  sourceId: string | null;
  status: MemoryStatus;
  confidence: number;
  occurredOn: string | null;
  /** When the fact stopped being true, if it did (history, not a correction). */
  endedOn: string | null;
  category: MemoryCategory | null;
  confirmedAt: string | null;
  /** Set when a correction replaced this fact; `priorStatus` keeps its original provenance. */
  supersededBy: string | null;
  supersededAt: string | null;
  priorStatus: Exclude<MemoryStatus, "superseded"> | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryCategory = "condition" | "medication" | "allergy" | "symptom" | "measurement" | "procedure" | "lifestyle" | "family_history" | "other";

type Row = {
  id: string; fact: string; source: MemorySource; source_id: string | null; status: MemoryStatus; confidence: number; occurred_on: string | null; ended_on: string | null;
  category: MemoryCategory | null; confirmed_at: Date | null; superseded_by: string | null; superseded_at: Date | null; prior_status: Memory["priorStatus"]; created_at: Date; updated_at: Date;
};

const toMemory = (r: Row): Memory => ({
  id: r.id,
  fact: r.fact,
  source: r.source,
  sourceId: r.source_id,
  status: r.status,
  confidence: Number(r.confidence),
  occurredOn: r.occurred_on,
  endedOn: r.ended_on,
  category: r.category,
  confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : null,
  supersededBy: r.superseded_by,
  supersededAt: r.superseded_at ? r.superseded_at.toISOString() : null,
  priorStatus: r.prior_status,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const COLUMNS =
  "id, fact, source, source_id, status, confidence, occurred_on::text AS occurred_on, ended_on::text AS ended_on, category, confirmed_at, superseded_by, superseded_at, prior_status, created_at, updated_at";

@Injectable()
export class MemoryService implements OnModuleInit {
  private readonly logger = new Logger("Memory");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(JobQueue) private readonly jobs: JobQueue,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingProvider,
  ) {}

  onModuleInit() {
    this.jobs.register("embed-memory", ({ userId, memoryId }) => this.embed(userId, memoryId));
  }

  async list(userId: string, query?: string): Promise<Memory[]> {
    if (query?.trim()) {
      const { rows } = await this.db.query<Row>(
        `SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND search @@ websearch_to_tsquery('english', $2) ORDER BY ts_rank(search, websearch_to_tsquery('english', $2)) DESC LIMIT 50`,
        [userId, query],
      );
      return rows.map(toMemory);
    }
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [userId]);
    return rows.map(toMemory);
  }

  async create(
    userId: string,
    input: { fact: string; source: MemorySource; sourceId?: string | null; status: Exclude<MemoryStatus, "superseded">; confidence?: number; occurredOn?: string | null; endedOn?: string | null; category?: MemoryCategory | null },
    tx: Queryable = this.db,
  ): Promise<Memory> {
    const { rows } = await tx.query<Row>(
      `INSERT INTO health_memories (user_id, fact, source, source_id, status, confidence, occurred_on, ended_on, category, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $5 = 'user_confirmed' THEN now() END) RETURNING ${COLUMNS}`,
      [userId, input.fact, input.source, input.sourceId ?? null, input.status, input.confidence ?? 1, input.occurredOn ?? null, input.endedOn ?? null, input.category ?? null],
    );
    const memory = toMemory(rows[0]!);
    if (tx === this.db) await this.queueEmbedding(userId, memory.id);
    return memory;
  }

  /** A user edit or confirmation always results in `user_confirmed`. Superseded history can't be edited. */
  async update(userId: string, id: string, patch: { fact?: string; confirm?: boolean; occurredOn?: string | null; endedOn?: string | null }): Promise<Memory> {
    const touched = patch.fact !== undefined || patch.confirm === true || patch.occurredOn !== undefined || patch.endedOn !== undefined;
    const { rows } = await this.db.query<Row>(
      `UPDATE health_memories SET fact = COALESCE($3, fact),
         occurred_on = CASE WHEN $5 THEN $6::date ELSE occurred_on END,
         ended_on = CASE WHEN $7 THEN $8::date ELSE ended_on END,
         status = CASE WHEN $4 THEN 'user_confirmed' ELSE status END,
         confirmed_at = CASE WHEN $4 THEN now() ELSE confirmed_at END,
         confidence = CASE WHEN $4 THEN 1 ELSE confidence END
       WHERE id = $2 AND user_id = $1 AND status <> 'superseded' RETURNING ${COLUMNS}`,
      [userId, id, patch.fact ?? null, touched, patch.occurredOn !== undefined, patch.occurredOn ?? null, patch.endedOn !== undefined, patch.endedOn ?? null],
    );
    if (!rows[0]) throw notFound("Memory");
    if (patch.fact) await this.queueEmbedding(userId, id);
    return toMemory(rows[0]);
  }

  /**
   * A correction: the new fact replaces the old one, which is kept as
   * history (status `superseded`, linked, original provenance in
   * `prior_status`) and never used as context again.
   */
  async supersede(userId: string, id: string, replacement: { fact: string; occurredOn?: string | null; endedOn?: string | null }): Promise<{ superseded: Memory; replacement: Memory }> {
    const result = await this.db.transaction(async (tx) => {
      const { rows: old } = await tx.query<Row>(`SELECT ${COLUMNS} FROM health_memories WHERE id = $2 AND user_id = $1 AND status <> 'superseded' FOR UPDATE`, [userId, id]);
      if (!old[0]) throw notFound("Memory");
      const next = await this.create(
        userId,
        { fact: replacement.fact, source: "user_entry", status: "user_confirmed", occurredOn: replacement.occurredOn ?? old[0].occurred_on, endedOn: replacement.endedOn ?? null, category: old[0].category },
        tx,
      );
      const { rows } = await tx.query<Row>(`UPDATE health_memories SET status = 'superseded', superseded_by = $3 WHERE id = $2 AND user_id = $1 RETURNING ${COLUMNS}`, [userId, id, next.id]);
      return { superseded: toMemory(rows[0]!), replacement: next };
    });
    await this.queueEmbedding(userId, result.replacement.id);
    return result;
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM health_memories WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows.length) throw notFound("Memory");
  }

  /**
   * Relevant memories for an AI request, scoped to one user: semantic matches
   * (pgvector) and full-text matches on the message, plus the most recent
   * facts the person reported or confirmed. Similarity only selects context;
   * each fact is passed on with its provenance, never as proven.
   */
  async relevant(userId: string, text: string, limit = 8): Promise<Memory[]> {
    const semantic = await this.semanticMatches(userId, text, limit);
    const { rows } = await this.db.query<Row>(
      `(SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND status <> 'superseded' AND search @@ plainto_tsquery('english', $2) ORDER BY ts_rank(search, plainto_tsquery('english', $2)) DESC LIMIT $3)
       UNION
       (SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND status IN ('user_confirmed', 'clinician_provided', 'user_reported') ORDER BY updated_at DESC LIMIT 4)`,
      [userId, text, limit],
    );
    const seen = new Set<string>();
    return [...semantic, ...rows.map(toMemory)].filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).slice(0, limit + 4);
  }

  /** Nearest memories by embedding (cosine distance), or none when embeddings aren't configured. */
  async semanticMatches(userId: string, text: string, limit = 8, maxDistance = 0.6): Promise<Memory[]> {
    if (!this.embeddings.available || !text.trim()) return [];
    try {
      const [vector] = await this.embeddings.embed([text.slice(0, 2000)]);
      const { rows } = await this.db.query<Row>(
        `SELECT ${COLUMNS} FROM health_memories
         WHERE user_id = $1 AND status <> 'superseded' AND embedding IS NOT NULL AND embedding <=> $2::vector < $4
         ORDER BY embedding <=> $2::vector LIMIT $3`,
        [userId, toVectorLiteral(vector!), limit, maxDistance],
      );
      return rows.map(toMemory);
    } catch (error) {
      this.logger.warn(`semantic retrieval unavailable (${error instanceof Error ? error.name : "unknown"}); using full-text only`);
      return [];
    }
  }

  /** Background job: store the embedding for one memory (skips if already current). */
  async embed(userId: string, memoryId: string) {
    if (!this.embeddings.available) return;
    const { rows } = await this.db.query<{ fact: string }>(`SELECT fact FROM health_memories WHERE id = $2 AND user_id = $1 AND embedding IS NULL`, [userId, memoryId]);
    if (!rows[0]) return;
    const [vector] = await this.embeddings.embed([rows[0].fact]);
    await this.db.query(
      `UPDATE health_memories SET embedding = $3::vector, embedding_model = $4, embedded_at = now() WHERE id = $2 AND user_id = $1 AND fact = $5`,
      [userId, memoryId, toVectorLiteral(vector!), this.embeddings.name, rows[0].fact],
    );
  }

  private async queueEmbedding(userId: string, memoryId: string) {
    // No fixed job id: an edited fact must be re-embedded; `embed` is idempotent.
    if (this.embeddings.available) await this.jobs.enqueue("embed-memory", { userId, memoryId });
  }
}

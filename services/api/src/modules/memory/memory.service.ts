import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";
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
  createdAt: string;
  updatedAt: string;
}

type Row = { id: string; fact: string; source: MemorySource; source_id: string | null; status: MemoryStatus; confidence: number; occurred_on: string | null; created_at: Date; updated_at: Date };

const toMemory = (r: Row): Memory => ({
  id: r.id,
  fact: r.fact,
  source: r.source,
  sourceId: r.source_id,
  status: r.status,
  confidence: Number(r.confidence),
  occurredOn: r.occurred_on,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

const COLUMNS = "id, fact, source, source_id, status, confidence, occurred_on::text AS occurred_on, created_at, updated_at";

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

  async create(userId: string, input: { fact: string; source: MemorySource; sourceId?: string | null; status: Exclude<MemoryStatus, "superseded">; confidence?: number; occurredOn?: string | null }): Promise<Memory> {
    const { rows } = await this.db.query<Row>(
      `INSERT INTO health_memories (user_id, fact, source, source_id, status, confidence, occurred_on, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $5 = 'user_confirmed' THEN now() END) RETURNING ${COLUMNS}`,
      [userId, input.fact, input.source, input.sourceId ?? null, input.status, input.confidence ?? 1, input.occurredOn ?? null],
    );
    const memory = toMemory(rows[0]!);
    await this.queueEmbedding(userId, memory.id);
    return memory;
  }

  /** A user edit or confirmation always results in `user_confirmed`. */
  async update(userId: string, id: string, patch: { fact?: string; confirm?: boolean }): Promise<Memory> {
    const { rows } = await this.db.query<Row>(
      `UPDATE health_memories SET fact = COALESCE($3, fact),
         status = CASE WHEN $4 OR $3 IS NOT NULL THEN 'user_confirmed' ELSE status END,
         confirmed_at = CASE WHEN $4 OR $3 IS NOT NULL THEN now() ELSE confirmed_at END,
         confidence = CASE WHEN $4 OR $3 IS NOT NULL THEN 1 ELSE confidence END
       WHERE id = $2 AND user_id = $1 RETURNING ${COLUMNS}`,
      [userId, id, patch.fact ?? null, patch.confirm ?? false],
    );
    if (!rows[0]) throw notFound("Memory");
    if (patch.fact) await this.queueEmbedding(userId, id);
    return toMemory(rows[0]);
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

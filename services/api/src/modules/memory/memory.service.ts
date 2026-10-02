import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ApiError, notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";
import { ProcessingPolicy } from "../account/processing-policy";
import { JobQueue } from "../documents/job-queue";
import { EMBEDDINGS, toVectorLiteral, type EmbeddingProvider } from "./embeddings";
import {
  categorize,
  questionCategories,
  selectMemoriesForContext,
  type MemoryCandidate,
  type MemoryCategory,
  type SelectedMemory,
  type TemporalStatus,
} from "./memory-retrieval";

export type { MemoryCategory, TemporalStatus } from "./memory-retrieval";

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
  /** current / historical (ended) / superseded (corrected), derived from the dates and status. */
  temporalStatus: TemporalStatus;
  /** Kept, but never given to the AI Health Assistant. */
  aiExcluded: boolean;
  /** When this fact last informed an AI answer. */
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = {
  id: string; fact: string; source: MemorySource; source_id: string | null; status: MemoryStatus; confidence: number; occurred_on: string | null; ended_on: string | null;
  category: MemoryCategory | null; confirmed_at: Date | null; superseded_by: string | null; superseded_at: Date | null; prior_status: Memory["priorStatus"];
  temporal_status: TemporalStatus; ai_excluded: boolean; last_used_at: Date | null; created_at: Date; updated_at: Date;
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
  temporalStatus: r.temporal_status,
  aiExcluded: r.ai_excluded,
  lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Temporal status is derived in one place, so the list filter and the response always agree. */
const TEMPORAL = `CASE WHEN status = 'superseded' THEN 'superseded' WHEN ended_on IS NOT NULL AND ended_on <= current_date THEN 'historical' ELSE 'current' END`;
const COLUMNS = `id, fact, source, source_id, status, confidence, occurred_on::text AS occurred_on, ended_on::text AS ended_on, category, confirmed_at, superseded_by, superseded_at, prior_status,
  ${TEMPORAL} AS temporal_status, ai_excluded, last_used_at, created_at, updated_at`;
/** Facts the AI may be given: not corrected away, not excluded by the person. */
const AI_USABLE = `status <> 'superseded' AND NOT ai_excluded`;

export interface MemoryListFilter {
  q?: string;
  status?: TemporalStatus | "all";
  category?: MemoryCategory;
}

@Injectable()
export class MemoryService implements OnModuleInit {
  private readonly logger = new Logger("Memory");

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(JobQueue) private readonly jobs: JobQueue,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingProvider,
    @Inject(ProcessingPolicy) private readonly policy: ProcessingPolicy,
  ) {}

  onModuleInit() {
    this.jobs.register("embed-memory", ({ userId, memoryId }) => this.embed(userId, memoryId));
  }

  /** Newest first; filter by text, temporal status and category. Everything is listed by default, history included. */
  async list(userId: string, filter: MemoryListFilter | string = {}): Promise<Memory[]> {
    const f = typeof filter === "string" ? { q: filter } : filter;
    const q = f.q?.trim() || null;
    const { rows } = await this.db.query<Row>(
      `SELECT ${COLUMNS} FROM health_memories
        WHERE user_id = $1
          AND ($2::text IS NULL OR search @@ websearch_to_tsquery('english', $2))
          AND ($3::text IS NULL OR $3 = 'all' OR ${TEMPORAL} = $3)
          AND ($4::text IS NULL OR category = $4)
        ORDER BY CASE WHEN $2::text IS NULL THEN 0 ELSE ts_rank(search, websearch_to_tsquery('english', $2)) END DESC, created_at DESC
        LIMIT ${q ? 50 : 500}`,
      [userId, q, f.status ?? null, f.category ?? null],
    );
    return rows.map(toMemory);
  }

  async get(userId: string, id: string, tx: Queryable = this.db): Promise<Memory> {
    const { rows } = await tx.query<Row>(`SELECT ${COLUMNS} FROM health_memories WHERE id = $2 AND user_id = $1`, [userId, id]);
    if (!rows[0]) throw notFound("Memory");
    return toMemory(rows[0]);
  }

  async create(
    userId: string,
    input: { fact: string; source: MemorySource; sourceId?: string | null; status: Exclude<MemoryStatus, "superseded">; confidence?: number; occurredOn?: string | null; endedOn?: string | null; category?: MemoryCategory | null },
    tx: Queryable = this.db,
  ): Promise<Memory> {
    const { rows } = await tx.query<Row>(
      `INSERT INTO health_memories (user_id, fact, source, source_id, status, confidence, occurred_on, ended_on, category, confirmed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $5 = 'user_confirmed' THEN now() END) RETURNING ${COLUMNS}`,
      [userId, input.fact, input.source, input.sourceId ?? null, input.status, input.confidence ?? 1, input.occurredOn ?? null, input.endedOn ?? null, input.category ?? categorize(input.fact)],
    );
    const memory = toMemory(rows[0]!);
    if (tx === this.db) await this.queueEmbedding(userId, memory.id);
    return memory;
  }

  /**
   * A user edit or confirmation always results in `user_confirmed`. Choosing
   * whether the AI may use a fact changes nothing else. Superseded history can't be edited.
   */
  async update(userId: string, id: string, patch: { fact?: string; confirm?: boolean; occurredOn?: string | null; endedOn?: string | null; aiExcluded?: boolean }): Promise<Memory> {
    const touched = patch.fact !== undefined || patch.confirm === true || patch.occurredOn !== undefined || patch.endedOn !== undefined;
    const { rows } = await this.db.query<Row>(
      `UPDATE health_memories SET fact = COALESCE($3, fact),
         occurred_on = CASE WHEN $5 THEN $6::date ELSE occurred_on END,
         ended_on = CASE WHEN $7 THEN $8::date ELSE ended_on END,
         ai_excluded = COALESCE($9, ai_excluded),
         status = CASE WHEN $4 THEN 'user_confirmed' ELSE status END,
         confirmed_at = CASE WHEN $4 THEN now() ELSE confirmed_at END,
         confidence = CASE WHEN $4 THEN 1 ELSE confidence END
       WHERE id = $2 AND user_id = $1 AND status <> 'superseded' RETURNING ${COLUMNS}`,
      [userId, id, patch.fact ?? null, touched, patch.occurredOn !== undefined, patch.occurredOn ?? null, patch.endedOn !== undefined, patch.endedOn ?? null, patch.aiExcluded ?? null],
    );
    if (!rows[0]) throw notFound("Memory");
    if (patch.fact) await this.queueEmbedding(userId, id);
    return toMemory(rows[0]);
  }

  /**
   * "This is no longer true": the fact becomes history (it stays, with its
   * original source, and the AI sees it only as past). Not a correction —
   * for a mistake, supersede it instead.
   */
  async end(userId: string, id: string, endedOn?: string | null): Promise<Memory> {
    const { rows } = await this.db.query<Row>(
      `UPDATE health_memories SET ended_on = COALESCE($3::date, current_date)
        WHERE id = $2 AND user_id = $1 AND status <> 'superseded' AND (occurred_on IS NULL OR occurred_on <= COALESCE($3::date, current_date))
        RETURNING ${COLUMNS}`,
      [userId, id, endedOn ?? null],
    );
    if (!rows[0]) {
      await this.get(userId, id); // 404 when it isn't theirs
      throw new ApiError("validation_failed", "A fact can't end before it started, and corrected facts can't be changed.", HttpStatus.BAD_REQUEST);
    }
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

  /** Every version of a fact, oldest first (corrections are linked by `superseded_by`). */
  async history(userId: string, id: string): Promise<Memory[]> {
    const start = await this.get(userId, id);
    const chain: Memory[] = [start];
    // Walk back to the original…
    for (let current = start; ; ) {
      const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND superseded_by = $2`, [userId, current.id]);
      if (!rows[0] || chain.some((m) => m.id === rows[0]!.id)) break;
      current = toMemory(rows[0]);
      chain.unshift(current);
    }
    // …and forward to the latest version.
    for (let current = start; current.supersededBy && chain.length < 100; ) {
      const next = await this.get(userId, current.supersededBy).catch(() => null);
      if (!next || chain.some((m) => m.id === next.id)) break;
      chain.push(next);
      current = next;
    }
    return chain;
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM health_memories WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows.length) throw notFound("Memory");
  }

  /** Deletes every remembered fact, history included. Returns how many. */
  async removeAll(userId: string): Promise<number> {
    const { rows } = await this.db.query(`DELETE FROM health_memories WHERE user_id = $1 RETURNING id`, [userId]);
    return rows.length;
  }

  /**
   * The few facts relevant to a question, for the AI Health Assistant —
   * never the whole history. Candidates come from semantic search (pgvector),
   * full-text search, the categories the question touches and the most recent
   * confirmed facts; `selectMemoriesForContext` ranks them by relevance,
   * source and age and keeps the best within the budget. Superseded and
   * AI-excluded facts are never candidates. Similarity only selects context;
   * each fact goes to the model with its provenance and date.
   */
  async relevant(userId: string, text: string, today = new Date().toISOString().slice(0, 10)): Promise<SelectedMemory[]> {
    const categories = questionCategories(text);
    const [semantic, fullText, byCategory, recent] = await Promise.all([
      this.semanticMatches(userId, text, 16),
      this.db.query<Row & { rank: number }>(
        `SELECT ${COLUMNS}, ts_rank(search, plainto_tsquery('english', $2))::float8 AS rank FROM health_memories
          WHERE user_id = $1 AND ${AI_USABLE} AND search @@ plainto_tsquery('english', $2)
          ORDER BY rank DESC LIMIT 16`,
        [userId, text],
      ),
      categories.length
        ? this.db.query<Row>(`SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND ${AI_USABLE} AND category = ANY($2::text[]) ORDER BY updated_at DESC LIMIT 16`, [userId, categories])
        : Promise.resolve({ rows: [] as Row[] }),
      this.db.query<Row>(
        `SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND ${AI_USABLE} AND status IN ('user_confirmed', 'clinician_provided', 'user_reported') ORDER BY updated_at DESC LIMIT 4`,
        [userId],
      ),
    ]);
    const candidate = (m: Memory, extra: Partial<MemoryCandidate>): MemoryCandidate => ({
      id: m.id,
      fact: m.fact,
      status: m.status,
      occurredOn: m.occurredOn,
      endedOn: m.endedOn,
      createdAt: m.createdAt,
      category: m.category,
      aiExcluded: m.aiExcluded,
      ...extra,
    });
    const candidates: MemoryCandidate[] = [
      ...semantic.map(({ memory, similarity }) => candidate(memory, { similarity })),
      ...fullText.rows.map((r) => candidate(toMemory(r), { textRank: Number(r.rank) })),
      ...byCategory.rows.map((r) => candidate(toMemory(r), { categoryMatch: true })),
      ...recent.rows.map((r) => candidate(toMemory(r), { recent: true })),
    ];
    return selectMemoriesForContext(candidates, today);
  }

  /** Nearest memories by embedding (cosine), or none when embeddings aren't configured. */
  async semanticMatches(userId: string, text: string, limit = 8, maxDistance = 0.6): Promise<{ memory: Memory; similarity: number }[]> {
    if (!this.embeddings.available || !text.trim()) return [];
    try {
      const [vector] = await this.embeddings.embed([text.slice(0, 2000)]);
      const { rows } = await this.db.query<Row & { distance: number }>(
        `SELECT ${COLUMNS}, (embedding <=> $2::vector)::float8 AS distance FROM health_memories
         WHERE user_id = $1 AND ${AI_USABLE} AND embedding IS NOT NULL AND embedding <=> $2::vector < $4
         ORDER BY embedding <=> $2::vector LIMIT $3`,
        [userId, toVectorLiteral(vector!), limit, maxDistance],
      );
      return rows.map((r) => ({ memory: toMemory(r), similarity: Math.max(0, 1 - Number(r.distance)) }));
    } catch (error) {
      this.logger.warn(`semantic retrieval unavailable (${error instanceof Error ? error.name : "unknown"}); using full-text only`);
      return [];
    }
  }

  /** Records that these facts informed an answer (shown to the person as "last used"). */
  async markUsed(userId: string, ids: string[]) {
    if (!ids.length) return;
    await this.db.query(`UPDATE health_memories SET last_used_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, ids]).catch(() => undefined);
  }

  /**
   * Background job: store the embedding for one memory (skips if already current).
   * Embeddings exist only to pick context for the AI Health Assistant, so they
   * need the AI-processing consent at the time the job runs; without it the
   * job does nothing (the memory stays usable and is found by full-text search).
   */
  async embed(userId: string, memoryId: string) {
    if (!this.embeddings.available) return;
    if (!(await this.policy.permitted(userId, "ai_processing"))) return;
    const { rows } = await this.db.query<{ fact: string }>(`SELECT fact FROM health_memories WHERE id = $2 AND user_id = $1 AND embedding IS NULL`, [userId, memoryId]);
    if (!rows[0]) return;
    const [vector] = await this.embeddings.embed([rows[0].fact]);
    await this.db.query(
      `UPDATE health_memories SET embedding = $3::vector, embedding_model = $4, embedded_at = now() WHERE id = $2 AND user_id = $1 AND fact = $5`,
      [userId, memoryId, toVectorLiteral(vector!), this.embeddings.name, rows[0].fact],
    );
  }

  /**
   * Queues embeddings skipped while AI-processing consent was off (called when
   * it's granted again), so semantic retrieval covers every memory once more.
   */
  async queueMissingEmbeddings(userId: string, limit = 500): Promise<number> {
    if (!this.embeddings.available) return 0;
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM health_memories WHERE user_id = $1 AND embedding IS NULL AND status <> 'superseded' ORDER BY created_at DESC LIMIT $2`,
      [userId, limit],
    );
    for (const { id } of rows) await this.jobs.enqueue("embed-memory", { userId, memoryId: id });
    return rows.length;
  }

  private async queueEmbedding(userId: string, memoryId: string) {
    // No fixed job id: an edited fact must be re-embedded; `embed` is idempotent.
    if (this.embeddings.available) await this.jobs.enqueue("embed-memory", { userId, memoryId });
  }
}

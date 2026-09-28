import { Inject, Injectable } from "@nestjs/common";
import { notFound } from "../../common/errors";
import { DATABASE, type Database } from "../../db/database";

/** Spec §8.4. `ai_inferred` is never shown as confirmed history. */
export type MemoryStatus = "user_reported" | "user_confirmed" | "document_extracted" | "wearable" | "clinician_provided" | "ai_inferred" | "superseded";
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
export class MemoryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
      `INSERT INTO health_memories (user_id, fact, source, source_id, status, confidence, occurred_on) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${COLUMNS}`,
      [userId, input.fact, input.source, input.sourceId ?? null, input.status, input.confidence ?? 1, input.occurredOn ?? null],
    );
    return toMemory(rows[0]!);
  }

  /** A user edit or confirmation always results in `user_confirmed`. */
  async update(userId: string, id: string, patch: { fact?: string; confirm?: boolean }): Promise<Memory> {
    const { rows } = await this.db.query<Row>(
      `UPDATE health_memories SET fact = COALESCE($3, fact), status = CASE WHEN $4 OR $3 IS NOT NULL THEN 'user_confirmed' ELSE status END, confidence = CASE WHEN $4 OR $3 IS NOT NULL THEN 1 ELSE confidence END, updated_at = now()
       WHERE id = $2 AND user_id = $1 RETURNING ${COLUMNS}`,
      [userId, id, patch.fact ?? null, patch.confirm ?? false],
    );
    if (!rows[0]) throw notFound("Memory");
    return toMemory(rows[0]);
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM health_memories WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows.length) throw notFound("Memory");
  }

  /**
   * Relevant memories for an AI request: full-text match on the message plus
   * the most recent confirmed facts. Scoped to one user; never the whole history.
   */
  async relevant(userId: string, text: string, limit = 8): Promise<Memory[]> {
    const { rows } = await this.db.query<Row>(
      `(SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND status <> 'superseded' AND search @@ plainto_tsquery('english', $2) ORDER BY ts_rank(search, plainto_tsquery('english', $2)) DESC LIMIT $3)
       UNION
       (SELECT ${COLUMNS} FROM health_memories WHERE user_id = $1 AND status IN ('user_confirmed', 'clinician_provided', 'user_reported') ORDER BY updated_at DESC LIMIT 4)`,
      [userId, text, limit],
    );
    return rows.map(toMemory).slice(0, limit + 4);
  }
}

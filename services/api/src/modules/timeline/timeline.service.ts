import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ApiError, notFound } from "../../common/errors";
import { DATABASE, type Database, type Queryable } from "../../db/database";

export type TimelineEventType = "symptom" | "medication" | "measurement" | "report" | "image" | "chat" | "note" | "appointment";
/** Spec §12.2: the timeline distinguishes where each entry came from. */
export type TimelineSource = "user_entered" | "device" | "document" | "clinician" | "ai_summary";

export interface TimelineEvent {
  id: string;
  eventType: TimelineEventType;
  title: string;
  occurredAt: string;
  sourceType: TimelineSource;
  sourceId: string | null;
  payload: Record<string, unknown> | null;
}

type Row = { id: string; event_type: TimelineEventType; title: string; occurred_at: Date; source_type: TimelineSource; source_id: string | null; payload: Record<string, unknown> | null };

const toEvent = (r: Row): TimelineEvent => ({ id: r.id, eventType: r.event_type, title: r.title, occurredAt: r.occurred_at.toISOString(), sourceType: r.source_type, sourceId: r.source_id, payload: r.payload });

@Injectable()
export class TimelineService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async add(userId: string, event: Omit<TimelineEvent, "id" | "occurredAt"> & { occurredAt?: string }, tx: Queryable = this.db): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO timeline_events (user_id, event_type, title, occurred_at, source_type, source_id, payload) VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6, $7::jsonb) RETURNING id`,
      [userId, event.eventType, event.title, event.occurredAt ?? null, event.sourceType, event.sourceId, event.payload ? JSON.stringify(event.payload) : null],
    );
    return rows[0]!.id;
  }

  /** Keyset-paginated, newest first. `before` is an ISO timestamp cursor. */
  async list(userId: string, options: { before?: string; limit?: number; types?: TimelineEventType[] } = {}): Promise<{ events: TimelineEvent[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
    const { rows } = await this.db.query<Row>(
      `SELECT id, event_type, title, occurred_at, source_type, source_id, payload FROM timeline_events
       WHERE user_id = $1 AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz) AND ($3::text[] IS NULL OR event_type = ANY($3::text[]))
       ORDER BY occurred_at DESC LIMIT $4`,
      [userId, options.before ?? null, options.types?.length ? options.types : null, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      events: page.map(toEvent),
      nextCursor: rows.length > limit ? page[page.length - 1]!.occurred_at.toISOString() : null,
    };
  }

  async get(userId: string, id: string): Promise<TimelineEvent> {
    const { rows } = await this.db.query<Row>(`SELECT id, event_type, title, occurred_at, source_type, source_id, payload FROM timeline_events WHERE id = $2 AND user_id = $1`, [userId, id]);
    if (!rows[0]) throw notFound("Timeline entry");
    return toEvent(rows[0]);
  }

  /** Only entries the person added themselves can be edited; device, document and AI entries keep their provenance. */
  async update(userId: string, id: string, patch: { title?: string; occurredAt?: string; details?: string | null }): Promise<TimelineEvent> {
    const current = await this.get(userId, id);
    if (current.sourceType !== "user_entered") throw new ApiError("forbidden", "Only entries you added can be edited.", HttpStatus.FORBIDDEN);
    let payload = current.payload;
    if (patch.details !== undefined) {
      const rest = Object.fromEntries(Object.entries(payload ?? {}).filter(([k]) => k !== "details"));
      payload = patch.details ? { ...rest, details: patch.details } : Object.keys(rest).length ? rest : null;
    }
    const { rows } = await this.db.query<Row>(
      `UPDATE timeline_events SET title = $3, occurred_at = $4::timestamptz, payload = $5::jsonb WHERE id = $2 AND user_id = $1 AND source_type = 'user_entered'
       RETURNING id, event_type, title, occurred_at, source_type, source_id, payload`,
      [userId, id, patch.title ?? current.title, patch.occurredAt ?? current.occurredAt, payload ? JSON.stringify(payload) : null],
    );
    return toEvent(rows[0]!);
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM timeline_events WHERE id = $2 AND user_id = $1 AND source_type = 'user_entered' RETURNING id`, [userId, id]);
    if (!rows.length) throw notFound("Timeline entry");
  }
}

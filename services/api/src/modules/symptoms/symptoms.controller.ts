import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { escalationMessage, triage } from "@healthmate/safety";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { notFound, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { DATABASE, type Database } from "../../db/database";
import { TimelineService } from "../timeline/timeline.service";

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SymptomBody = z.object({
  name: z.string().trim().min(1).max(120),
  bodyArea: z.string().trim().max(80).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  firstNotedOn: Day.nullable().optional(),
});
const SymptomPatch = z.object({ status: z.enum(["active", "resolved"]).optional(), notes: z.string().max(1000).nullable().optional() });
const EventBody = z.object({
  severity: z.number().int().min(0).max(10).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(1000).nullable().optional(),
});

type SymptomRow = { id: string; name: string; body_area: string | null; status: "active" | "resolved"; notes: string | null; first_noted_on: string | null; created_at: Date; last_event_at: Date | null; last_severity: number | null };

@Injectable()
export class SymptomsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  async list(userId: string, status?: "active" | "resolved") {
    const { rows } = await this.db.query<SymptomRow>(
      `SELECT s.id, s.name, s.body_area, s.status, s.notes, s.first_noted_on::text AS first_noted_on, s.created_at, e.occurred_at AS last_event_at, e.severity AS last_severity
         FROM symptoms s
         LEFT JOIN LATERAL (SELECT occurred_at, severity FROM symptom_events WHERE symptom_id = s.id ORDER BY occurred_at DESC LIMIT 1) e ON true
        WHERE s.user_id = $1 AND ($2::text IS NULL OR s.status = $2)
        ORDER BY COALESCE(e.occurred_at, s.created_at) DESC`,
      [userId, status ?? null],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      bodyArea: r.body_area,
      status: r.status,
      notes: r.notes,
      firstNotedOn: r.first_noted_on,
      createdAt: r.created_at.toISOString(),
      lastLoggedAt: r.last_event_at?.toISOString() ?? null,
      lastSeverity: r.last_severity,
    }));
  }

  /** Adds (or reuses, by name) a tracked symptom. */
  async create(userId: string, input: z.infer<typeof SymptomBody>) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO symptoms (user_id, name, body_area, notes, first_noted_on) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, lower(name)) DO UPDATE SET status = 'active', updated_at = now()
       RETURNING id`,
      [userId, input.name, input.bodyArea ?? null, input.notes ?? null, input.firstNotedOn ?? null],
    );
    return { id: rows[0]!.id };
  }

  async update(userId: string, id: string, patch: z.infer<typeof SymptomPatch>) {
    const { rows } = await this.db.query(
      `UPDATE symptoms SET status = COALESCE($3, status), notes = CASE WHEN $4::boolean THEN $5 ELSE notes END WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId, patch.status ?? null, patch.notes !== undefined, patch.notes ?? null],
    );
    if (!rows[0]) throw notFound();
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM symptoms WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
    if (!rows[0]) throw notFound();
  }

  /**
   * Logs an occurrence. The person's words go through the same deterministic
   * triage as chat, so red-flag symptoms get fixed escalation guidance
   * straight away — no AI involved.
   */
  async logEvent(userId: string, symptomId: string, input: z.infer<typeof EventBody>) {
    const symptom = await this.db.query<{ name: string }>(`SELECT name FROM symptoms WHERE id = $1 AND user_id = $2`, [symptomId, userId]);
    if (!symptom.rows[0]) throw notFound();
    const result = triage([symptom.rows[0].name, input.notes ?? ""].join(". "));
    const id = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO symptom_events (user_id, symptom_id, severity, occurred_at, notes, triage_level) VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()), $5, $6) RETURNING id`,
        [userId, symptomId, input.severity ?? null, input.occurredAt ?? null, input.notes ?? null, result.level],
      );
      await this.timeline.add(
        userId,
        { eventType: "symptom", title: symptom.rows[0]!.name, occurredAt: input.occurredAt, sourceType: "user_entered", sourceId: rows[0]!.id, payload: input.severity == null ? null : { severity: input.severity } },
        tx,
      );
      return rows[0]!.id;
    });
    return { id, triageLevel: result.level, escalation: escalationMessage(result) };
  }

  async events(userId: string, symptomId: string) {
    const { rows } = await this.db.query<{ id: string; severity: number | null; occurred_at: Date; notes: string | null; triage_level: string | null }>(
      `SELECT id, severity, occurred_at, notes, triage_level FROM symptom_events WHERE symptom_id = $1 AND user_id = $2 ORDER BY occurred_at DESC LIMIT 200`,
      [symptomId, userId],
    );
    return rows.map((r) => ({ id: r.id, severity: r.severity, occurredAt: r.occurred_at.toISOString(), notes: r.notes, triageLevel: r.triage_level }));
  }
}

@Controller("v1/symptoms")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("symptoms", 120, 60_000)
export class SymptomsController {
  constructor(@Inject(SymptomsService) private readonly symptoms: SymptomsService) {}

  @Get()
  list(@UserId() userId: string, @Query("status") status?: string) {
    return this.symptoms.list(userId, status === "active" || status === "resolved" ? status : undefined);
  }

  @Post()
  @RateLimit("symptoms-write", 60, 60_000)
  create(@UserId() userId: string, @Body() body: unknown) {
    return this.symptoms.create(userId, parseBody(SymptomBody, body));
  }

  @Patch(":id")
  @HttpCode(204)
  @RateLimit("symptoms-write", 60, 60_000)
  update(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.symptoms.update(userId, id, parseBody(SymptomPatch, body));
  }

  @Delete(":id")
  @HttpCode(204)
  @RateLimit("symptoms-write", 60, 60_000)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.symptoms.remove(userId, id);
  }

  @Get(":id/events")
  events(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.symptoms.events(userId, id);
  }

  @Post(":id/events")
  @RateLimit("symptoms-write", 60, 60_000)
  log(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.symptoms.logEvent(userId, id, parseBody(EventBody, body ?? {}));
  }
}

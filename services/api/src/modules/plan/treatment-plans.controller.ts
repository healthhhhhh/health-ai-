import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { notFound, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { DATABASE, type Database } from "../../db/database";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");

/** The person records a plan their clinician gave them; HealthMate never writes one. */
const CreateBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    /** Verbatim from the clinician or letter. */
    description: z.string().max(2000).nullable().optional(),
    careProviderId: z.string().uuid().nullable().optional(),
    source: z.enum(["user_reported", "clinician_provided"]).default("user_reported"),
    sourceRef: z.string().trim().max(200).nullable().optional(),
    startedOn: day.nullable().optional(),
    endedOn: day.nullable().optional(),
  })
  .refine((p) => !p.startedOn || !p.endedOn || p.endedOn >= p.startedOn, { message: "must be on or after startedOn", path: ["endedOn"] });
const PatchBody = z.object({ status: z.enum(["active", "completed", "stopped"]), endedOn: day.nullable() }).partial();

export interface TreatmentPlan {
  id: string;
  title: string;
  description: string | null;
  careProviderId: string | null;
  source: "user_reported" | "clinician_provided" | "document_extracted";
  sourceRef: string | null;
  status: "active" | "completed" | "stopped";
  startedOn: string | null;
  endedOn: string | null;
  planItemIds: string[];
  createdAt: string;
  updatedAt: string;
}

type Row = {
  id: string; title: string; description: string | null; care_provider_id: string | null; source: TreatmentPlan["source"]; source_ref: string | null;
  status: TreatmentPlan["status"]; started_on: string | null; ended_on: string | null; plan_item_ids: string[] | null; created_at: Date; updated_at: Date;
};
const toPlan = (r: Row): TreatmentPlan => ({
  id: r.id,
  title: r.title,
  description: r.description,
  careProviderId: r.care_provider_id,
  source: r.source,
  sourceRef: r.source_ref,
  status: r.status,
  startedOn: r.started_on,
  endedOn: r.ended_on,
  planItemIds: r.plan_item_ids ?? [],
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
const SELECT = `SELECT t.id, t.title, t.description, t.care_provider_id, t.source, t.source_ref, t.status, t.started_on::text AS started_on, t.ended_on::text AS ended_on,
    (SELECT array_agg(i.id::text ORDER BY i.position) FROM plan_items i WHERE i.treatment_plan_id = t.id AND i.user_id = t.user_id) AS plan_item_ids, t.created_at, t.updated_at
  FROM treatment_plans t`;

/**
 * Treatment plans as the person's clinician gave them. Completing or
 * stopping one keeps it as history (status + end date); corrections
 * supersede (see docs/health-memory-architecture.md §4).
 */
@Injectable()
export class TreatmentPlansService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(userId: string): Promise<TreatmentPlan[]> {
    const { rows } = await this.db.query<Row>(`${SELECT} WHERE t.user_id = $1 AND t.superseded_at IS NULL ORDER BY t.status = 'active' DESC, t.created_at DESC`, [userId]);
    return rows.map(toPlan);
  }

  async create(userId: string, input: z.infer<typeof CreateBody>): Promise<TreatmentPlan> {
    if (input.careProviderId) {
      const owned = await this.db.query(`SELECT 1 FROM care_providers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [input.careProviderId, userId]);
      if (!owned.rows[0]) throw notFound("Care provider");
    }
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO treatment_plans (user_id, title, description, care_provider_id, source, source_ref, started_on, ended_on) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [userId, input.title, input.description ?? null, input.careProviderId ?? null, input.source, input.sourceRef ?? null, input.startedOn ?? null, input.endedOn ?? null],
    );
    return this.get(userId, rows[0]!.id);
  }

  async get(userId: string, id: string): Promise<TreatmentPlan> {
    const { rows } = await this.db.query<Row>(`${SELECT} WHERE t.id = $2 AND t.user_id = $1`, [userId, id]);
    if (!rows[0]) throw notFound("Treatment plan");
    return toPlan(rows[0]);
  }

  async update(userId: string, id: string, patch: z.infer<typeof PatchBody>): Promise<TreatmentPlan> {
    const { rows } = await this.db.query(
      `UPDATE treatment_plans SET status = COALESCE($3, status),
         ended_on = CASE WHEN $4 THEN $5::date WHEN $3 IN ('completed', 'stopped') THEN COALESCE(ended_on, current_date) WHEN $3 = 'active' THEN NULL ELSE ended_on END
       WHERE id = $2 AND user_id = $1 AND superseded_at IS NULL RETURNING id`,
      [userId, id, patch.status ?? null, patch.endedOn !== undefined, patch.endedOn ?? null],
    );
    if (!rows[0]) throw notFound("Treatment plan");
    return this.get(userId, id);
  }

  async remove(userId: string, id: string) {
    const { rows } = await this.db.query(`DELETE FROM treatment_plans WHERE id = $2 AND user_id = $1 RETURNING id`, [userId, id]);
    if (!rows[0]) throw notFound("Treatment plan");
  }
}

@Controller("v1/treatment-plans")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("treatment-plans", 120, 60_000)
export class TreatmentPlansController {
  constructor(@Inject(TreatmentPlansService) private readonly plans: TreatmentPlansService) {}

  @Get()
  list(@UserId() userId: string) {
    return this.plans.list(userId);
  }

  @Post()
  create(@UserId() userId: string, @Body() body: unknown) {
    return this.plans.create(userId, parseBody(CreateBody, body));
  }

  @Get(":id")
  get(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.plans.get(userId, id);
  }

  @Patch(":id")
  update(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.plans.update(userId, id, parseBody(PatchBody, body));
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.plans.remove(userId, id);
  }
}

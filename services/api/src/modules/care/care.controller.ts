import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { notFound, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { DATABASE, type Database } from "../../db/database";
import { TimelineService } from "../timeline/timeline.service";

const opt = (max: number) => z.string().trim().max(max).nullable().optional();
const ProviderBody = z.object({
  name: z.string().trim().min(1).max(160),
  specialty: opt(120),
  phone: opt(40),
  address: opt(300),
  website: z.string().trim().max(300).regex(/^https?:\/\//).nullable().optional(),
  notes: opt(1000),
});
const AppointmentBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    careProviderId: z.string().uuid().nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    location: opt(300),
    mode: z.enum(["in_person", "video", "phone"]).nullable().optional(),
    notes: opt(1000),
  })
  .refine((a) => !a.endsAt || Date.parse(a.endsAt) > Date.parse(a.startsAt), { message: "must be after startsAt", path: ["endsAt"] });
const AppointmentPatch = z.object({ status: z.enum(["scheduled", "completed", "cancelled"]) });

type ProviderRow = { id: string; name: string; specialty: string | null; phone: string | null; address: string | null; website: string | null; notes: string | null; created_at: Date };
type AppointmentRow = {
  id: string;
  title: string;
  care_provider_id: string | null;
  provider_name: string | null;
  starts_at: Date;
  ends_at: Date | null;
  location: string | null;
  mode: string | null;
  status: string;
  notes: string | null;
};

/**
 * The person's own list of clinicians and appointments. Records are
 * soft-deleted (`deleted_at`) so an appointment's history stays intact on
 * the timeline; account deletion removes them for good.
 */
@Injectable()
export class CareService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(TimelineService) private readonly timeline: TimelineService,
  ) {}

  async providers(userId: string) {
    const { rows } = await this.db.query<ProviderRow>(
      `SELECT id, name, specialty, phone, address, website, notes, created_at FROM care_providers WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name`,
      [userId],
    );
    return rows.map((r) => ({ id: r.id, name: r.name, specialty: r.specialty, phone: r.phone, address: r.address, website: r.website, notes: r.notes, createdAt: r.created_at.toISOString() }));
  }

  async addProvider(userId: string, input: z.infer<typeof ProviderBody>) {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO care_providers (user_id, name, specialty, phone, address, website, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, input.name, input.specialty ?? null, input.phone ?? null, input.address ?? null, input.website ?? null, input.notes ?? null],
    );
    return { id: rows[0]!.id };
  }

  async removeProvider(userId: string, id: string) {
    const { rows } = await this.db.query(`UPDATE care_providers SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`, [id, userId]);
    if (!rows[0]) throw notFound();
  }

  async appointments(userId: string, when: "upcoming" | "past" | "all") {
    const { rows } = await this.db.query<AppointmentRow>(
      `SELECT a.id, a.title, a.care_provider_id, p.name AS provider_name, a.starts_at, a.ends_at, a.location, a.mode, a.status, a.notes
         FROM appointments a LEFT JOIN care_providers p ON p.id = a.care_provider_id AND p.deleted_at IS NULL
        WHERE a.user_id = $1 AND a.deleted_at IS NULL
          AND ($2 = 'all' OR ($2 = 'upcoming' AND a.starts_at >= now()) OR ($2 = 'past' AND a.starts_at < now()))
        ORDER BY a.starts_at ${when === "past" ? "DESC" : "ASC"} LIMIT 200`,
      [userId, when],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      careProviderId: r.care_provider_id,
      providerName: r.provider_name,
      startsAt: r.starts_at.toISOString(),
      endsAt: r.ends_at?.toISOString() ?? null,
      location: r.location,
      mode: r.mode,
      status: r.status,
      notes: r.notes,
    }));
  }

  async addAppointment(userId: string, input: z.infer<typeof AppointmentBody>) {
    return this.db.transaction(async (tx) => {
      if (input.careProviderId) {
        // The provider must be the person's own.
        const owned = await tx.query(`SELECT 1 FROM care_providers WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`, [input.careProviderId, userId]);
        if (!owned.rows[0]) throw notFound("Care provider");
      }
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO appointments (user_id, care_provider_id, title, starts_at, ends_at, location, mode, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [userId, input.careProviderId ?? null, input.title, input.startsAt, input.endsAt ?? null, input.location ?? null, input.mode ?? null, input.notes ?? null],
      );
      await this.timeline.add(userId, { eventType: "appointment", title: input.title, occurredAt: input.startsAt, sourceType: "user_entered", sourceId: rows[0]!.id, payload: null }, tx);
      return { id: rows[0]!.id };
    });
  }

  async setAppointmentStatus(userId: string, id: string, status: "scheduled" | "completed" | "cancelled") {
    const { rows } = await this.db.query(`UPDATE appointments SET status = $3 WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`, [id, userId, status]);
    if (!rows[0]) throw notFound();
  }

  async removeAppointment(userId: string, id: string) {
    const { rows } = await this.db.query(`UPDATE appointments SET deleted_at = now() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id`, [id, userId]);
    if (!rows[0]) throw notFound();
    await this.db.query(`DELETE FROM timeline_events WHERE user_id = $1 AND event_type = 'appointment' AND source_id = $2`, [userId, id]);
  }
}

@Controller("v1/care")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("care", 120, 60_000)
export class CareController {
  constructor(@Inject(CareService) private readonly care: CareService) {}

  @Get("providers")
  providers(@UserId() userId: string) {
    return this.care.providers(userId);
  }

  @Post("providers")
  @RateLimit("care-write", 60, 60_000)
  addProvider(@UserId() userId: string, @Body() body: unknown) {
    return this.care.addProvider(userId, parseBody(ProviderBody, body));
  }

  @Delete("providers/:id")
  @HttpCode(204)
  @RateLimit("care-write", 60, 60_000)
  removeProvider(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.care.removeProvider(userId, id);
  }

  @Get("appointments")
  appointments(@UserId() userId: string, @Query("when") when?: string) {
    return this.care.appointments(userId, when === "past" || when === "all" ? when : "upcoming");
  }

  @Post("appointments")
  @RateLimit("care-write", 60, 60_000)
  addAppointment(@UserId() userId: string, @Body() body: unknown) {
    return this.care.addAppointment(userId, parseBody(AppointmentBody, body));
  }

  @Patch("appointments/:id")
  @HttpCode(204)
  @RateLimit("care-write", 60, 60_000)
  setStatus(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.care.setAppointmentStatus(userId, id, parseBody(AppointmentPatch, body).status);
  }

  @Delete("appointments/:id")
  @HttpCode(204)
  @RateLimit("care-write", 60, 60_000)
  removeAppointment(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.care.removeAppointment(userId, id);
  }
}

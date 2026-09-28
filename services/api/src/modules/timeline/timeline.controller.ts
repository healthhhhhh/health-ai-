import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { parseBody } from "../../common/errors";
import { TimelineService, type TimelineEventType } from "./timeline.service";

const TYPES = ["symptom", "medication", "measurement", "report", "image", "chat", "note", "appointment"] as const;

/** People can add their own entries (e.g. a symptom); device/document entries come from those pipelines. */
const CreateBody = z.object({
  eventType: z.enum(["symptom", "note", "medication", "appointment"]),
  title: z.string().trim().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  details: z.string().max(1000).optional(),
});

@Controller("v1/timeline")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("timeline", 120, 60_000)
export class TimelineController {
  constructor(@Inject(TimelineService) private readonly timeline: TimelineService) {}

  @Get()
  list(@UserId() userId: string, @Query("before") before?: string, @Query("types") types?: string) {
    const parsedTypes = typeof types === "string" ? (types.split(",").filter((t) => (TYPES as readonly string[]).includes(t)) as TimelineEventType[]) : undefined;
    const cursor = typeof before === "string" && !Number.isNaN(Date.parse(before)) ? before : undefined;
    return this.timeline.list(userId, { before: cursor, types: parsedTypes });
  }

  @Post()
  async create(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(CreateBody, body);
    const id = await this.timeline.add(userId, {
      eventType: input.eventType,
      title: input.title,
      occurredAt: input.occurredAt,
      sourceType: "user_entered",
      sourceId: null,
      payload: input.details ? { details: input.details } : null,
    });
    return { id };
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.timeline.remove(userId, id);
  }
}

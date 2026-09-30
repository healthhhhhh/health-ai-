import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { parseBody } from "../../common/errors";
import { MemoryService } from "./memory.service";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), "Invalid date");
const category = z.enum(["condition", "medication", "allergy", "symptom", "measurement", "procedure", "lifestyle", "family_history", "other"]);

/**
 * Only the person can create memories through the API, so they are always
 * `user_reported` or `user_confirmed` (e.g. accepting a suggestion from chat).
 */
const CreateBody = z.object({
  fact: z.string().trim().min(1).max(500),
  status: z.enum(["user_reported", "user_confirmed"]).default("user_reported"),
  source: z.enum(["user_conversation", "user_entry", "document"]).default("user_entry"),
  sourceId: z.string().max(100).nullable().optional(),
  occurredOn: day.nullable().optional(),
  endedOn: day.nullable().optional(),
  category: category.nullable().optional(),
});
const PatchBody = z.object({
  fact: z.string().trim().min(1).max(500).optional(),
  confirm: z.boolean().optional(),
  occurredOn: day.nullable().optional(),
  endedOn: day.nullable().optional(),
  /** Keep the fact but never give it to the AI Health Assistant. */
  aiExcluded: z.boolean().optional(),
});
/** A correction: the old fact is kept as superseded history. */
const SupersedeBody = z.object({ fact: z.string().trim().min(1).max(500), occurredOn: day.nullable().optional(), endedOn: day.nullable().optional() });
/** "No longer true" (history, not a correction). Defaults to today. */
const EndBody = z.object({ endedOn: day.nullable().optional() });
const ListQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["current", "historical", "superseded", "all"]).optional(),
  category: category.optional(),
});
/** Deleting everything needs an explicit confirmation in the request. */
const DeleteAllBody = z.object({ confirm: z.literal("delete all memories") });

@Controller("v1/memories")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("memories", 120, 60_000)
export class MemoryController {
  constructor(@Inject(MemoryService) private readonly memories: MemoryService) {}

  @Get()
  list(@UserId() userId: string, @Query() query: Record<string, unknown>) {
    const parsed = ListQuery.safeParse(query);
    return this.memories.list(userId, parsed.success ? parsed.data : {});
  }

  @Post()
  create(@UserId() userId: string, @Body() body: unknown) {
    return this.memories.create(userId, parseBody(CreateBody, body));
  }

  @Delete()
  @HttpCode(200)
  @RateLimit("memories-delete-all", 5, 60 * 60_000)
  async removeAll(@UserId() userId: string, @Body() body: unknown) {
    parseBody(DeleteAllBody, body);
    return { removed: await this.memories.removeAll(userId) };
  }

  @Get(":id/history")
  history(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.memories.history(userId, id);
  }

  @Patch(":id")
  update(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.memories.update(userId, id, parseBody(PatchBody, body));
  }

  @Post(":id/end")
  @HttpCode(200)
  end(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.memories.end(userId, id, parseBody(EndBody, body ?? {}).endedOn);
  }

  @Post(":id/supersede")
  supersede(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.memories.supersede(userId, id, parseBody(SupersedeBody, body));
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.memories.remove(userId, id);
  }
}

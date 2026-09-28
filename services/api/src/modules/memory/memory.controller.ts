import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { parseBody } from "../../common/errors";
import { MemoryService } from "./memory.service";

/**
 * Only the person can create memories through the API, so they are always
 * `user_reported` or `user_confirmed` (e.g. accepting a suggestion from chat).
 */
const CreateBody = z.object({
  fact: z.string().trim().min(1).max(500),
  status: z.enum(["user_reported", "user_confirmed"]).default("user_reported"),
  source: z.enum(["user_conversation", "user_entry", "document"]).default("user_entry"),
  sourceId: z.string().max(100).nullable().optional(),
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
const PatchBody = z.object({ fact: z.string().trim().min(1).max(500).optional(), confirm: z.boolean().optional() });

@Controller("v1/memories")
@UseGuards(AuthGuard, RateLimitGuard)
@RateLimit("memories", 120, 60_000)
export class MemoryController {
  constructor(@Inject(MemoryService) private readonly memories: MemoryService) {}

  @Get()
  list(@UserId() userId: string, @Query("q") q?: string) {
    return this.memories.list(userId, typeof q === "string" ? q.slice(0, 200) : undefined);
  }

  @Post()
  create(@UserId() userId: string, @Body() body: unknown) {
    return this.memories.create(userId, parseBody(CreateBody, body));
  }

  @Patch(":id")
  update(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.memories.update(userId, id, parseBody(PatchBody, body));
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.memories.remove(userId, id);
  }
}

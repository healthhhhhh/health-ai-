import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { AccountService } from "../account/account.service";
import { ChatService } from "./chat.service";

const RenameBody = z.object({ title: z.string().trim().min(1).max(200) });
const MessageBody = z.object({ message: z.string().trim().min(1).max(4000) });

@Controller("v1/conversations")
@UseGuards(AuthGuard, RateLimitGuard)
export class ChatController {
  constructor(
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(AccountService) private readonly account: AccountService,
  ) {}

  @Get()
  list(@UserId() userId: string) {
    return this.chat.list(userId);
  }

  @Post()
  @RateLimit("chat", 20, 60_000)
  async start(@UserId() userId: string, @Body() body: unknown) {
    const { message } = parseBody(MessageBody, body);
    await this.account.requireConsent(userId, "ai_processing");
    return this.chat.start(userId, message);
  }

  @Get(":id")
  get(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.chat.get(userId, id);
  }

  @Patch(":id")
  rename(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.chat.rename(userId, id, parseBody(RenameBody, body).title);
  }

  @Post(":id/messages")
  @RateLimit("chat", 20, 60_000)
  async send(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { message } = parseBody(MessageBody, body);
    await this.account.requireConsent(userId, "ai_processing");
    return this.chat.send(userId, id, message);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@UserId() userId: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.chat.remove(userId, id);
  }
}

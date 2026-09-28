import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { AccountService } from "./account.service";

const DeleteBody = z.object({ password: z.string().min(1).max(256) });
const ConsentBody = z.object({ kind: z.enum(["ai_processing", "document_processing", "health_data_sync", "voice"]), granted: z.boolean() });

@Controller("v1/me")
@UseGuards(AuthGuard, RateLimitGuard)
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  @Get("export")
  @RateLimit("export", 5, 60 * 60_000)
  export(@UserId() userId: string) {
    return this.account.export(userId);
  }

  @Post("delete")
  @HttpCode(204)
  @RateLimit("delete", 5, 60 * 60_000)
  async delete(@UserId() userId: string, @Body() body: unknown) {
    await this.account.delete(userId, parseBody(DeleteBody, body).password);
  }

  @Get("consents")
  consents(@UserId() userId: string) {
    return this.account.consents(userId);
  }

  @Post("consents")
  @HttpCode(204)
  async setConsent(@UserId() userId: string, @Body() body: unknown) {
    const { kind, granted } = parseBody(ConsentBody, body);
    await this.account.setConsent(userId, kind, granted);
  }
}

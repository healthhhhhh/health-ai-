import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { ID_TOKEN_VERIFIERS, type IdTokenVerifiers } from "../auth/oauth";
import { AccountService } from "./account.service";

/** Confirm with the password, or — for accounts that sign in with Google only — a fresh Google ID token. */
const DeleteBody = z.union([
  z.object({ password: z.string().min(1).max(256) }),
  z.object({ provider: z.enum(["google", "apple"]), idToken: z.string().min(20).max(4096), nonce: z.string().min(8).max(256).optional() }),
]);
const ConsentBody = z.object({ kind: z.enum(["ai_processing", "document_processing", "health_data_sync", "voice"]), granted: z.boolean() });

@Controller("v1/me")
@UseGuards(AuthGuard, RateLimitGuard)
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(ID_TOKEN_VERIFIERS) private readonly verifiers: IdTokenVerifiers,
  ) {}

  @Get("export")
  @RateLimit("export", 5, 60 * 60_000)
  export(@UserId() userId: string) {
    return this.account.export(userId);
  }

  @Post("delete")
  @HttpCode(204)
  @RateLimit("delete", 5, 60 * 60_000)
  async delete(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(DeleteBody, body);
    if ("password" in input) return this.account.delete(userId, { password: input.password });
    const verifier = this.verifiers[input.provider];
    if (!verifier) throw new ApiError("not_available", "Confirm with your password instead.", HttpStatus.NOT_IMPLEMENTED);
    await this.account.delete(userId, { identity: await verifier.verify(input.idToken, input.nonce) });
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

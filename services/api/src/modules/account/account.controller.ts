import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { AgeExempt, AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { ID_TOKEN_VERIFIERS, type IdTokenVerifiers } from "../auth/oauth";
import { AccountService } from "./account.service";
import { AgeService } from "./age.service";

/**
 * Confirm with the password; or, for accounts that sign in with Google only, a fresh
 * Google ID token or the typed confirmation `DELETE` (refused for password accounts).
 */
const DeleteBody = z.union([
  z.object({ password: z.string().min(1).max(256) }),
  z.object({ provider: z.enum(["google", "apple"]), idToken: z.string().min(20).max(4096), nonce: z.string().min(8).max(256).optional() }),
  z.strictObject({ confirm: z.literal("DELETE") }),
]);
/**
 * Strict: only a date of birth. A band, status or unverified app-store signal in the
 * body is refused (400) — the server computes the band itself.
 */
export const AgeBody = z.strictObject({ dateOfBirth: z.string().max(10) });
const ConsentBody = z.object({ kind: z.enum(["ai_processing", "document_processing", "health_data_sync", "voice"]), granted: z.boolean() });

/** Age, consents, export and deletion stay available whatever the account's age state (`@AgeExempt`). */
@Controller("v1/me")
@UseGuards(AuthGuard, RateLimitGuard)
@AgeExempt()
export class AccountController {
  constructor(
    @Inject(AccountService) private readonly account: AccountService,
    @Inject(ID_TOKEN_VERIFIERS) private readonly verifiers: IdTokenVerifiers,
    @Inject(AgeService) private readonly age: AgeService,
  ) {}

  /** Records a self-declared date of birth as an age band; with enforcement, decides what the account may use. */
  @Post("age")
  @HttpCode(200)
  @RateLimit("age", 20, 60 * 60_000)
  assessAge(@UserId() userId: string, @Body() body: unknown) {
    return this.age.assessDateOfBirth(userId, parseBody(AgeBody, body).dateOfBirth);
  }

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
    if ("confirm" in input) return this.account.delete(userId, { confirmation: input.confirm });
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

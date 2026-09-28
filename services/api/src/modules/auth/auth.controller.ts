import { Body, Controller, Headers, HttpCode, HttpStatus, Inject, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { CONFIG, type AppConfig } from "../../config";
import { IDENTITY, type IdentityProvider } from "./identity";

const email = z.string().trim().email().max(254);
/** NIST 800-63B: length over composition rules; long passphrases allowed. */
const password = z.string().min(8).max(256);

const RegisterBody = z.object({
  email,
  password,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().max(80).default(""),
  timeZone: z.string().max(64).default("UTC"),
});
const LoginBody = z.object({ email, password: z.string().min(1).max(256) });
// Supabase refresh tokens are shorter than our local ones.
const RefreshBody = z.object({ refreshToken: z.string().min(8).max(512) });
const ResetBody = z.object({ email });
const ResetCompleteBody = z.object({ accessToken: z.string().min(16).max(4096), password });

/**
 * Same contract for local auth (development) and Supabase Auth (production):
 * `{ userId, accessToken, refreshToken, expiresIn }`.
 */
@Controller("v1/auth")
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityProvider,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Post("register")
  @RateLimit("auth-register", 5, 60_000)
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parseBody(RegisterBody, body);
    const result = await this.identity.register(input);
    if ("confirmationRequired" in result) {
      // Supabase projects with email confirmation: no session until the link is clicked.
      // No user id: the response must not reveal whether the email already had an account.
      res.status(HttpStatus.ACCEPTED);
      return { confirmationRequired: true };
    }
    return { userId: result.userId, ...result.tokens };
  }

  @Post("login")
  @HttpCode(200)
  @RateLimit("auth-login", 10, 60_000)
  async login(@Body() body: unknown) {
    const { email, password } = parseBody(LoginBody, body);
    const { userId, tokens } = await this.identity.login(email, password);
    return { userId, ...tokens };
  }

  @Post("refresh")
  @HttpCode(200)
  @RateLimit("auth-refresh", 30, 60_000)
  async refresh(@Body() body: unknown) {
    return this.identity.refresh(parseBody(RefreshBody, body).refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  @RateLimit("auth-logout", 30, 60_000)
  async logout(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
    await this.identity.logout(parseBody(RefreshBody, body).refreshToken, accessToken);
  }

  /** Always 202, whether or not the email has an account. */
  @Post("password-reset")
  @HttpCode(202)
  @RateLimit("auth-password-reset", 5, 60_000)
  async passwordReset(@Body() body: unknown) {
    await this.identity.requestPasswordReset(parseBody(ResetBody, body).email, this.config.PASSWORD_RESET_REDIRECT_URL);
    return { ok: true };
  }

  /** Completes a reset with the access token from the emailed link (Supabase Auth). */
  @Post("password-reset/complete")
  @HttpCode(204)
  @RateLimit("auth-password-reset-complete", 5, 60_000)
  async completePasswordReset(@Body() body: unknown) {
    const { accessToken, password: newPassword } = parseBody(ResetCompleteBody, body);
    await this.identity.completePasswordReset(accessToken, newPassword);
  }
}

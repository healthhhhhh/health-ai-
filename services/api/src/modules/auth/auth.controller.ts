import { Body, Controller, Delete, Headers, HttpCode, HttpStatus, Inject, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { AgeExempt, AuthGuard, UserId } from "../../common/auth";
import { ApiError, parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { CONFIG, type AppConfig } from "../../config";
import { AgeService, type Assessed } from "../account/age.service";
import { DATABASE, type Database } from "../../db/database";
import { IDENTITY, type IdentityProvider } from "./identity";
import { findLinkedUser, providerName } from "./identity-links";
import { ID_TOKEN_VERIFIERS, type IdTokenVerifiers, type OAuthProvider } from "./oauth";

const email = z.string().trim().email().max(254);
/** NIST 800-63B: length over composition rules; long passphrases allowed. */
const password = z.string().min(8).max(256);

/**
 * Optional self-declared date of birth sent with sign-up. With AGE_ENFORCEMENT=enforce,
 * an age HealthMate doesn't serve is refused before an account exists; without a
 * screen the account starts with an unknown age and is restricted until one is given.
 */
const AgeScreen = z.strictObject({ dateOfBirth: z.string().max(10) }).optional();
const RegisterBody = z.object({
  ageScreen: AgeScreen,
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
const ChangePasswordBody = z.object({ currentPassword: z.string().min(1).max(256), newPassword: password });
// Supabase's confirmation link carries `token_hash`; the web page forwards it as `token`.
const VerifyEmailBody = z.object({ token: z.string().min(8).max(512) });
const provider = z.enum(["apple", "google"]);
/** `idToken` comes from the provider's SDK on the device (Google Sign-In); `nonce` is the value the app asked it to embed. */
const OAuthBody = z.object({
  provider,
  idToken: z.string().min(20).max(4096).optional(),
  nonce: z.string().min(8).max(256).optional(),
  timeZone: z.string().max(64).default("UTC"),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  ageScreen: AgeScreen,
});
const LinkBody = z.object({ provider, idToken: z.string().min(20).max(4096), nonce: z.string().min(8).max(256).optional() });

const notAvailable = (p: OAuthProvider) =>
  new ApiError("not_available", `Signing in with ${providerName(p)} isn't available on this server yet. Use your email instead.`, HttpStatus.NOT_IMPLEMENTED);

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
    @Inject(ID_TOKEN_VERIFIERS) private readonly verifiers: IdTokenVerifiers,
    @Inject(AgeService) private readonly age: AgeService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Validates an optional age screen before any account is created (400 if it can't be used). */
  private screen(screen: { dateOfBirth: string } | undefined): Assessed | null {
    return screen && this.age.recording ? this.age.assess(screen.dateOfBirth) : null;
  }

  @Post("register")
  @RateLimit("auth-register", 5, 60_000)
  async register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { ageScreen, ...input } = parseBody(RegisterBody, body);
    const assessed = this.screen(ageScreen);
    if (assessed) this.age.assertCanSignUp(assessed);
    const result = await this.identity.register(input);
    if ("confirmationRequired" in result) {
      // Supabase projects with email confirmation: no session until the link is clicked.
      // No user id: the response must not reveal whether the email already had an account.
      // The age screen isn't recorded here: without a session nothing proves this request
      // created the account (the email may belong to someone else). It stays unknown
      // until the person assesses it after signing in.
      res.status(HttpStatus.ACCEPTED);
      return { confirmationRequired: true };
    }
    if (assessed) await this.age.recordScreen(result.userId, assessed);
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

  @Post("change-password")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @AgeExempt()
  @RateLimit("auth-change-password", 5, 60_000)
  async changePassword(@UserId() userId: string, @Body() body: unknown, @Headers("authorization") authorization?: string) {
    const { currentPassword, newPassword } = parseBody(ChangePasswordBody, body);
    if (currentPassword === newPassword) throw new ApiError("validation_failed", "Choose a password you haven't used here before.", HttpStatus.BAD_REQUEST);
    await this.identity.changePassword(userId, currentPassword, newPassword, authorization?.slice(7));
  }

  /** The link in the confirmation email: confirms the address and starts a session. */
  @Post("verify-email")
  @HttpCode(200)
  @RateLimit("auth-verify-email", 10, 60_000)
  async verifyEmail(@Body() body: unknown) {
    const { userId, tokens } = await this.identity.verifyEmail(parseBody(VerifyEmailBody, body).token);
    return { userId, ...tokens };
  }

  /** Always 202, whether or not the email has an account. */
  @Post("resend-verification")
  @HttpCode(202)
  @RateLimit("auth-resend-verification", 3, 60_000)
  async resendVerification(@Body() body: unknown) {
    await this.identity.resendVerification(parseBody(ResetBody, body).email);
    return { ok: true };
  }

  /**
   * Continue with Google (Phase 2D): the app sends the ID token it got from
   * Google; the server verifies it against Google's keys and signs the person
   * in, creating the account on first use. Apple and requests without a token
   * (apps that can't obtain one yet) get 501, which clients show as
   * "isn't available on this server yet".
   */
  @Post("oauth")
  @HttpCode(200)
  @RateLimit("auth-oauth", 10, 60_000)
  async oauth(@Body() body: unknown) {
    const input = parseBody(OAuthBody, body);
    const verifier = this.verifiers[input.provider];
    if (!verifier || !input.idToken) throw notAvailable(input.provider);
    const assessed = this.screen(input.ageScreen);
    const identity = await verifier.verify(input.idToken, input.nonce);
    // A first sign-in with an age that isn't served creates nothing. An existing account
    // signs in as usual and the answer is recorded (which restricts it when enforcing).
    if (assessed && !(await findLinkedUser(this.db, identity.provider, identity.subject))) this.age.assertCanSignUp(assessed);
    const { userId, tokens, isNewUser } = await this.identity.signInWithIdToken({
      identity,
      idToken: input.idToken,
      nonce: input.nonce,
      profile: { firstName: input.firstName || identity.givenName || "", lastName: input.lastName || identity.familyName || "", timeZone: input.timeZone },
    });
    // Recorded only after the provider's token was verified and a session exists.
    if (assessed) await this.age.recordScreen(userId, assessed);
    return { userId, ...tokens, isNewUser };
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

/** Sign-in methods connected to the signed-in account (local accounts; Supabase links through its own flow). */
@Controller("v1/me/identities")
@UseGuards(AuthGuard, RateLimitGuard)
@AgeExempt()
export class IdentitiesController {
  constructor(
    @Inject(IDENTITY) private readonly identity: IdentityProvider,
    @Inject(ID_TOKEN_VERIFIERS) private readonly verifiers: IdTokenVerifiers,
  ) {}

  @Post()
  @HttpCode(204)
  @RateLimit("identities-link", 10, 60_000)
  async link(@UserId() userId: string, @Body() body: unknown) {
    const input = parseBody(LinkBody, body);
    const verifier = this.verifiers[input.provider];
    if (!verifier) throw notAvailable(input.provider);
    await this.identity.linkIdentity(userId, await verifier.verify(input.idToken, input.nonce));
  }

  @Delete(":provider")
  @HttpCode(204)
  @RateLimit("identities-unlink", 10, 60_000)
  async unlink(@UserId() userId: string, @Param("provider") value: string) {
    await this.identity.unlinkIdentity(userId, parseBody(provider, value));
  }
}

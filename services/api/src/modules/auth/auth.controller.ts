import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { parseBody } from "../../common/errors";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit";
import { AuthService } from "./auth.service";

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
const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });

@Controller("v1/auth")
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  @RateLimit("auth-register", 5, 60_000)
  async register(@Body() body: unknown) {
    const { email, password, firstName, lastName, timeZone } = parseBody(RegisterBody, body);
    const { userId, tokens } = await this.auth.register({ email, password }, { firstName, lastName, timeZone });
    return { userId, ...tokens };
  }

  @Post("login")
  @HttpCode(200)
  @RateLimit("auth-login", 10, 60_000)
  async login(@Body() body: unknown) {
    const { userId, tokens } = await this.auth.login(parseBody(LoginBody, body));
    return { userId, ...tokens };
  }

  @Post("refresh")
  @HttpCode(200)
  @RateLimit("auth-refresh", 30, 60_000)
  async refresh(@Body() body: unknown) {
    return this.auth.refresh(parseBody(RefreshBody, body).refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body() body: unknown) {
    await this.auth.logout(parseBody(RefreshBody, body).refreshToken);
  }
}

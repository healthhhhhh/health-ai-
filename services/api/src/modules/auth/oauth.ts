import { createHash } from "node:crypto";
import { HttpStatus } from "@nestjs/common";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";
import { ApiError } from "../../common/errors";
import type { AppConfig } from "../../config";

export type OAuthProvider = "google" | "apple";

/** What a verified ID token tells us about the person. Nothing here is trusted until `verify` succeeds. */
export interface VerifiedIdentity {
  provider: OAuthProvider;
  /** The provider's stable account id (`sub`). */
  subject: string;
  email: string | null;
  emailVerified: boolean;
  givenName: string | null;
  familyName: string | null;
}

/** Verifies an OpenID Connect ID token from one provider (Google, Apple) — see docs/phase2d-plan.md. */
export interface IdTokenVerifier {
  readonly provider: OAuthProvider;
  verify(idToken: string, nonce?: string): Promise<VerifiedIdentity>;
}

export const ID_TOKEN_VERIFIERS = Symbol("ID_TOKEN_VERIFIERS");
export type IdTokenVerifiers = Partial<Record<OAuthProvider, IdTokenVerifier>>;

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";

export const invalidIdToken = () =>
  new ApiError("invalid_token", "That sign-in couldn't be verified. Please try again, or use your email instead.", HttpStatus.UNAUTHORIZED);

/**
 * Google ID tokens: RS256 signature against Google's published keys, issuer,
 * audience (one of our client IDs), expiry (with 30 s clock tolerance) and,
 * when the app sent one, the nonce. No Google API call and no secret needed.
 */
export class GoogleIdTokenVerifier implements IdTokenVerifier {
  readonly provider = "google" as const;
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly clientIds: string[],
    options: { keys?: JWTVerifyGetKey } = {},
  ) {
    if (!clientIds.length) throw new Error("GoogleIdTokenVerifier needs at least one client ID");
    this.keys = options.keys ?? createRemoteJWKSet(new URL(GOOGLE_KEYS_URL), { cacheMaxAge: 60 * 60_000 });
  }

  async verify(idToken: string, nonce?: string): Promise<VerifiedIdentity> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        issuer: GOOGLE_ISSUERS,
        audience: this.clientIds,
        algorithms: ["RS256"],
        clockTolerance: 30,
        requiredClaims: ["sub", "iat", "exp"],
      }));
    } catch (error) {
      // Not reaching Google's key set is an outage, not a bad token.
      if (!(error instanceof joseErrors.JOSEError) || error instanceof joseErrors.JWKSTimeout || error instanceof joseErrors.JWKSInvalid) {
        throw new ApiError("internal", "Google sign-in is temporarily unavailable. Please try again.", HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw invalidIdToken();
    }
    const subject = payload.sub;
    if (typeof subject !== "string" || !subject || subject.length > 255) throw invalidIdToken();
    if (nonce !== undefined && payload.nonce !== nonce) throw invalidIdToken();

    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null);
    return { provider: "google", subject, email, emailVerified, givenName: text(payload.given_name), familyName: text(payload.family_name) };
  }
}

const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";

/**
 * Sign in with Apple ID tokens: RS256 signature against Apple's published keys,
 * issuer, audience (our bundle ID or Services ID), expiry (30 s tolerance).
 * Apple differs from Google in two ways:
 * - the app gives Apple the SHA-256 (hex) of its nonce, so the token carries the
 *   hash; the API receives the raw nonce and compares its hash;
 * - the token never contains the person's name (the app sends it, once, on first
 *   sign-in), and the email may be a private relay address.
 * No Apple API call and no secret needed for sign-in.
 */
export class AppleIdTokenVerifier implements IdTokenVerifier {
  readonly provider = "apple" as const;
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly clientIds: string[],
    options: { keys?: JWTVerifyGetKey } = {},
  ) {
    if (!clientIds.length) throw new Error("AppleIdTokenVerifier needs at least one client ID");
    this.keys = options.keys ?? createRemoteJWKSet(new URL(APPLE_KEYS_URL), { cacheMaxAge: 60 * 60_000 });
  }

  async verify(idToken: string, nonce?: string): Promise<VerifiedIdentity> {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(idToken, this.keys, {
        issuer: APPLE_ISSUER,
        audience: this.clientIds,
        algorithms: ["RS256"],
        clockTolerance: 30,
        requiredClaims: ["sub", "iat", "exp"],
      }));
    } catch (error) {
      // Not reaching Apple's key set is an outage, not a bad token.
      if (!(error instanceof joseErrors.JOSEError) || error instanceof joseErrors.JWKSTimeout || error instanceof joseErrors.JWKSInvalid) {
        throw new ApiError("internal", "Apple sign-in is temporarily unavailable. Please try again.", HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw invalidIdToken();
    }
    const subject = payload.sub;
    if (typeof subject !== "string" || !subject || subject.length > 255) throw invalidIdToken();
    if (nonce !== undefined && payload.nonce !== createHash("sha256").update(nonce).digest("hex")) throw invalidIdToken();

    const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
    const emailVerified = payload.email_verified === true || payload.email_verified === "true";
    return { provider: "apple", subject, email, emailVerified, givenName: null, familyName: null };
  }
}

/** The providers this server accepts: each only when its client IDs are configured. */
export function idTokenVerifiersFor(config: Pick<AppConfig, "googleClientIds" | "appleClientIds">): IdTokenVerifiers {
  return {
    ...(config.googleClientIds.length ? { google: new GoogleIdTokenVerifier(config.googleClientIds) } : {}),
    ...(config.appleClientIds.length ? { apple: new AppleIdTokenVerifier(config.appleClientIds) } : {}),
  };
}

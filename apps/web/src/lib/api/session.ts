import type { TokenPair } from "@healthmate/shared-types";

/**
 * Session cookies. Tokens live only in httpOnly cookies set by the Next.js
 * server; browser JavaScript never sees them.
 */
export const ACCESS_COOKIE = "hm_at";
export const REFRESH_COOKIE = "hm_rt";
/** Unix seconds when the access token expires (not secret; lets the proxy refresh early). */
export const EXPIRES_COOKIE = "hm_exp";

const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

export interface CookieWriter {
  set(name: string, value: string, options: { httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; maxAge: number }): unknown;
  delete(name: string): unknown;
}

const base = () => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" });

export function writeSession(cookies: CookieWriter, tokens: TokenPair, now = Date.now()) {
  cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...base(), maxAge: tokens.expiresIn });
  cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...base(), maxAge: REFRESH_MAX_AGE });
  cookies.set(EXPIRES_COOKIE, String(Math.floor(now / 1000) + tokens.expiresIn), { ...base(), maxAge: REFRESH_MAX_AGE });
}

export function clearSession(cookies: CookieWriter) {
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE, EXPIRES_COOKIE]) cookies.delete(name);
}

/** True when the access token is missing or expires within 30 seconds. */
export function needsRefresh(expires: string | undefined, access: string | undefined, now = Date.now()) {
  if (!access || !expires) return true;
  const exp = Number(expires);
  return !Number.isFinite(exp) || exp - now / 1000 < 30;
}

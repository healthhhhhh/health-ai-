import type { TokenPair } from "@healthmate/shared-types";
import { NextResponse, type NextRequest } from "next/server";
import { apiBaseUrl } from "@/lib/api/config";
import { ACCESS_COOKIE, clearSession, EXPIRES_COOKIE, needsRefresh, REFRESH_COOKIE, writeSession } from "@/lib/api/session";

/** Pages anyone can see. Everything else holds personal health data and needs a session. */
const PUBLIC_PATHS = new Set(["/", "/sign-in", "/help", "/forgot-password", "/reset-password"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === "/sign-in" && refresh && !request.nextUrl.searchParams.has("expired")) {
      return NextResponse.redirect(new URL("/home", request.url));
    }
    return NextResponse.next();
  }

  if (!refresh) return toSignIn(request, pathname + search);

  if (!needsRefresh(request.cookies.get(EXPIRES_COOKIE)?.value, request.cookies.get(ACCESS_COOKIE)?.value)) {
    return NextResponse.next();
  }

  const tokens = await refreshTokens(refresh);
  if (!tokens) {
    const response = toSignIn(request, pathname + search, true);
    clearSession(response.cookies);
    return response;
  }
  // Forward the new tokens to this render and store them in the browser.
  writeSession(request.cookies as unknown as Parameters<typeof writeSession>[0], tokens);
  const response = NextResponse.next({ request: { headers: request.headers } });
  writeSession(response.cookies, tokens);
  return response;
}

async function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
    return res.ok ? ((await res.json()) as TokenPair) : null;
  } catch {
    return null;
  }
}

function toSignIn(request: NextRequest, next: string, expired = false) {
  const url = new URL("/sign-in", request.url);
  if (next && next !== "/home") url.searchParams.set("next", next);
  if (expired) url.searchParams.set("expired", "1");
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals and static files.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|woff2?)$).*)"],
};

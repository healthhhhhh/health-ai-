import type { AuthResponse } from "@healthmate/shared-types";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ApiError, publicApi } from "@/lib/api/server";
import { writeSession } from "@/lib/api/session";

/** The link in the confirmation email: confirms the address, signs in and continues to onboarding. */
export async function GET(request: Request) {
  // Supabase's confirmation template links with `token_hash`; Preview mode uses `token`.
  const params = new URL(request.url).searchParams;
  const token = params.get("token_hash") ?? params.get("token") ?? "";
  try {
    const auth = await publicApi<AuthResponse>("auth/verify-email", { method: "POST", json: { token } });
    writeSession(await cookies(), auth);
    return NextResponse.redirect(new URL("/onboarding", request.url), 303);
  } catch (error) {
    const reason = error instanceof ApiError && error.code === "invalid_token" ? "invalid" : "failed";
    return NextResponse.redirect(new URL(`/verify-email?status=${reason}`, request.url), 303);
  }
}

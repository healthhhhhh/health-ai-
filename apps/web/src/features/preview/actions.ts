"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { clearSession, writeSession } from "@/lib/api/session";
import { isPreviewMode, previewTokens, sessionIdFromToken } from "@/lib/preview/mode";
import { REFRESH_COOKIE } from "@/lib/api/session";
import { createSession, endSession, validTimeZone } from "@/lib/preview/store";

/** Preview mode only: sign straight in to the sample account. */
export async function previewQuickSignIn(timeZone: string) {
  if (!isPreviewMode()) return;
  const session = createSession({ timeZone: validTimeZone(timeZone) });
  writeSession(await cookies(), previewTokens(session.id));
  redirect("/home");
}

/** Preview mode only: throw away changes and start again from the sample account. */
export async function previewReset(timeZone: string) {
  if (!isPreviewMode()) return;
  const jar = await cookies();
  const current = sessionIdFromToken(jar.get(REFRESH_COOKIE)?.value);
  if (current) endSession(current);
  clearSession(jar);
  const session = createSession({ timeZone: validTimeZone(timeZone) });
  writeSession(jar, previewTokens(session.id));
  redirect("/home");
}

import { cookies } from "next/headers";
import { DISPLAY_COOKIE, parseDisplayPrefs, type DisplayPrefs } from "./display-prefs";

export async function getDisplayPrefs(): Promise<DisplayPrefs> {
  return parseDisplayPrefs((await cookies()).get(DISPLAY_COOKIE)?.value);
}

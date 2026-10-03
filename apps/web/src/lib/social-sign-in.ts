import { isPreviewMode } from "./preview/mode";

/**
 * Whether the sign-in page offers Continue with Apple / Google.
 *
 * Only Preview mode can complete them today (it signs in to a sample account).
 * Against a real server the web app has no way to get a Google or Apple ID token
 * yet (Google Identity Services and Sign in with Apple JS aren't wired up — they
 * need OAuth client IDs: docs/phase2d-plan.md), so the buttons would always end in
 * "isn't available". They stay hidden until that client flow exists.
 */
export function socialSignInAvailable(): boolean {
  return isPreviewMode();
}

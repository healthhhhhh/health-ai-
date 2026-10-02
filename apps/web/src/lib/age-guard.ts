/**
 * On-device guard against retrying the age question with a different date after the
 * server restricted an account (under 13, or held for review). It stores only that a
 * restriction happened here — never a date of birth — and survives sign-out, so a new
 * account in the same browser can't simply try again. The server stays the authority:
 * this only stops the question being asked again; it never unlocks anything.
 */
export const AGE_GUARD_COOKIE = "hm_age_guard";
/** How long the guard lasts (seconds): 7 days. */
export const AGE_GUARD_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * The support address shown on Help, where restricted accounts (age review, a
 * mistyped date of birth) are sent to get in touch. Set HEALTHMATE_SUPPORT_EMAIL
 * (server-side) before launch; anything that isn't a plain email address is ignored.
 */
export function supportEmail(value = process.env.HEALTHMATE_SUPPORT_EMAIL): string | null {
  const email = value?.trim() ?? "";
  return /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(email) ? email : null;
}

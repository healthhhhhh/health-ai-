/**
 * Preview mode (Phase 1): the whole app runs on a local, in-memory sample
 * account — no backend needed. On by default unless HEALTHMATE_DATA_SOURCE=api
 * (or an API URL is configured).
 */
export function isPreviewMode(): boolean {
  const source = process.env.HEALTHMATE_DATA_SOURCE;
  if (source) return source === "preview";
  return !process.env.HEALTHMATE_API_URL;
}

/** Preview tokens carry the preview session id, so they can be refreshed without any server. */
export const PREVIEW_ACCESS_PREFIX = "pv.";
export const PREVIEW_REFRESH_PREFIX = "pvr.";
export const PREVIEW_TOKEN_TTL = 7 * 24 * 60 * 60;

export function previewTokens(sid: string) {
  return { accessToken: `${PREVIEW_ACCESS_PREFIX}${sid}`, refreshToken: `${PREVIEW_REFRESH_PREFIX}${sid}`, expiresIn: PREVIEW_TOKEN_TTL };
}

export function sessionIdFromToken(token: string | undefined): string | null {
  if (!token) return null;
  if (token.startsWith(PREVIEW_ACCESS_PREFIX)) return token.slice(PREVIEW_ACCESS_PREFIX.length);
  if (token.startsWith(PREVIEW_REFRESH_PREFIX)) return token.slice(PREVIEW_REFRESH_PREFIX.length);
  return null;
}

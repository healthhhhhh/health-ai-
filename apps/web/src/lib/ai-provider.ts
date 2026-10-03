/**
 * How consent screens refer to whoever receives data for AI processing: "our AI
 * provider", followed by the company's name when the server reports it
 * (`/v1/meta` `ai.recipients`). Preview mode and older servers report none.
 * Used mid-sentence: "…to our AI provider, Anthropic, to answer you."
 */
export function aiProviderPhrase(recipients?: string[] | null): string {
  const names = (recipients ?? []).map((n) => n.trim()).filter(Boolean);
  if (!names.length) return "our AI provider";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `our AI ${names.length === 1 ? "provider" : "providers"}, ${list},`;
}

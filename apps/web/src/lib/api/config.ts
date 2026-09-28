/** HealthMate API base URL (server-side only; includes `/v1`). */
export function apiBaseUrl() {
  return (process.env.HEALTHMATE_API_URL ?? "http://localhost:4000/v1").replace(/\/$/, "");
}

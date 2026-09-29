/**
 * Preview controls: force any screen into a state without a backend.
 * Stored in a readable cookie so the floating Preview panel (client) and the
 * preview API (server) share it.
 */
export const PREVIEW_CONTROLS_COOKIE = "hm_preview_controls";

export const PREVIEW_STATES = ["normal", "loading", "slow", "empty", "error", "offline", "permission"] as const;
export type PreviewState = (typeof PREVIEW_STATES)[number];

export interface PreviewControls {
  state: PreviewState;
}

export const DEFAULT_CONTROLS: PreviewControls = { state: "normal" };

export const PREVIEW_STATE_LABELS: Record<PreviewState, { label: string; description: string }> = {
  normal: { label: "Normal", description: "Sample account with realistic data" },
  loading: { label: "Loading", description: "Every request takes 3 seconds" },
  slow: { label: "Slow network", description: "Every request takes about a second" },
  empty: { label: "Empty", description: "A new account with nothing added yet" },
  error: { label: "Server error", description: "Requests fail with a server error" },
  offline: { label: "Offline", description: "The app can't reach HealthMate" },
  permission: { label: "Permissions off", description: "Consents and Apple Health are turned off" },
};

export function parseControls(raw: string | undefined): PreviewControls {
  if (!raw) return DEFAULT_CONTROLS;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<PreviewControls>;
    return { state: PREVIEW_STATES.includes(value.state as PreviewState) ? (value.state as PreviewState) : "normal" };
  } catch {
    return DEFAULT_CONTROLS;
  }
}

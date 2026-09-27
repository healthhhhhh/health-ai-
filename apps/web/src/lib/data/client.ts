import type { HomeSummary, Mood, MoodCheckIn, PlanTask, UserProfile } from "@healthmate/shared-types";

export interface ShellContext {
  user: UserProfile;
  unreadNotifications: number;
}

/**
 * The web app's view of the shared HealthMate API. UI code depends on this
 * interface only; `getDataClient()` picks the implementation.
 */
export interface HealthMateClient {
  readonly isSampleData: boolean;
  getShellContext(): Promise<ShellContext>;
  getHomeSummary(): Promise<HomeSummary>;
  setTaskCompleted(taskId: string, completed: boolean): Promise<PlanTask>;
  recordMood(mood: Mood): Promise<MoodCheckIn>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

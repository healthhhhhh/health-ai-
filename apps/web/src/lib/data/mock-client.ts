import type { HomeSummary, Mood, MoodCheckIn, PlanTask } from "@healthmate/shared-types";
import type { HealthMateClient, ShellContext } from "./client";
import { ApiError } from "./client";
import { buildSampleHomeSummary } from "./sample-data";

/**
 * In-memory client backed by sample data. Used until the backend exists.
 * Every value it returns is tagged `source: "sample"` so the UI can label it.
 */
export class MockHealthMateClient implements HealthMateClient {
  readonly isSampleData = true;
  private summary: HomeSummary;

  constructor(now: () => Date = () => new Date()) {
    this.summary = buildSampleHomeSummary(now());
  }

  async getShellContext(): Promise<ShellContext> {
    return { user: { ...this.summary.user }, unreadNotifications: this.summary.unreadNotifications };
  }

  async getHomeSummary(): Promise<HomeSummary> {
    return structuredClone(this.summary);
  }

  async setTaskCompleted(taskId: string, completed: boolean): Promise<PlanTask> {
    const task = this.summary.tasks.find((t) => t.id === taskId);
    if (!task) throw new ApiError(`Task ${taskId} not found`, 404);
    task.completed = completed;
    return { ...task };
  }

  async recordMood(mood: Mood): Promise<MoodCheckIn> {
    const checkIn = { mood, recordedAt: new Date().toISOString() };
    this.summary.todayMood = checkIn;
    return checkIn;
  }
}

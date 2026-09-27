import type { HomeSummary, Mood, MoodCheckIn, PlanTask } from "@healthmate/shared-types";
import { ApiError, type HealthMateClient, type ShellContext } from "./client";

/**
 * Client for the shared HealthMate REST API (NestJS, see docs/architecture.md).
 * Endpoints follow the spec's API groups; auth (Phase 2) will attach a session
 * token here. No provider/model keys ever live in the web app.
 */
export class HttpHealthMateClient implements HealthMateClient {
  readonly isSampleData = false;

  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
        credentials: "include",
        cache: "no-store",
      });
    } catch {
      throw new ApiError("We couldn't reach HealthMate. Check your connection and try again.");
    }
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return (await res.json()) as T;
  }

  getShellContext() {
    return this.request<ShellContext>("/me/shell");
  }

  getHomeSummary() {
    return this.request<HomeSummary>("/me/home-summary");
  }

  setTaskCompleted(taskId: string, completed: boolean) {
    return this.request<PlanTask>(`/tasks/${encodeURIComponent(taskId)}/${completed ? "complete" : "uncomplete"}`, { method: "POST" });
  }

  recordMood(mood: Mood) {
    return this.request<MoodCheckIn>("/check-ins/mood", { method: "POST", body: JSON.stringify({ mood }) });
  }
}

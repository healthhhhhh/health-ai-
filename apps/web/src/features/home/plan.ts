import type { PlanTask } from "@healthmate/shared-types";

export function planProgress(tasks: PlanTask[]) {
  const done = tasks.filter((t) => t.completed).length;
  return { done, total: tasks.length, ratio: tasks.length ? done / tasks.length : 0 };
}

/** Provenance shown next to a task — medication tasks always say where the instruction came from. */
export function sourceLabel(task: PlanTask): string | undefined {
  switch (task.source) {
    case "clinician_provided":
      return "From your clinician";
    case "user_reported":
      return "Added by you";
    case "sample":
      return task.category === "medication" ? "Sample task" : undefined;
    default:
      return undefined;
  }
}

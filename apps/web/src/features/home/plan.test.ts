import type { PlanTask } from "@healthmate/shared-types";
import { planProgress, sourceLabel } from "./plan";

const task = (over: Partial<PlanTask>): PlanTask => ({ id: "x", title: "t", category: "other", scheduledTime: "08:00", completed: false, source: "user_reported", ...over });

describe("planProgress", () => {
  it("counts completed tasks", () => {
    expect(planProgress([task({ completed: true }), task({}), task({ completed: true })])).toEqual({ done: 2, total: 3, ratio: 2 / 3 });
  });
  it("handles an empty plan", () => {
    expect(planProgress([])).toEqual({ done: 0, total: 0, ratio: 0 });
  });
});

describe("sourceLabel", () => {
  it("shows provenance", () => {
    expect(sourceLabel(task({ source: "clinician_provided" }))).toBe("From your clinician");
    expect(sourceLabel(task({ source: "user_reported" }))).toBe("Added by you");
    expect(sourceLabel(task({ source: "sample", category: "medication" }))).toBe("Sample task");
  });
});

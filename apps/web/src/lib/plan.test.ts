import type { PlanItemRecord } from "@healthmate/shared-types";
import { describe, expect, it } from "vitest";
import { describeRepeat, itemHistory, occurs, tasksForDay, weekday, withCompletion } from "./plan";

const item = (overrides: Partial<PlanItemRecord> = {}): PlanItemRecord => ({
  id: "a",
  title: "Walk",
  notes: "30 minutes",
  kind: "habit",
  time: "19:00",
  repeat: { type: "daily" },
  reminderEnabled: true,
  source: "user_reported",
  instruction: null,
  startDay: "2026-09-01",
  endDay: null,
  createdAt: "2026-09-01T00:00:00Z",
  ...overrides,
});

describe("plan schedule", () => {
  it("uses the iOS weekday numbering", () => {
    expect(weekday("2026-09-27")).toBe(1); // Sunday
    expect(weekday("2026-10-03")).toBe(7); // Saturday
  });

  it("respects start, end and repeat rules", () => {
    expect(occurs(item(), "2026-08-31")).toBe(false);
    expect(occurs(item({ endDay: "2026-09-10" }), "2026-09-11")).toBe(false);
    expect(occurs(item({ repeat: { type: "weekdays", days: [2, 4] } }), "2026-09-28")).toBe(true); // Monday
    expect(occurs(item({ repeat: { type: "weekdays", days: [2, 4] } }), "2026-09-29")).toBe(false);
    expect(occurs(item({ repeat: { type: "once", day: "2026-09-28" } }), "2026-09-29")).toBe(false);
  });

  it("shows medication instructions verbatim as the task detail", () => {
    const med = item({ id: "m", kind: "medication", title: "Metformin", notes: null, instruction: "1 tablet after breakfast", time: "08:00", source: "clinician_provided" });
    const tasks = tasksForDay({ items: [item(), med], completions: [{ itemId: "a", day: "2026-09-28", completedAt: "x" }] }, "2026-09-28");
    expect(tasks.map((t) => t.id)).toEqual(["m", "a"]);
    expect(tasks[0]).toMatchObject({ detail: "1 tablet after breakfast", category: "medication", source: "clinician_provided", completed: false });
    expect(tasks[1]?.completed).toBe(true);
  });

  it("toggles completions and refuses future days", () => {
    const done = withCompletion([], "a", "2026-09-28", true, "2026-09-28");
    expect(done).toHaveLength(1);
    expect(withCompletion(done, "a", "2026-09-28", false, "2026-09-28")).toEqual([]);
    expect(() => withCompletion([], "a", "2026-09-29", true, "2026-09-28")).toThrow();
  });
});

describe("plan item detail helpers", () => {
  const item = {
    id: "walk",
    title: "Walk",
    notes: null,
    kind: "habit" as const,
    time: "08:00",
    repeat: { type: "weekdays" as const, days: [2, 3, 4, 5, 6] },
    reminderEnabled: true,
    source: "user_reported" as const,
    instruction: null,
    startDay: "2026-09-01",
    endDay: null,
    createdAt: "2026-09-01T00:00:00Z",
  };

  it("describes repeats in words", () => {
    expect(describeRepeat({ type: "daily" })).toBe("Every day");
    expect(describeRepeat({ type: "weekdays", days: [6, 2, 3, 4, 5] })).toBe("Weekdays");
    expect(describeRepeat({ type: "weekdays", days: [7, 1] })).toBe("Weekends");
    expect(describeRepeat({ type: "weekdays", days: [2, 4, 6] })).toBe("Mon, Wed, Fri");
    expect(describeRepeat({ type: "once", day: "2026-10-01" })).toBe("Once, on Oct 1");
  });

  it("marks each recent day done, missed, due or not scheduled", () => {
    // 2026-09-27 is a Sunday; 2026-09-29 a Tuesday.
    const history = itemHistory({ completions: [{ itemId: "walk", day: "2026-09-28", completedAt: "x" }] }, item, "2026-09-29", 4);
    expect(history).toEqual([
      { day: "2026-09-26", status: "not_scheduled" },
      { day: "2026-09-27", status: "not_scheduled" },
      { day: "2026-09-28", status: "done" },
      { day: "2026-09-29", status: "due" },
    ]);
    expect(itemHistory({ completions: [] }, item, "2026-09-29", 2)[0]).toEqual({ day: "2026-09-28", status: "missed" });
  });
});

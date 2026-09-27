import type { HealthMetric } from "@healthmate/shared-types";
import { presentMetric, TREND_LABEL } from "./metrics";

const base = { recordedAt: "2026-09-27T10:00:00Z", source: "sample", trend: "in_usual_range" } as const;

describe("presentMetric", () => {
  it("formats sleep as a duration", () => {
    const p = presentMetric({ ...base, kind: "sleep", value: 432, unit: "min" });
    expect(p).toMatchObject({ label: "Sleep", value: "7h 12m", tone: "purple" });
  });

  it("shows steps progress against the user's goal", () => {
    const p = presentMetric({ ...base, kind: "steps", value: 6428, unit: "steps", goal: 10000 });
    expect(p.value).toBe("6,428");
    expect(p.context).toBe("64% of your goal");
  });

  it("keeps units for heart rate and compares to the user's own baseline", () => {
    const p = presentMetric({ ...base, kind: "heart_rate", value: 72, unit: "bpm" } as HealthMetric);
    expect(p).toMatchObject({ value: "72", unit: "bpm", context: "In your usual range" });
  });

  it("never uses clinical judgement words in trend copy", () => {
    for (const label of Object.values(TREND_LABEL)) {
      expect(label).not.toMatch(/normal|healthy|abnormal|diagnos/i);
    }
  });
});

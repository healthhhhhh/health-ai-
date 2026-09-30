import { describe, expect, it } from "vitest";
import { describeBasis } from "./ai-basis";

describe("describeBasis", () => {
  it("says in plain words what an answer used", () => {
    expect(describeBasis(undefined)).toBeNull();
    expect(describeBasis({ memories: [], usedProfile: false, healthMetrics: [] })).toBeNull();
    const memory = { id: "m", fact: "x", status: "user_reported" as const, temporalStatus: "current" as const, occurredOn: null };
    expect(describeBasis({ memories: [memory], usedProfile: false, healthMetrics: [] })).toBe("1 thing from your health memory");
    expect(describeBasis({ memories: [memory, { ...memory, id: "n" }], usedProfile: true, healthMetrics: ["sleep", "steps", "resting_heart_rate"] })).toBe(
      "2 things from your health memory, your health profile and your sleep, steps and resting heart rate data",
    );
    expect(describeBasis({ memories: [], usedProfile: false, healthMetrics: ["blood_pressure_systolic", "blood_pressure_diastolic"] })).toBe("your blood pressure data");
  });
});

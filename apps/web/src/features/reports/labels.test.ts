import { describe, expect, it } from "vitest";
import { findingFlag } from "./labels";

describe("report finding labels", () => {
  it("compare with the report's own range and never say normal or abnormal", () => {
    for (const flag of ["within_range", "high", "low", "abnormal", "not_stated"] as const) {
      const [, label] = findingFlag(flag);
      expect(label.toLowerCase()).not.toMatch(/\bnormal\b|abnormal|healthy/);
    }
  });
});

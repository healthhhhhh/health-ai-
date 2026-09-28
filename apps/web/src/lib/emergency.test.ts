import { describe, expect, it } from "vitest";
import { emergencyNumber, regionOf } from "./emergency";

describe("emergencyNumber", () => {
  it("matches the iOS table and falls back to 112", () => {
    expect(emergencyNumber("US")).toBe("911");
    expect(emergencyNumber("gb")).toBe("999");
    expect(emergencyNumber("SG")).toBe("995");
    expect(emergencyNumber("AU")).toBe("000");
    expect(emergencyNumber("IN")).toBe("112");
    expect(emergencyNumber(undefined)).toBe("112");
  });

  it("reads the region from a locale", () => {
    expect(regionOf("en-GB")).toBe("GB");
    expect(regionOf("not a locale")).toBeUndefined();
  });
});

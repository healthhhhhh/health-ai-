import { describe, expect, it } from "vitest";
import { fromDisplay, parseDisplayPrefs, toDisplay, unitFor } from "./display-prefs";

describe("display preferences", () => {
  it("parses the cookie defensively", () => {
    expect(parseDisplayPrefs(undefined)).toEqual({ theme: "system", units: "metric" });
    expect(parseDisplayPrefs("not json")).toEqual({ theme: "system", units: "metric" });
    expect(parseDisplayPrefs(encodeURIComponent(JSON.stringify({ theme: "dark", units: "imperial" })))).toEqual({ theme: "dark", units: "imperial" });
    expect(parseDisplayPrefs(encodeURIComponent(JSON.stringify({ theme: "purple" })))).toEqual({ theme: "system", units: "metric" });
  });

  it("converts weight only, and back again", () => {
    expect(toDisplay("weight", 72.4, "imperial")).toBeCloseTo(159.6, 1);
    expect(fromDisplay("weight", toDisplay("weight", 72.4, "imperial"), "imperial")).toBeCloseTo(72.4, 6);
    expect(toDisplay("steps", 8000, "imperial")).toBe(8000);
    expect(unitFor("weight", "imperial")).toBe("lb");
    expect(unitFor("heart_rate", "imperial", "bpm")).toBe("bpm");
  });
});

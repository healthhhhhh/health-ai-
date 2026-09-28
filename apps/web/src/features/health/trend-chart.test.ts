import { describe, expect, it } from "vitest";
import { niceMax } from "./trend-chart";

describe("niceMax", () => {
  it("rounds up to clean axis values", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(8123)).toBe(10000);
    expect(niceMax(1800)).toBe(2000);
    expect(niceMax(72)).toBe(100);
    expect(niceMax(430)).toBe(500);
  });
});

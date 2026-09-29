import { describe, expect, it } from "vitest";
import { chartDomain, niceMax } from "./trend-chart";

describe("niceMax", () => {
  it("rounds up to clean axis values", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(8123)).toBe(10000);
    expect(niceMax(1800)).toBe(2000);
    expect(niceMax(72)).toBe(100);
    expect(niceMax(430)).toBe(500);
  });
});

describe("chartDomain", () => {
  it("starts columns at zero", () => {
    expect(chartDomain([5400, 8123], "bar")).toEqual([0, 10000]);
  });
  it("zooms lines to the data so small changes are visible", () => {
    const [lo, hi] = chartDomain([72.1, 72.4, 72.8], "line");
    expect(lo).toBeGreaterThan(60);
    expect(hi).toBeLessThan(80);
    expect(lo).toBeLessThanOrEqual(72.1);
    expect(hi).toBeGreaterThanOrEqual(72.8);
  });
});

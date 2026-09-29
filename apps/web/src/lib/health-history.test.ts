import type { TrendResponse } from "@healthmate/shared-types";
import { describe, expect, it } from "vitest";
import { buildDailyHistory, compareWithUsual, groupByMonth } from "./health-history";

const trend = (kind: TrendResponse["kind"], points: [string, number][]): TrendResponse => ({
  kind,
  unit: "",
  points: points.map(([date, value]) => ({ date, value, min: value, max: value, count: 1 })),
  average: null,
  previousAverage: null,
});

describe("daily health history", () => {
  const history = buildDailyHistory({
    sleep: trend("sleep", [["2026-09-27", 440], ["2026-09-28", 358], ["2026-09-29", 452]]),
    steps: trend("steps", [["2026-09-28", 7168], ["2026-09-29", 8421]]),
    weight: trend("weight", [["2026-09-29", 72.4]]),
    heart_rate: null,
  });

  it("has one row per day, newest first, with each metric that day", () => {
    expect(history.map((d) => d.date)).toEqual(["2026-09-29", "2026-09-28", "2026-09-27"]);
    expect(history[0]!.values).toEqual({ sleep: 452, steps: 8421, weight: 72.4 });
    expect(history[2]!.values).toEqual({ sleep: 440 });
  });

  it("compares a day with the person's own usual, and needs enough earlier days", () => {
    const days = buildDailyHistory({
      sleep: trend("sleep", [["2026-09-20", 420], ["2026-09-21", 430], ["2026-09-22", 410], ["2026-09-23", 425], ["2026-09-24", 415], ["2026-09-25", 350], ["2026-09-26", 470]]),
    });
    expect(compareWithUsual(days, "2026-09-25", "sleep").comparison).toBe("below_usual");
    expect(compareWithUsual(days, "2026-09-26", "sleep")).toMatchObject({ comparison: "above_usual" });
    expect(compareWithUsual(days, "2026-09-22", "sleep").comparison).toBe("no_baseline");
    expect(compareWithUsual(days, "2026-09-26", "steps").comparison).toBe("no_baseline");
  });

  it("groups days by month", () => {
    const groups = groupByMonth(buildDailyHistory({ sleep: trend("sleep", [["2026-08-31", 400], ["2026-09-01", 410], ["2026-09-02", 420]]) }));
    expect(groups.map((g) => [g.month, g.days.length])).toEqual([["September 2026", 2], ["August 2026", 1]]);
  });
});

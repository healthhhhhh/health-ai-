import { describe, expect, it } from "vitest";
import { metricHref, safeInAppLink, timelineHref } from "./links";

describe("in-app links", () => {
  it("opens the right destination for each timeline entry", () => {
    expect(timelineHref({ eventType: "report", sourceId: "doc-1", payload: null })).toBe("/reports/doc-1");
    expect(timelineHref({ eventType: "image", sourceId: null, payload: null })).toBe("/reports");
    expect(timelineHref({ eventType: "chat", sourceId: "c1", payload: null })).toBe("/chat?c=c1");
    expect(timelineHref({ eventType: "appointment", sourceId: "a1", payload: null })).toBe("/care/appointments/a1");
    expect(timelineHref({ eventType: "measurement", sourceId: null, payload: { kind: "sleep" } })).toBe("/health/sleep");
    expect(timelineHref({ eventType: "measurement", sourceId: null, payload: { note: "x" } })).toBe("/health");
    expect(timelineHref({ eventType: "note", sourceId: null, payload: null })).toBe("/timeline");
  });

  it("maps Home metric kinds to a detail page only where one exists", () => {
    expect(metricHref("calories")).toBe("/health/active_energy");
    expect(metricHref("steps")).toBe("/health/steps");
    expect(metricHref("blood_pressure")).toBe("/health");
  });

  it("only follows notification links to screens the app has", () => {
    expect(safeInAppLink("/reports/abc-123")).toBe("/reports/abc-123");
    expect(safeInAppLink("/care/appointments/x1")).toBe("/care/appointments/x1");
    expect(safeInAppLink("/settings/account")).toBe("/settings/account");
    expect(safeInAppLink("https://example.com")).toBeNull();
    expect(safeInAppLink("//evil.example")).toBeNull();
    expect(safeInAppLink("/unknown")).toBeNull();
    expect(safeInAppLink(null)).toBeNull();
  });
});

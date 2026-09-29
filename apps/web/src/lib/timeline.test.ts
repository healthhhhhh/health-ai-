import { describe, expect, it } from "vitest";
import { entryDetails, isEditable, timelineFilter, TIMELINE_FILTERS } from "./timeline";

describe("timeline helpers", () => {
  it("has the same filters as iOS, and falls back to All", () => {
    expect(TIMELINE_FILTERS.map((f) => f.id)).toEqual(["all", "reports", "conversations", "symptoms", "medications", "readings", "appointments", "notes"]);
    expect(timelineFilter("reports").types).toEqual(["report", "image"]);
    expect(timelineFilter("nonsense").id).toBe("all");
  });

  it("only lets people edit what they added", () => {
    expect(isEditable({ sourceType: "user_entered", eventType: "note" })).toBe(true);
    expect(isEditable({ sourceType: "user_entered", eventType: "chat" })).toBe(false);
    expect(isEditable({ sourceType: "document", eventType: "report" })).toBe(false);
    expect(isEditable({ sourceType: "clinician", eventType: "appointment" })).toBe(false);
  });

  it("reads saved details", () => {
    expect(entryDetails({ payload: { details: "Passed after a minute" } })).toBe("Passed after a minute");
    expect(entryDetails({ payload: { severity: 3 } })).toBeNull();
    expect(entryDetails({ payload: null })).toBeNull();
  });
});

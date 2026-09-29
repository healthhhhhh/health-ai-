import type { AppointmentRecord } from "@healthmate/shared-types";
import { describe, expect, it } from "vitest";
import { parsePrep, serializePrep, splitAppointments, zonedIso, zonedParts } from "./care";

const appt = (id: string, startsAt: string, status: AppointmentRecord["status"] = "scheduled"): AppointmentRecord => ({
  id,
  title: id,
  careProviderId: null,
  providerName: null,
  startsAt,
  endsAt: null,
  location: null,
  mode: null,
  status,
  notes: null,
});

describe("care", () => {
  it("splits upcoming (soonest first) from past and cancelled (newest first)", () => {
    const now = new Date("2026-09-10T12:00:00Z");
    const { upcoming, past } = splitAppointments(
      [appt("later", "2026-09-20T09:00:00Z"), appt("soon", "2026-09-11T09:00:00Z"), appt("done", "2026-09-01T09:00:00Z"), appt("cancelled", "2026-09-15T09:00:00Z", "cancelled")],
      now,
    );
    expect(upcoming.map((a) => a.id)).toEqual(["soon", "later"]);
    expect(past.map((a) => a.id)).toEqual(["cancelled", "done"]);
  });

  it("keeps a questions checklist inside the notes and round-trips it", () => {
    const text = serializePrep("Bring medication list", [
      { text: "What should I expect?", done: false },
      { text: "Any results?", done: true },
    ]);
    expect(text).toBe("Bring medication list\n\nQuestions to ask:\n- [ ] What should I expect?\n- [x] Any results?");
    expect(parsePrep(text)).toEqual({ notes: "Bring medication list", questions: [{ text: "What should I expect?", done: false }, { text: "Any results?", done: true }] });
    expect(parsePrep("Just notes")).toEqual({ notes: "Just notes", questions: [] });
    expect(serializePrep("", [])).toBeNull();
  });

  it("converts wall-clock times in the person's time zone", () => {
    expect(zonedIso("2026-09-10", "10:30", "Europe/London")).toBe("2026-09-10T09:30:00.000Z");
    expect(zonedIso("2026-01-10", "10:30", "Europe/London")).toBe("2026-01-10T10:30:00.000Z");
    expect(zonedParts("2026-09-10T09:30:00.000Z", "Europe/London")).toEqual({ day: "2026-09-10", time: "10:30" });
  });
});

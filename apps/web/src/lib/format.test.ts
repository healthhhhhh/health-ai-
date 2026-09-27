import { dayPart, formatClockTime, formatDuration, formatRelative, greeting, hourInTimeZone } from "./format";

describe("greeting", () => {
  it.each([
    [5, "Good Morning, Alex"],
    [11, "Good Morning, Alex"],
    [12, "Good Afternoon, Alex"],
    [16, "Good Afternoon, Alex"],
    [17, "Good Evening, Alex"],
    [2, "Good Evening, Alex"],
  ])("hour %i → %s", (hour, expected) => {
    expect(greeting(hour, "Alex")).toBe(expected);
  });

  it("omits the name when missing", () => {
    expect(greeting(9)).toBe("Good Morning");
    expect(dayPart(23)).toBe("evening");
  });
});

describe("hourInTimeZone", () => {
  const date = new Date("2026-09-27T12:30:00Z");
  it("converts to the given zone", () => {
    expect(hourInTimeZone(date, "UTC")).toBe(12);
    expect(hourInTimeZone(date, "Asia/Kolkata")).toBe(18);
    expect(hourInTimeZone(date, "America/Los_Angeles")).toBe(5);
  });
  it("falls back to UTC for an invalid zone", () => {
    expect(hourInTimeZone(date, "Not/AZone")).toBe(12);
  });
});

describe("formatDuration", () => {
  it.each([
    [432, "7h 12m"],
    [45, "45m"],
    [120, "2h"],
    [0, "0m"],
    [-5, "0m"],
  ])("%i minutes → %s", (m, s) => expect(formatDuration(m)).toBe(s));
});

describe("formatClockTime", () => {
  it("formats 24h times", () => {
    expect(formatClockTime("08:00")).toBe("8:00 AM");
    expect(formatClockTime("22:30")).toBe("10:30 PM");
  });
  it("returns malformed input unchanged", () => {
    expect(formatClockTime("soon")).toBe("soon");
  });
});

describe("formatRelative", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  it("formats past and future", () => {
    expect(formatRelative("2026-09-27T11:59:45Z", now)).toBe("just now");
    expect(formatRelative("2026-09-27T11:30:00Z", now)).toBe("30 min ago");
    expect(formatRelative("2026-09-27T10:00:00Z", now)).toBe("2 hours ago");
    expect(formatRelative("2026-09-27T11:00:00Z", now)).toBe("1 hour ago");
    expect(formatRelative("2026-09-26T12:00:00Z", now)).toBe("yesterday");
    expect(formatRelative("2026-09-30T12:00:00Z", now)).toBe("in 3 days");
  });
});

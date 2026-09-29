import type { HealthKitConnection } from "@healthmate/shared-types";
import { describe, expect, it } from "vitest";
import { appleHealthState } from "./apple-health-status";

const now = new Date("2026-09-29T09:00:00Z");
const connection = (overrides: Partial<HealthKitConnection>): HealthKitConnection => ({
  status: "connected",
  deviceName: "iPhone",
  scopes: ["steps"],
  connectedAt: "2026-06-01T09:00:00Z",
  disconnectedAt: null,
  lastSyncAt: "2026-09-29T08:40:00Z",
  ...overrides,
});

describe("Apple Health connection state", () => {
  it("shows the sync permission first, then the connection", () => {
    expect(appleHealthState(connection({}), false, now)).toBe("permission");
    expect(appleHealthState(connection({}), true, now)).toBe("connected");
    expect(appleHealthState(connection({ status: "never_connected", lastSyncAt: null }), true, now)).toBe("never_connected");
    expect(appleHealthState(connection({ status: "disconnected" }), true, now)).toBe("disconnected");
    expect(appleHealthState(null, true, now)).toBe("unknown");
  });

  it("flags a connection that hasn't synced for a day and a half", () => {
    expect(appleHealthState(connection({ lastSyncAt: "2026-09-27T09:00:00Z" }), true, now)).toBe("stale");
    expect(appleHealthState(connection({ lastSyncAt: null }), true, now)).toBe("stale");
  });
});

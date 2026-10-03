import { afterEach, describe, expect, it, vi } from "vitest";
import { socialSignInAvailable } from "./social-sign-in";

describe("socialSignInAvailable", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("offers Apple and Google sign-in in Preview mode, where they work", () => {
    vi.stubEnv("HEALTHMATE_DATA_SOURCE", "preview");
    expect(socialSignInAvailable()).toBe(true);
  });

  it("hides them against a real server, which can't receive an ID token from the web app yet", () => {
    vi.stubEnv("HEALTHMATE_DATA_SOURCE", "api");
    expect(socialSignInAvailable()).toBe(false);
    vi.stubEnv("HEALTHMATE_DATA_SOURCE", "");
    vi.stubEnv("HEALTHMATE_API_URL", "https://api.example.com");
    expect(socialSignInAvailable()).toBe(false);
  });
});

import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
// In environments with a preinstalled Chromium (e.g. CI images), point Playwright at it.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const signedIn = { storageState: "e2e/.auth/demo.json" };

/**
 * End-to-end in Preview mode (Phase 1): the production web build with the
 * built-in sample account — no backend. Signed-in projects share one session.
 */
export default defineConfig({
  testDir: "./e2e",
  // Tests share one preview session, so run them serially.
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { executablePath },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 }, ...signedIn } },
    { name: "tablet", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 900, height: 1180 }, ...signedIn } },
    { name: "mobile", dependencies: ["setup"], use: { ...devices["Pixel 7"], ...signedIn } },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    port: PORT,
    env: { HEALTHMATE_DATA_SOURCE: "preview" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

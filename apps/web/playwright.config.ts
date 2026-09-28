import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
const API_PORT = Number(process.env.API_PORT ?? 4100);
// In environments with a preinstalled Chromium (e.g. CI images), point Playwright at it.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
const signedIn = { storageState: "e2e/.auth/demo.json" };

/**
 * End-to-end against the real API in demo mode (scripted AI answers, a
 * non-medical demo account) and the production web build.
 */
export default defineConfig({
  testDir: "./e2e",
  // Tests share the demo account, so run them serially.
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
  webServer: [
    {
      command: `npm run build -w @healthmate/safety && npm run build -w @healthmate/api && npm run demo -w @healthmate/api`,
      url: `http://localhost:${API_PORT}/v1/meta`,
      env: { PORT: String(API_PORT), NODE_ENV: "development", PUBLIC_BASE_URL: `http://localhost:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `npm run start -- -p ${PORT}`,
      port: PORT,
      env: { HEALTHMATE_API_URL: `http://localhost:${API_PORT}/v1` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

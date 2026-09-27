import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests (e2e/): the built game in real Chromium — boot, race,
 * pause, garage, settings, results, touch. Unit tests prove the logic
 * headless; these catch what only a browser shows (a renderer throw, a dead
 * button, a console error). Run with `npm run e2e` (builds first).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
      testIgnore: /touch\.spec\.ts/,
    },
    {
      name: "phone",
      use: { ...devices["Pixel 7"] },
      testMatch: /touch\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
});

import { defineConfig, devices } from "@playwright/test";

const previewPort = Number.parseInt(
  process.env["RARPG_PLAYWRIGHT_PORT"] ?? "4174",
  10,
);
if (
  !Number.isInteger(previewPort) ||
  previewPort < 1024 ||
  previewPort > 65_535
) {
  throw new Error("RARPG_PLAYWRIGHT_PORT must be an available TCP port.");
}
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: `./test-results/${previewPort}`,
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: previewUrl,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    {
      name: "edge",
      use: { ...devices["Desktop Edge"], channel: "msedge" },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], browserName: "firefox" },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], browserName: "webkit" },
    },
  ],
  webServer: {
    command: `npm run preview -- --strictPort --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});

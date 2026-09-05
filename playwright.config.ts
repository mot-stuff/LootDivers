import { createHash } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const configuredPort =
  process.env["RARPG_PLAYWRIGHT_PORT"] ??
  process.env["PLAYWRIGHT_PREVIEW_PORT"];
const worktreePortOffset =
  Number.parseInt(
    createHash("sha256").update(process.cwd()).digest("hex").slice(0, 8),
    16,
  ) % 10_000;
const previewPort =
  configuredPort === undefined
    ? 45_000 + worktreePortOffset
    : Number(configuredPort);

if (
  !Number.isSafeInteger(previewPort) ||
  previewPort < 1024 ||
  previewPort > 65_535
) {
  throw new Error(
    "RARPG_PLAYWRIGHT_PORT or PLAYWRIGHT_PREVIEW_PORT must be an available TCP port.",
  );
}

const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: `./test-results/${previewPort}`,
  fullyParallel: false,
  workers: 2,
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

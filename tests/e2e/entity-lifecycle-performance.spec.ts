import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

import { expect, test } from "@playwright/test";

const enabled = process.env["RARPG_PERFORMANCE_DIAGNOSTIC"] === "1";
const warmupSeconds = Number(
  process.env["RARPG_PERFORMANCE_WARMUP_SECONDS"] ?? "30",
);
const sampleSeconds = Number(
  process.env["RARPG_PERFORMANCE_SAMPLE_SECONDS"] ?? "120",
);

test.skip(!enabled, "Run through npm run timing:fixture.");
test.setTimeout((warmupSeconds + sampleSeconds + 30) * 1_000);

test("collects labeled P0-002 full-fixture diagnostics", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?automation=1&fullFixture=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-app-state",
    "ready",
    {
      timeout: 20_000,
    },
  );
  await page.waitForTimeout(warmupSeconds * 1_000);
  await page.evaluate(() => window.__RARPG_FIXTURE_TEST__?.beginSample());
  await page.waitForTimeout(sampleSeconds * 1_000);
  const summary = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.endSample(),
  );
  const raw = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.rawSamples(),
  );
  const diagnostics = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.diagnostics(),
  );
  const browser = await page.evaluate(() => {
    const context = document.querySelector("canvas")?.getContext("webgl2");
    const renderer: unknown =
      context?.getParameter(WebGL2RenderingContext.RENDERER) ?? null;
    return {
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: [window.innerWidth, window.innerHeight],
      webglRenderer: typeof renderer === "string" ? renderer : null,
    };
  });
  const build = await page.evaluate(() => ({
    commit: window.__RARPG_FIXTURE_TEST__?.buildCommit ?? "unavailable",
    dirty: window.__RARPG_FIXTURE_TEST__?.buildDirty ?? true,
  }));
  const report = {
    task: "TASK-P0-008",
    schema: "task-p0-008-browser-performance-v1",
    gateState: "INELIGIBLE",
    acceptanceClaim: false,
    reason:
      "Current hardware does not match the P0-002 four-core/8-GB/Intel-UHD-630/60-Hz reference tier.",
    protocol: {
      requestedWarmupSeconds: warmupSeconds,
      requestedSampleSeconds: sampleSeconds,
      strictWarmupSeconds: 30,
      strictSampleSeconds: 120,
      repetitionsCollected: 1,
      strictRepetitions: 5,
      freshBrowserProcessPerRepetition: false,
      deviations:
        warmupSeconds === 30 && sampleSeconds === 120
          ? ["Only one ineligible diagnostic repetition was collected."]
          : [
              "Diagnostic duration differs from the strict P0-002 protocol.",
              "Only one ineligible diagnostic repetition was collected.",
            ],
    },
    build,
    git: {
      head: git("rev-parse", "HEAD"),
      status: git("status", "--short"),
    },
    machine: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? null,
      logicalProcessors: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
    },
    browserName,
    browser,
    summary,
    diagnostics,
    raw,
    realSafari: "NOT RUN — hardware unavailable",
    capturedAtUtc: new Date().toISOString(),
  };
  const directory = "reports/TASK-P0-008";
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/local-browser-ineligible.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  expect(summary?.sampleCount).toBeGreaterThan(0);
  expect(
    diagnostics?.simulation?.projectAllocations.structuralAfterWarmup,
  ).toBe(0);
});

function git(...arguments_: string[]): string {
  try {
    return execFileSync("git", arguments_, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

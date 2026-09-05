import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";

import { expect, test } from "@playwright/test";

import type {
  FrameSampleSummary,
  SyntheticPresentationDiagnostics,
} from "../../src/adapters/phaser/synthetic-lifecycle-presentation";

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
  browser,
}) => {
  const startedAtUtc = new Date().toISOString();
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const responsesAtOrAbove400: string[] = [];
  const requestedPaths: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleMessages.push(message.text());
    }
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()}`);
  });
  page.on("request", (request) => {
    requestedPaths.push(new URL(request.url()).pathname);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      responsesAtOrAbove400.push(`${response.status()} ${response.url()}`);
    }
  });
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
  const browserDiagnostics = await page.evaluate(() => {
    const context = document.querySelector("canvas")?.getContext("webgl2");
    const debug = context?.getExtension("WEBGL_debug_renderer_info");
    return {
      userAgent: navigator.userAgent,
      dpr: window.devicePixelRatio,
      viewport: [window.innerWidth, window.innerHeight],
      hidden: document.hidden,
      focused: document.hasFocus(),
      webglRenderer:
        context === null || context === undefined
          ? null
          : String(
              context.getParameter(
                debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER,
              ),
            ),
      webglVendor:
        context === null || context === undefined
          ? null
          : String(
              context.getParameter(
                debug?.UNMASKED_VENDOR_WEBGL ?? context.VENDOR,
              ),
            ),
      webgl2: context !== null && context !== undefined,
    };
  });
  const build = await page.evaluate(() => ({
    commit: window.__RARPG_FIXTURE_TEST__?.buildCommit ?? "unavailable",
    dirty: window.__RARPG_FIXTURE_TEST__?.buildDirty ?? true,
  }));
  const expectedRequestPattern =
    /^\/(?:$|index\.html|assets\/index-[A-Za-z0-9_-]+\.(?:js|css)|assets\/technical-entities\.svg|zones\/technical-(?:isometric\.zone|navigation\.grid)\.json|fixture-icon\.svg)$/;
  const unexpectedRequests = requestedPaths.filter(
    (path) => !expectedRequestPattern.test(path),
  );
  const serviceWorkerControlled = await page.evaluate(
    () =>
      "serviceWorker" in navigator &&
      navigator.serviceWorker.controller !== null,
  );
  const softwareRenderer = /swiftshader|software/i.test(
    browserDiagnostics.webglRenderer ?? "",
  );
  const thresholdEvaluations = evaluateThresholds(summary, diagnostics, {
    errors:
      consoleMessages.length +
      pageErrors.length +
      failedRequests.length +
      responsesAtOrAbove400.length,
    unexpectedRequests: unexpectedRequests.length,
    serviceWorkerControlled,
    softwareRenderer,
    dpr: browserDiagnostics.dpr,
    viewport: browserDiagnostics.viewport,
    webgl2: browserDiagnostics.webgl2,
    buildDirty: build.dirty,
  });
  const report = {
    task: "TASK-P0-008",
    schema: "task-p0-008-browser-performance-v2",
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
    provenance: {
      testedImplementationCommit: build.commit,
      builtFromCleanImplementation: !build.dirty,
      evidenceCommit:
        "This report is committed in a follow-up evidence-only commit.",
      eligibility:
        "Commit provenance does not change this current-machine run from INELIGIBLE to PASS.",
    },
    git: {
      head: git("rev-parse", "HEAD"),
      status: git("status", "--short"),
      version: command("git", ["--version"]),
    },
    machine: {
      platform: os.platform(),
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? null,
      logicalProcessors: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      windowsCim: powershell(
        "$cpu=Get-CimInstance Win32_Processor;$cs=Get-CimInstance Win32_ComputerSystem;$gpu=Get-CimInstance Win32_VideoController;[pscustomobject]@{PhysicalCores=($cpu.NumberOfCores|Measure-Object -Sum).Sum;RAMBytes=$cs.TotalPhysicalMemory;GPU=($gpu.Name -join '; ');DriverVersion=($gpu.DriverVersion -join '; ')}|ConvertTo-Json -Compress",
      ),
      display: powershell(
        "Get-CimInstance Win32_VideoController|Select-Object Name,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate|ConvertTo-Json -Compress",
      ),
      powerScheme: command("powercfg", ["/getactivescheme"]),
      acPower: "NOT RUN — no reliable command-only AC sensor available",
      temperatures: "not measured",
      scalingEvidence: "NOT RUN — screenshot unavailable during automated run",
      eligibility: {
        physicalCpuCores: "FAIL — recorded 8, requires exactly 4",
        ram: "FAIL — recorded 32 GB, requires 8 GB",
        gpu: "FAIL — software/NVIDIA renderer, requires Intel UHD 630-class",
        display: "FAIL — recorded 74 Hz, requires 60 Hz",
        dpr: browserDiagnostics.dpr === 1 ? "PASS" : "FAIL",
      },
    },
    browserName,
    browser: {
      ...browserDiagnostics,
      productVersion: browser.version(),
      executablePath: "managed by Playwright; see install inventory",
      commandLineFlags: "NOT RUN — Playwright does not expose launched flags",
      disposableProfile: true,
      hardwareAcceleration: browserDiagnostics.webgl2 && !softwareRenderer,
    },
    tools: {
      node: process.version,
      npm: npmCommand(["--version"]),
      playwright: npmCommand(["exec", "playwright", "--", "--version"]),
      playwrightInstallInventory: npmCommand([
        "exec",
        "playwright",
        "--",
        "install",
        "--dry-run",
      ]),
    },
    environment: {
      networkAdapters: powershell(
        "Get-NetAdapter|Where-Object Status -eq 'Up'|Select-Object Name,InterfaceDescription,LinkSpeed|ConvertTo-Json -Compress",
      ),
      significantProcesses: powershell(
        "Get-Process|Where-Object {$_.CPU -gt 0 -or $_.WorkingSet64 -ge 100MB}|Sort-Object WorkingSet64 -Descending|Select-Object Name,Id,CPU,WorkingSet64|ConvertTo-Json -Compress",
      ),
      ambientTemperature: "not measured",
      controlledConditions:
        "INELIGIBLE diagnostic; strict reboot/idle/process/thermal controls not claimed",
    },
    artifact: {
      source: "exact local production dist over loopback HTTP",
      url: page.url(),
      serviceWorkerControlled,
      requestedPaths,
      unexpectedRequests,
    },
    summary,
    diagnostics,
    thresholdEvaluations,
    hypotheticalThresholdStatus: Object.values(thresholdEvaluations).every(
      (evaluation) => evaluation.status === "PASS",
    )
      ? "PASS"
      : "FAIL",
    errors: {
      consoleMessages,
      pageErrors,
      failedRequests,
      responsesAtOrAbove400,
    },
    raw,
    realSafari: "NOT RUN — hardware unavailable",
    contextLoss:
      "NOT RUN — repeatable context-loss matrix remains assigned to TASK-P0-012",
    startedAtUtc,
    endedAtUtc: new Date().toISOString(),
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
  expect(diagnostics?.visibility).toEqual({
    actors: { visible: 200, culled: 0 },
    projectiles: { visible: 500, culled: 0 },
    particles: { visible: 1_000, culled: 0 },
    loot: { visible: 100, culled: 0 },
  });
  expect(diagnostics?.stageTimings.simulation.sampleCount).toBe(
    summary?.simulationSteps,
  );
  expect(raw?.simulationMilliseconds).toHaveLength(
    summary?.simulationSteps ?? 0,
  );
  expect(raw?.spatialMilliseconds).toHaveLength(summary?.simulationSteps ?? 0);
  expect(raw?.pathfindingMilliseconds).toHaveLength(
    summary?.simulationSteps ?? 0,
  );
  expect(raw?.presentationMilliseconds.length).toBeGreaterThan(0);
  expect(raw?.renderSubmissionMilliseconds).toHaveLength(
    raw?.presentationMilliseconds.length ?? 0,
  );
  expect(raw?.combinedMilliseconds).toHaveLength(
    raw?.presentationMilliseconds.length ?? 0,
  );
});

function evaluateThresholds(
  summary: FrameSampleSummary | undefined,
  diagnostics: SyntheticPresentationDiagnostics | null | undefined,
  environment: {
    readonly errors: number;
    readonly unexpectedRequests: number;
    readonly serviceWorkerControlled: boolean;
    readonly softwareRenderer: boolean;
    readonly dpr: number;
    readonly viewport: readonly number[];
    readonly webgl2: boolean;
    readonly buildDirty: boolean;
  },
) {
  const simulation = diagnostics?.simulation;
  const steps = simulation?.simulationSteps ?? 0;
  const overRatio =
    summary === undefined || summary.sampleCount === 0
      ? Number.POSITIVE_INFINITY
      : summary.intervalsOver33_4Milliseconds / summary.sampleCount;
  const expectedWarmupSteps = Math.round(
    (summary?.warmupDurationMilliseconds ?? 0) * 0.06,
  );
  const expectedSampleSteps = Math.round(
    (summary?.durationMilliseconds ?? 0) * 0.06,
  );
  const stepTolerance = summary?.simulationStepTolerance ?? 6;
  const stageTimings = diagnostics?.stageTimings;
  return {
    repetitions: evaluation(false, 1, "5 fresh browser processes"),
    cleanBuild: evaluation(
      !environment.buildDirty,
      environment.buildDirty,
      "false",
    ),
    viewport: evaluation(
      environment.dpr === 1 &&
        environment.viewport[0] === 1920 &&
        environment.viewport[1] === 1080,
      { dpr: environment.dpr, viewport: environment.viewport },
      "1920x1080 DPR1",
    ),
    webgl2: evaluation(environment.webgl2, environment.webgl2, "true"),
    warmupSteps: evaluation(
      Math.abs((summary?.warmupSteps ?? -1) - expectedWarmupSteps) <=
        stepTolerance && (summary?.warmupDurationMilliseconds ?? 0) >= 30_000,
      summary?.warmupSteps,
      `${expectedWarmupSteps} ±${stepTolerance} for actual >=30s warmup`,
    ),
    sampleSteps: evaluation(
      Math.abs(summary?.simulationStepDelta ?? Infinity) <= stepTolerance,
      {
        actual: summary?.simulationSteps,
        expectedFromMeasuredDuration: expectedSampleSteps,
        delta: summary?.simulationStepDelta,
        tolerance: stepTolerance,
      },
      `measured-duration expectation ±${stepTolerance} steps (100ms maximum callback interval)`,
    ),
    sampleDuration: evaluation(
      (summary?.durationMilliseconds ?? 0) >= 118_000,
      summary?.durationMilliseconds,
      ">=118000ms",
    ),
    callbackCount: evaluation(
      (summary?.callbackCount ?? 0) >= 7_080,
      summary?.callbackCount,
      ">=7080",
    ),
    callbackAccounting: evaluation(
      Math.abs(
        (stageTimings?.presentation.sampleCount ?? -Infinity) -
          (summary?.callbackCount ?? Infinity),
      ) <= 1,
      {
        callbacks: summary?.callbackCount,
        presentationSamples: stageTimings?.presentation.sampleCount,
      },
      "presentation samples equal measured callbacks ±1",
    ),
    pooledFrameP95: evaluation(
      (summary?.p95FrameIntervalMilliseconds ?? Infinity) <= 18,
      summary?.p95FrameIntervalMilliseconds,
      "<=18ms",
    ),
    repetitionFrameP95: evaluation(
      (summary?.p95FrameIntervalMilliseconds ?? Infinity) <= 20,
      summary?.p95FrameIntervalMilliseconds,
      "<=20ms",
    ),
    pooledMainThreadP95: evaluation(
      (stageTimings?.combined.p95Milliseconds ?? Infinity) <= 16.7,
      stageTimings?.combined.p95Milliseconds,
      "<=16.7ms",
    ),
    repetitionMainThreadP95: evaluation(
      (stageTimings?.combined.p95Milliseconds ?? Infinity) <= 18,
      stageTimings?.combined.p95Milliseconds,
      "<=18ms",
    ),
    intervalsOver33_4: evaluation(overRatio <= 0.001, overRatio, "<=0.001"),
    maximumFrameInterval: evaluation(
      (summary?.maximumFrameIntervalMilliseconds ?? Infinity) <= 100,
      summary?.maximumFrameIntervalMilliseconds,
      "<=100ms",
    ),
    catchUpBound: evaluation(
      (summary?.maximumStepsPerCallback ?? Infinity) <= 5,
      summary?.maximumStepsPerCallback,
      "<=5",
    ),
    noDroppedTime: evaluation(
      (summary?.droppedMilliseconds ?? Infinity) === 0,
      summary?.droppedMilliseconds,
      "0ms",
    ),
    lifecycleStable: evaluation(
      summary?.invalidReasons.length === 0,
      summary?.invalidReasons ?? null,
      "no invalidation",
    ),
    populationExact: evaluation(
      simulation?.populations.actors === 200 &&
        simulation.populations.projectiles === 500 &&
        simulation.populations.cosmeticParticles === 1_000 &&
        simulation.populations.loot === 100 &&
        simulation.populations.total === 1_800,
      simulation?.populations ?? null,
      "200/500/1000/100",
    ),
    visiblePopulationExact: evaluation(
      diagnostics?.visibility.actors.visible === 200 &&
        diagnostics.visibility.projectiles.visible === 500 &&
        diagnostics.visibility.particles.visible === 1_000 &&
        diagnostics.visibility.loot.visible === 100 &&
        diagnostics.culled === 0,
      diagnostics?.visibility ?? null,
      "visible 200/500/1000/100 with zero contract-population culls",
    ),
    stageSamplesRetained: evaluation(
      stageTimings !== undefined &&
        stageTimings.simulation.sampleCount === summary?.simulationSteps &&
        stageTimings.spatial.sampleCount === summary.simulationSteps &&
        stageTimings.pathfinding.sampleCount === summary.simulationSteps &&
        stageTimings.presentation.sampleCount > 0 &&
        stageTimings.renderSubmission.sampleCount ===
          stageTimings.presentation.sampleCount &&
        stageTimings.combined.sampleCount ===
          stageTimings.presentation.sampleCount,
      stageTimings ?? null,
      "all six named stages sampled and retained",
    ),
    sampleCapacity: evaluation(
      (summary?.sampleOverflowCount ?? Infinity) === 0 &&
        (simulation?.timingSamples.overflowCount ?? Infinity) === 0,
      {
        frameOverflow: summary?.sampleOverflowCount,
        simulationOverflow: simulation?.timingSamples.overflowCount,
      },
      "zero bounded-buffer overflow",
    ),
    actorQueryRate: evaluation(
      simulation?.queries.actorRadius === steps * 200,
      simulation?.queries.actorRadius,
      `${steps * 200}`,
    ),
    projectileQueryRate: evaluation(
      simulation?.queries.projectileSweeps === steps * 500,
      simulation?.queries.projectileSweeps,
      `${steps * 500}`,
    ),
    pathRate: evaluation(
      simulation?.paths.requested === Math.ceil(steps / 3),
      simulation?.paths.requested,
      `${Math.ceil(steps / 3)}`,
    ),
    structuralAllocations: evaluation(
      simulation?.projectAllocations.structuralAfterWarmup === 0,
      simulation?.projectAllocations.structuralAfterWarmup,
      "0",
    ),
    poolFailures: evaluation(
      diagnostics !== null &&
        diagnostics !== undefined &&
        Object.values(diagnostics.pools).every(
          (pool) =>
            pool.exhaustionAttempts === 0 && pool.overflowAttempts === 0,
        ),
      diagnostics?.pools ?? null,
      "zero exhaustion/overflow",
    ),
    runtimeErrors: evaluation(
      environment.errors === 0,
      environment.errors,
      "0",
    ),
    unexpectedRequests: evaluation(
      environment.unexpectedRequests === 0,
      environment.unexpectedRequests,
      "0",
    ),
    serviceWorker: evaluation(
      !environment.serviceWorkerControlled,
      environment.serviceWorkerControlled,
      "false",
    ),
    hardwareRenderer: evaluation(
      !environment.softwareRenderer,
      environment.softwareRenderer,
      "software renderer false",
    ),
  };
}

function evaluation(passed: boolean, actual: unknown, threshold: string) {
  return { status: passed ? "PASS" : "FAIL", actual, threshold };
}

function git(...arguments_: string[]): string {
  return command("git", arguments_);
}

function command(executable: string, arguments_: string[]): string {
  try {
    return execFileSync(executable, arguments_, { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

function powershell(script: string): string {
  return command("powershell", ["-NoProfile", "-Command", script]);
}

function npmCommand(arguments_: string[]): string {
  const npmEntry = process.env["npm_execpath"];
  return npmEntry === undefined
    ? "unavailable"
    : command(process.execPath, [npmEntry, ...arguments_]);
}

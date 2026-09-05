import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { chromium } from "@playwright/test";
import { format as formatWithPrettier } from "prettier";

import { Mulberry32 } from "../src/core/random.ts";
import { NavigationGrid } from "../src/core/navigation-grid.ts";
import { BoundedAStar } from "../src/core/pathfinding.ts";
import { FairPathRequestScheduler } from "../src/core/path-scheduler.ts";
import { computeLocalSeparation } from "../src/core/separation.ts";
import { SpatialQueryBuffer, UniformSpatialHash } from "../src/core/spatial.ts";
import type { CompiledNavigationGridBundle } from "../src/world/contracts.ts";

const SEED = 0x5eed2008;
const REPETITIONS = 5;
const WARMUP_STEPS = 1_800;
const SAMPLE_STEPS = 7_200;
const AGENT_COUNT = 200;
const SEGMENT_QUERY_COUNT = 500;
const PATH_INTERVAL_STEPS = 3;
const PATH_EXPANSION_CAP = 2_048;

interface Agent {
  readonly id: number;
  readonly bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

interface Samples {
  readonly spatial: number[];
  readonly path: number[];
  readonly total: number[];
}

interface Outcome {
  candidateCount: number;
  pathRequests: number;
  pathExpansions: number;
  pathChecksum: number;
  pendingRequests: number;
  readonly pathStatuses: Record<
    "complete" | "no-path" | "budget-exhausted" | "invalid",
    number
  >;
}

interface AllocationContract {
  passed: boolean;
  queryBufferIdentityStable: boolean;
  queryBufferOverflows: number;
  bucketCreationsAfterWarmup: number;
  bucketCapacityGrowthsAfterWarmup: number;
  recordCellCapacityGrowthsAfterWarmup: number;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function statistics(samples: Samples): Record<string, number> {
  return {
    spatialP50: percentile(samples.spatial, 0.5),
    spatialP95: percentile(samples.spatial, 0.95),
    pathP50: percentile(samples.path, 0.5),
    pathP95: percentile(samples.path, 0.95),
    totalP50: percentile(samples.total, 0.5),
    totalP95: percentile(samples.total, 0.95),
    totalMaximum: Math.max(...samples.total),
  };
}

function git(...arguments_: string[]): string {
  try {
    return execFileSync("git", arguments_, {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
}

function command(
  executable: string,
  arguments_: readonly string[],
):
  | { readonly status: "available"; readonly output: string }
  | {
      readonly status: "unavailable";
      readonly error: string;
    } {
  try {
    return {
      status: "available",
      output: execFileSync(executable, arguments_, {
        cwd: process.cwd(),
        encoding: "utf8",
      }).trim(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function windowsMetadata(): unknown {
  const capture = command("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    String.raw`
$ErrorActionPreference = "Stop"
$os = Get-CimInstance Win32_OperatingSystem
$cpu = @(Get-CimInstance Win32_Processor)
$cs = Get-CimInstance Win32_ComputerSystem
$gpus = @(Get-CimInstance Win32_VideoController)
$browserCandidates = @(
  [pscustomobject]@{ Name = "Google Chrome"; Paths = @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") },
  [pscustomobject]@{ Name = "Microsoft Edge"; Paths = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") },
  [pscustomobject]@{ Name = "Mozilla Firefox"; Paths = @("C:\Program Files\Mozilla Firefox\firefox.exe", "C:\Program Files (x86)\Mozilla Firefox\firefox.exe") }
)
$browsers = @($browserCandidates | ForEach-Object {
  $candidate = $_
  $foundPath = @($candidate.Paths | Where-Object { Test-Path $_ } | Select-Object -First 1)
  if ($foundPath.Count -eq 1) {
    $version = (Get-Item $foundPath[0]).VersionInfo
    [pscustomobject]@{
      Name = $candidate.Name
      Found = $true
      Path = $foundPath[0]
      ProductVersion = $version.ProductVersion
      FileVersion = $version.FileVersion
      CheckedPaths = $candidate.Paths
    }
  } else {
    [pscustomobject]@{
      Name = $candidate.Name
      Found = $false
      Path = $null
      ProductVersion = $null
      FileVersion = $null
      CheckedPaths = $candidate.Paths
    }
  }
})
$power = (& powercfg /getactivescheme | Out-String).Trim()
$network = @(Get-NetAdapter | Where-Object Status -eq "Up" | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    InterfaceDescription = $_.InterfaceDescription
    LinkSpeed = $_.LinkSpeed
  }
})
$processes = @(Get-Process | Where-Object {
  ($null -ne $_.CPU -and $_.CPU -gt 0) -or $_.WorkingSet64 -ge 100MB
} | Sort-Object WorkingSet64 -Descending | ForEach-Object {
  [pscustomobject]@{
    Name = $_.Name
    Id = $_.Id
    CPUSeconds = $_.CPU
    WorkingSetBytes = $_.WorkingSet64
  }
})
[pscustomobject]@{
  TimestampUtc = (Get-Date).ToUniversalTime().ToString("o")
  ComputerName = $env:COMPUTERNAME
  Manufacturer = $cs.Manufacturer
  Model = $cs.Model
  OS = $os.Caption
  OSVersion = $os.Version
  OSBuild = $os.BuildNumber
  CPU = @($cpu | ForEach-Object { $_.Name })
  PhysicalCores = ($cpu.NumberOfCores | Measure-Object -Sum).Sum
  LogicalProcessors = ($cpu.NumberOfLogicalProcessors | Measure-Object -Sum).Sum
  RAMBytes = [uint64]$cs.TotalPhysicalMemory
  GPU = @($gpus | ForEach-Object {
    [pscustomobject]@{
      Name = $_.Name
      DriverVersion = $_.DriverVersion
      DriverDate = if ($null -eq $_.DriverDate) { $null } else { $_.DriverDate.ToString("yyyy-MM-dd") }
      CurrentHorizontalResolution = $_.CurrentHorizontalResolution
      CurrentVerticalResolution = $_.CurrentVerticalResolution
      CurrentRefreshRate = $_.CurrentRefreshRate
    }
  })
  PowerScheme = $power
  ACPower = if (@(Get-CimInstance Win32_Battery).Count -eq 0) { "unavailable-no-battery" } else { "battery-present-state-not-captured" }
  WindowsScalePercent = $null
  BrowserZoomPercent = $null
  AmbientTemperature = $null
  Network = $network
  Processes = $processes
  Browsers = $browsers
} | ConvertTo-Json -Depth 7 -Compress
`,
  ]);
  if (capture.status === "unavailable") {
    return capture;
  }
  try {
    return JSON.parse(capture.output) as unknown;
  } catch (error) {
    return {
      status: "unavailable",
      error: `Windows metadata was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      raw: capture.output,
    };
  }
}

async function browserProbe(): Promise<unknown> {
  try {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
      });
      return await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        const gl = canvas.getContext("webgl2");
        const debug = gl?.getExtension("WEBGL_debug_renderer_info");
        return {
          context:
            "Playwright Chromium headless diagnostic; not physical display evidence",
          userAgent: navigator.userAgent,
          devicePixelRatio: window.devicePixelRatio,
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          webgl2: gl !== null,
          renderer:
            gl === null
              ? null
              : debug == null
                ? String(gl.getParameter(gl.RENDERER))
                : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)),
          vendor:
            gl === null
              ? null
              : debug == null
                ? String(gl.getParameter(gl.VENDOR))
                : String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)),
        };
      });
    } finally {
      await browser.close();
    }
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function nearestWalkable(
  grid: NavigationGrid,
  initialX: number,
  initialY: number,
): readonly [number, number] {
  let x = initialX;
  let y = initialY;
  while (!grid.isWalkable(x, y, 0)) {
    x = (x + 1) % grid.width;
    if (x === 0) {
      y = (y + 1) % grid.height;
    }
  }
  return [x, y];
}

function runRepetition(navigation: CompiledNavigationGridBundle): {
  readonly outcome: Outcome;
  readonly samples: Samples;
  readonly allocationContract: AllocationContract;
  readonly startedAtUtc: string;
  readonly endedAtUtc: string;
} {
  const startedAtUtc = new Date().toISOString();
  const grid = new NavigationGrid(navigation);
  const random = new Mulberry32(SEED);
  const spatial = new UniformSpatialHash(96);
  const agents: Agent[] = [];
  const buffers = Array.from(
    { length: AGENT_COUNT },
    () => new SpatialQueryBuffer(64),
  );
  const bufferIdentities = buffers.map(({ records }) => records);
  const circleQueries = Array.from({ length: AGENT_COUNT }, () => ({
    x: 0,
    y: 0,
    radius: 96,
    elevation: 0,
  }));
  const segmentBuffer = new SpatialQueryBuffer(64);
  const segmentBufferIdentity = segmentBuffer.records;
  const segmentQuery = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    padding: 4,
    elevation: 0,
  };
  const separation = { x: 0, y: 0 };
  const worldWidth = navigation.width * navigation.cellSize;
  const worldHeight = navigation.height * navigation.cellSize;
  const samples: Samples = { spatial: [], path: [], total: [] };
  const outcome: Outcome = {
    candidateCount: 0,
    pathRequests: 0,
    pathExpansions: 0,
    pathChecksum: 0,
    pendingRequests: 0,
    pathStatuses: {
      complete: 0,
      "no-path": 0,
      "budget-exhausted": 0,
      invalid: 0,
    },
  };
  const beforeAllocation = {
    bucketCount: 0,
    bucketCreations: 0,
    bucketCapacityGrowths: 0,
    recordCellCapacityGrowths: 0,
    queryCount: 0,
  };
  const afterAllocation = { ...beforeAllocation };
  spatial.reserve(
    {
      minX: -96,
      minY: -96,
      maxX: worldWidth + 96,
      maxY: worldHeight + 96,
    },
    32,
  );
  let measuring = false;

  for (let id = 0; id < AGENT_COUNT; id += 1) {
    const agent = {
      id,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      x: random.nextFloat() * worldWidth,
      y: random.nextFloat() * worldHeight,
      velocityX: (random.nextFloat() - 0.5) * 40,
      velocityY: (random.nextFloat() - 0.5) * 40,
    };
    agent.bounds.minX = agent.x - 8;
    agent.bounds.minY = agent.y - 8;
    agent.bounds.maxX = agent.x + 8;
    agent.bounds.maxY = agent.y + 8;
    agents.push(agent);
    spatial.upsert(id, 0, agent.bounds);
  }

  const scheduler = new FairPathRequestScheduler(
    new BoundedAStar(grid),
    {
      onPathCompleted(request, result, pathBuffer) {
        if (!measuring) {
          return;
        }
        outcome.pathStatuses[result.status] += 1;
        outcome.pathExpansions += result.expansions;
        outcome.pathChecksum =
          (outcome.pathChecksum * 33 +
            request.requesterId +
            result.expansions +
            result.pathLength +
            Math.trunc(result.totalCost) +
            (pathBuffer.points.at(-1)?.x ?? 0)) >>>
          0;
      },
    },
    {
      queueCapacity: 32,
      perRequestExpansionCap: PATH_EXPANSION_CAP,
      maxRequestsPerTick: 1,
      maxExpansionsPerTick: PATH_EXPANSION_CAP,
    },
  );

  let requester = 0;
  const totalSteps = WARMUP_STEPS + SAMPLE_STEPS;
  for (let step = 0; step < totalSteps; step += 1) {
    measuring = step >= WARMUP_STEPS;
    if (step === WARMUP_STEPS) {
      spatial.writeAllocationDiagnostics(beforeAllocation);
    }
    const totalStart = performance.now();
    const spatialStart = totalStart;
    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      const buffer = buffers[index];
      const circleQuery = circleQueries[index];
      if (
        agent === undefined ||
        buffer === undefined ||
        circleQuery === undefined
      ) {
        throw new Error("Synthetic agent fixture invariant failed.");
      }
      const candidates = computeLocalSeparation(
        spatial,
        agent.id,
        agent.x,
        agent.y,
        0,
        96,
        12,
        circleQuery,
        buffer,
        separation,
      );
      if (measuring) {
        outcome.candidateCount += candidates;
      }
      agent.x =
        (agent.x + (agent.velocityX + separation.x) / 60 + worldWidth) %
        worldWidth;
      agent.y =
        (agent.y + (agent.velocityY + separation.y) / 60 + worldHeight) %
        worldHeight;
      agent.bounds.minX = agent.x - 8;
      agent.bounds.minY = agent.y - 8;
      agent.bounds.maxX = agent.x + 8;
      agent.bounds.maxY = agent.y + 8;
      spatial.upsert(agent.id, 0, agent.bounds);
    }
    for (let index = 0; index < SEGMENT_QUERY_COUNT; index += 1) {
      const phase = (step * SEGMENT_QUERY_COUNT + index) >>> 0;
      const startX = (phase * 17) % worldWidth;
      const startY = (phase * 29) % worldHeight;
      segmentQuery.startX = startX;
      segmentQuery.startY = startY;
      segmentQuery.endX = (startX + 80) % worldWidth;
      segmentQuery.endY = (startY + 48) % worldHeight;
      const candidates = spatial.querySegment(segmentQuery, segmentBuffer);
      if (measuring) {
        outcome.candidateCount += candidates;
      }
    }
    const spatialEnd = performance.now();

    const pathStart = spatialEnd;
    if (step % PATH_INTERVAL_STEPS === 0) {
      const agent = agents[requester % agents.length];
      if (agent === undefined) {
        throw new Error("Synthetic path requester invariant failed.");
      }
      const [startX, startY] = nearestWalkable(
        grid,
        Math.min(grid.width - 1, Math.floor(agent.x / navigation.cellSize)),
        Math.min(grid.height - 1, Math.floor(agent.y / navigation.cellSize)),
      );
      const [goalX, goalY] = nearestWalkable(
        grid,
        (requester * 37 + 19) % grid.width,
        (requester * 53 + 23) % grid.height,
      );
      const rejection = scheduler.request({
        requesterId: agent.id,
        start: { x: startX, y: startY, elevation: 0 },
        goal: { x: goalX, y: goalY, elevation: 0 },
      });
      if (rejection !== undefined) {
        throw new Error(`Synthetic path request rejected: ${rejection}.`);
      }
      if (measuring) {
        outcome.pathRequests += 1;
      }
      requester += 1;
    }
    scheduler.processTick();
    const pathEnd = performance.now();
    if (measuring) {
      samples.spatial.push(spatialEnd - spatialStart);
      samples.path.push(pathEnd - pathStart);
      samples.total.push(pathEnd - totalStart);
    }
  }
  outcome.pendingRequests = scheduler.pendingCount;
  spatial.writeAllocationDiagnostics(afterAllocation);
  const queryBufferIdentityStable =
    segmentBuffer.records === segmentBufferIdentity &&
    buffers.every(
      (buffer, index) => buffer.records === bufferIdentities[index],
    );
  const queryBufferOverflows =
    segmentBuffer.overflowCount +
    buffers.reduce((total, buffer) => total + buffer.overflowCount, 0);
  const allocationContract = {
    passed: false,
    queryBufferIdentityStable,
    queryBufferOverflows,
    bucketCreationsAfterWarmup:
      afterAllocation.bucketCreations - beforeAllocation.bucketCreations,
    bucketCapacityGrowthsAfterWarmup:
      afterAllocation.bucketCapacityGrowths -
      beforeAllocation.bucketCapacityGrowths,
    recordCellCapacityGrowthsAfterWarmup:
      afterAllocation.recordCellCapacityGrowths -
      beforeAllocation.recordCellCapacityGrowths,
  };
  allocationContract.passed =
    allocationContract.queryBufferIdentityStable &&
    allocationContract.queryBufferOverflows === 0 &&
    allocationContract.bucketCreationsAfterWarmup === 0 &&
    allocationContract.bucketCapacityGrowthsAfterWarmup === 0 &&
    allocationContract.recordCellCapacityGrowthsAfterWarmup === 0;
  return {
    outcome,
    samples,
    allocationContract,
    startedAtUtc,
    endedAtUtc: new Date().toISOString(),
  };
}

const navigationPath = path.join(
  process.cwd(),
  "public",
  "zones",
  "technical-navigation.grid.json",
);
const navigation = JSON.parse(
  await readFile(navigationPath, "utf8"),
) as CompiledNavigationGridBundle;
const sourceCommit = git("rev-parse", "HEAD");
const sourceDirtyState = git("status", "--short");
const startUtc = new Date().toISOString();
const capturedWindowsMetadata = windowsMetadata();
const capturedBrowserProbe = await browserProbe();
const playwrightPackage = JSON.parse(
  await readFile(
    path.resolve("node_modules", "@playwright", "test", "package.json"),
    "utf8",
  ),
) as { readonly version?: unknown };
const toolMetadata = {
  git: command("git", ["--version"]),
  node: process.version,
  npm: command("cmd.exe", ["/d", "/s", "/c", "npm --version"]),
  playwrightPackageVersion:
    typeof playwrightPackage.version === "string"
      ? playwrightPackage.version
      : null,
  playwrightCli: command("cmd.exe", [
    "/d",
    "/s",
    "/c",
    "npm exec playwright -- --version",
  ]),
  playwrightInstallDryRun: command("cmd.exe", [
    "/d",
    "/s",
    "/c",
    "npm exec playwright -- install --dry-run",
  ]),
};
const repetitions = Array.from({ length: REPETITIONS }, () =>
  runRepetition(navigation),
);
const pooled: Samples = { spatial: [], path: [], total: [] };
for (const repetition of repetitions) {
  pooled.spatial.push(...repetition.samples.spatial);
  pooled.path.push(...repetition.samples.path);
  pooled.total.push(...repetition.samples.total);
}
const deterministicOutcomes = repetitions.map(({ outcome }) =>
  JSON.stringify(outcome),
);
const rawOutputArgument = process.argv.find((argument) =>
  argument.startsWith("--raw-output="),
);
let rawSampleArtifact:
  | {
      readonly status: "written";
      readonly path: string;
      readonly sha256: string;
      readonly bytes: number;
      readonly samplesPerStage: number;
    }
  | {
      readonly status: "NOT RUN";
      readonly reason: string;
    };
if (rawOutputArgument === undefined) {
  rawSampleArtifact = {
    status: "NOT RUN",
    reason: "No --raw-output path was requested.",
  };
} else {
  const rawPath = path.resolve(rawOutputArgument.slice("--raw-output=".length));
  const rawJson = await formatWithPrettier(
    JSON.stringify({
      schemaVersion: "1.0.0",
      task: "TASK-P0-007",
      sourceCommit,
      sourceDirtyState,
      seed: `0x${SEED.toString(16).toUpperCase()}`,
      repetitions: repetitions.map(
        ({ startedAtUtc, endedAtUtc, samples }, index) => ({
          repetition: index + 1,
          startedAtUtc,
          endedAtUtc,
          spatialMilliseconds: samples.spatial,
          pathMilliseconds: samples.path,
          totalMilliseconds: samples.total,
        }),
      ),
    }),
    { parser: "json" },
  );
  await writeFile(rawPath, rawJson, "utf8");
  rawSampleArtifact = {
    status: "written",
    path: path.relative(process.cwd(), rawPath).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(rawJson).digest("hex"),
    bytes: Buffer.byteLength(rawJson),
    samplesPerStage: REPETITIONS * SAMPLE_STEPS,
  };
}

const report = {
  schemaVersion: "1.0.0",
  task: "TASK-P0-007",
  gateState: "INELIGIBLE",
  acceptanceClaim: false,
  startUtc,
  endUtc: new Date().toISOString(),
  commit: sourceCommit,
  dirtyState: sourceDirtyState,
  seed: `0x${SEED.toString(16).toUpperCase()}`,
  fixture: {
    gridId: navigation.gridId,
    gridSourceHash: navigation.sourceHash,
    gridSize: [navigation.width, navigation.height],
    repetitions: REPETITIONS,
    warmupSteps: WARMUP_STEPS,
    sampleSteps: SAMPLE_STEPS,
    sampleSeconds: SAMPLE_STEPS / 60,
    agents: AGENT_COUNT,
    neighborRadius: 96,
    neighborQueriesPerStep: AGENT_COUNT,
    segmentQueriesPerStep: SEGMENT_QUERY_COUNT,
    pathRequestIntervalSteps: PATH_INTERVAL_STEPS,
    pathRequestsPerSecond: 60 / PATH_INTERVAL_STEPS,
    pathExpansionCap: PATH_EXPANSION_CAP,
  },
  machine: {
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    cpuModel: os.cpus()[0]?.model ?? "unavailable",
    logicalProcessors: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    node: process.version,
  },
  p0_002Metadata: {
    windows: capturedWindowsMetadata,
    headlessDisplayAndGraphicsProbe: capturedBrowserProbe,
    tools: toolMetadata,
    graphicsDiagnostics:
      "Branded chrome://gpu, edge://gpu, and Firefox about:support exports were unavailable to this command-line Node harness.",
    displayEvidence:
      "Windows scaling and browser zoom screenshots were not captured; null fields are not treated as zero.",
    thermal:
      "Ambient and CPU/GPU temperatures unavailable; no sensor capture was performed.",
  },
  ineligibleReasons: [
    "Current machine does not match the P0-002 four-core/8 GB/Intel UHD 630/60 Hz reference tier.",
    "This is a deterministic Node diagnostic harness, not the required target-browser acceptance sample.",
    "The local process environment was captured but not reduced to P0-002 controlled benchmark conditions.",
  ],
  determinismConfirmation: {
    outcomesMatched: deterministicOutcomes.every(
      (outcome) => outcome === deterministicOutcomes[0],
    ),
    outcome: repetitions[0]?.outcome,
  },
  allocationContract: {
    scope:
      "Project-authored spatial query, candidate collection, and local-separation storage after warm-up; excludes JS-engine internals and bounded A* path/request objects.",
    repetitions: repetitions.map(({ allocationContract }, index) => ({
      repetition: index + 1,
      ...allocationContract,
    })),
    allPassed: repetitions.every(
      ({ allocationContract }) => allocationContract.passed,
    ),
    jsHeapClaim: null,
  },
  repetitionTimingsMilliseconds: repetitions.map(({ samples }, index) => ({
    repetition: index + 1,
    startedAtUtc: repetitions[index]?.startedAtUtc ?? null,
    endedAtUtc: repetitions[index]?.endedAtUtc ?? null,
    ...statistics(samples),
  })),
  pooledTimingsMilliseconds: statistics(pooled),
  rawSampleArtifact,
  limitations: [
    "Node timings do not include Phaser presentation, browser rendering, requestAnimationFrame, GPU work, or browser GC behavior.",
    "TASK-P0-008 owns the complete P0-002 representative browser fixture and acceptance timing.",
    "Real Safari: NOT RUN — hardware unavailable.",
  ],
};

const outputArgument = process.argv.find((argument) =>
  argument.startsWith("--output="),
);
if (outputArgument !== undefined) {
  const outputPath = path.resolve(outputArgument.slice("--output=".length));
  await writeFile(
    outputPath,
    await formatWithPrettier(JSON.stringify(report), { parser: "json" }),
    "utf8",
  );
}
console.log(
  await formatWithPrettier(JSON.stringify(report), { parser: "json" }),
);

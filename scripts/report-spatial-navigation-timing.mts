import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

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
} {
  const grid = new NavigationGrid(navigation);
  const random = new Mulberry32(SEED);
  const spatial = new UniformSpatialHash(96);
  const agents: Agent[] = [];
  const buffers = Array.from(
    { length: AGENT_COUNT },
    () => new SpatialQueryBuffer(),
  );
  const segmentBuffer = new SpatialQueryBuffer();
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
  let measuring = false;

  for (let id = 0; id < AGENT_COUNT; id += 1) {
    const agent = {
      id,
      x: random.nextFloat() * worldWidth,
      y: random.nextFloat() * worldHeight,
      velocityX: (random.nextFloat() - 0.5) * 40,
      velocityY: (random.nextFloat() - 0.5) * 40,
    };
    agents.push(agent);
    spatial.upsert(id, 0, {
      minX: agent.x - 8,
      minY: agent.y - 8,
      maxX: agent.x + 8,
      maxY: agent.y + 8,
    });
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
    const totalStart = performance.now();
    const spatialStart = totalStart;
    for (let index = 0; index < agents.length; index += 1) {
      const agent = agents[index];
      const buffer = buffers[index];
      if (agent === undefined || buffer === undefined) {
        throw new Error("Synthetic agent fixture invariant failed.");
      }
      const candidates = computeLocalSeparation(
        spatial,
        agent.id,
        agent,
        0,
        96,
        12,
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
      spatial.upsert(agent.id, 0, {
        minX: agent.x - 8,
        minY: agent.y - 8,
        maxX: agent.x + 8,
        maxY: agent.y + 8,
      });
    }
    for (let index = 0; index < SEGMENT_QUERY_COUNT; index += 1) {
      const phase = (step * SEGMENT_QUERY_COUNT + index) >>> 0;
      const startX = (phase * 17) % worldWidth;
      const startY = (phase * 29) % worldHeight;
      const candidates = spatial.querySegment(
        {
          startX,
          startY,
          endX: (startX + 80) % worldWidth,
          endY: (startY + 48) % worldHeight,
        },
        4,
        0,
        segmentBuffer,
      );
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
  return { outcome, samples };
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

const report = {
  schemaVersion: "1.0.0",
  task: "TASK-P0-007",
  gateState: "INELIGIBLE",
  acceptanceClaim: false,
  timestampUtc: new Date().toISOString(),
  commit: git("rev-parse", "HEAD"),
  dirtyState: git("status", "--short"),
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
  ineligibleReasons: [
    "Current machine does not match the P0-002 four-core/8 GB/Intel UHD 630/60 Hz reference tier.",
    "This is a deterministic Node diagnostic harness, not the required target-browser acceptance sample.",
  ],
  determinismConfirmation: {
    outcomesMatched: deterministicOutcomes.every(
      (outcome) => outcome === deterministicOutcomes[0],
    ),
    outcome: repetitions[0]?.outcome,
  },
  repetitionTimingsMilliseconds: repetitions.map(({ samples }, index) => ({
    repetition: index + 1,
    ...statistics(samples),
  })),
  pooledTimingsMilliseconds: statistics(pooled),
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
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
console.log(JSON.stringify(report, null, 2));

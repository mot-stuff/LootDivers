import {
  PresentationKind,
  TECHNICAL_UPDATE_ORDER,
  TechnicalEntityLifecycle,
  type TechnicalUpdateStage,
} from "./entity-lifecycle";
import type { RuntimeEntityId } from "./ids";
import { type GridPoint, NavigationGrid } from "./navigation-grid";
import {
  FairPathRequestScheduler,
  type PathCompletionSink,
  type PathRequest,
} from "./path-scheduler";
import { BoundedAStar, type PathResult } from "./pathfinding";
import { Mulberry32 } from "./random";
import { computeLocalSeparation, type MutableVector2 } from "./separation";
import {
  SpatialQueryBuffer,
  UniformSpatialHash,
  type MutableCircleQuery,
  type MutableSegmentQuery,
  type SpatialAllocationDiagnostics,
} from "./spatial";

export const SYNTHETIC_FIXTURE_SEED = 0x5eed_2008;
export const SYNTHETIC_FIXTURE_SCHEMA = "task-p0-008-v1";
export const SYNTHETIC_ACTOR_COUNT = 200;
export const SYNTHETIC_PROJECTILE_COUNT = 500;
export const SYNTHETIC_PARTICLE_COUNT = 1_000;
export const SYNTHETIC_LOOT_COUNT = 100;
export const SYNTHETIC_ENTITY_COUNT =
  SYNTHETIC_ACTOR_COUNT +
  SYNTHETIC_PROJECTILE_COUNT +
  SYNTHETIC_PARTICLE_COUNT +
  SYNTHETIC_LOOT_COUNT;
export const SYNTHETIC_WORLD_SIZE = 128 * 32;
export const SYNTHETIC_CAMERA_WIDTH = 1920;
export const SYNTHETIC_CAMERA_HEIGHT = 1080;
export const FIXTURE_STAGE_SAMPLE_CAPACITY = 10_000;

const ACTOR_SPEED = 72;
const ACTOR_RADIUS = 10;
const ACTOR_QUERY_RADIUS = 96;
const PROJECTILE_PADDING = 5;
const WAYPOINTS_PER_ACTOR = 4;
const CAMERA_PATH_SECONDS = 30;

export interface FixtureStageTimings {
  readonly snapshot: number;
  readonly actors: number;
  readonly projectiles: number;
  readonly particles: number;
  readonly spatial: number;
  readonly pathfinding: number;
  readonly cleanup: number;
  readonly total: number;
}

export interface TimingSampleSummary {
  readonly sampleCount: number;
  readonly p95Milliseconds: number | null;
  readonly maximumMilliseconds: number | null;
}

export interface FixtureStageSampleSummary {
  readonly sampling: boolean;
  readonly capacity: number;
  readonly overflowCount: number;
  readonly simulation: TimingSampleSummary;
  readonly spatial: TimingSampleSummary;
  readonly pathfinding: TimingSampleSummary;
}

export interface RawFixtureStageSamples {
  readonly simulationMilliseconds: readonly number[];
  readonly spatialMilliseconds: readonly number[];
  readonly pathfindingMilliseconds: readonly number[];
}

export interface FixturePathDiagnostics {
  readonly requested: number;
  readonly completed: number;
  readonly noPath: number;
  readonly budgetExhausted: number;
  readonly invalid: number;
  readonly expansions: number;
}

export interface SyntheticFixtureDiagnostics {
  readonly schema: typeof SYNTHETIC_FIXTURE_SCHEMA;
  readonly seed: typeof SYNTHETIC_FIXTURE_SEED;
  readonly updateOrder: readonly TechnicalUpdateStage[];
  readonly simulationSteps: number;
  readonly cameraPhase: number;
  readonly populations: {
    readonly actors: number;
    readonly projectiles: number;
    readonly cosmeticParticles: number;
    readonly loot: number;
    readonly total: number;
  };
  readonly queries: {
    readonly actorRadius: number;
    readonly projectileSweeps: number;
    readonly actorCandidates: number;
    readonly projectileCandidates: number;
  };
  readonly paths: FixturePathDiagnostics;
  readonly spatialAllocations: SpatialAllocationDiagnostics;
  readonly projectAllocations: {
    readonly structuralAfterWarmup: number;
    readonly particleRecycles: number;
    readonly projectileWraps: number;
  };
  readonly timingSamples: FixtureStageSampleSummary;
  readonly lifecycle: ReturnType<TechnicalEntityLifecycle["diagnostics"]>;
}

export interface FixtureTimer {
  nowMilliseconds(): number;
}

interface MutablePathRequest {
  requesterId: number;
  start: GridPoint;
  goal: GridPoint;
}

interface MutableAabb {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface MutableFixtureStageSamples {
  sampling: boolean;
  count: number;
  overflowCount: number;
  simulation: Float64Array;
  spatial: Float64Array;
  pathfinding: Float64Array;
}

class FixturePathSink implements PathCompletionSink {
  completed = 0;
  noPath = 0;
  budgetExhausted = 0;
  invalid = 0;
  expansions = 0;

  public onPathCompleted(
    _request: PathRequest,
    result: Readonly<PathResult>,
  ): void {
    this.expansions += result.expansions;
    switch (result.status) {
      case "complete":
        this.completed += 1;
        break;
      case "no-path":
        this.noPath += 1;
        break;
      case "budget-exhausted":
        this.budgetExhausted += 1;
        break;
      case "invalid":
        this.invalid += 1;
        break;
    }
  }
}

export class SyntheticLifecycleFixture {
  readonly lifecycle = new TechnicalEntityLifecycle(SYNTHETIC_ENTITY_COUNT);
  readonly actorIds = new Uint32Array(SYNTHETIC_ACTOR_COUNT);
  readonly projectileIds = new Uint32Array(SYNTHETIC_PROJECTILE_COUNT);
  readonly particleIds = new Uint32Array(SYNTHETIC_PARTICLE_COUNT);
  readonly lootIds = new Uint32Array(SYNTHETIC_LOOT_COUNT);
  readonly actorDirections = new Uint8Array(SYNTHETIC_ACTOR_COUNT);
  readonly actorFrames = new Uint8Array(SYNTHETIC_ACTOR_COUNT);
  readonly particleAlpha = new Float32Array(SYNTHETIC_PARTICLE_COUNT);
  readonly #actorSeparationX = new Float32Array(SYNTHETIC_ACTOR_COUNT);
  readonly #actorSeparationY = new Float32Array(SYNTHETIC_ACTOR_COUNT);
  readonly #actorBounds: MutableAabb[] = Array.from(
    { length: SYNTHETIC_ACTOR_COUNT },
    () => ({ minX: 0, minY: 0, maxX: 0, maxY: 0 }),
  );
  readonly #actorWaypointsX = new Float32Array(
    SYNTHETIC_ACTOR_COUNT * WAYPOINTS_PER_ACTOR,
  );
  readonly #actorWaypointsY = new Float32Array(
    SYNTHETIC_ACTOR_COUNT * WAYPOINTS_PER_ACTOR,
  );
  readonly #actorWaypoint = new Uint8Array(SYNTHETIC_ACTOR_COUNT);
  readonly #projectileVelocityX = new Float32Array(SYNTHETIC_PROJECTILE_COUNT);
  readonly #projectileVelocityY = new Float32Array(SYNTHETIC_PROJECTILE_COUNT);
  readonly #particleVelocityX = new Float32Array(SYNTHETIC_PARTICLE_COUNT);
  readonly #particleVelocityY = new Float32Array(SYNTHETIC_PARTICLE_COUNT);
  readonly #particleLifetime = new Float32Array(SYNTHETIC_PARTICLE_COUNT);
  readonly #particleMaximumLifetime = new Float32Array(
    SYNTHETIC_PARTICLE_COUNT,
  );
  readonly #spatial = new UniformSpatialHash(64);
  readonly #actorQuery = new SpatialQueryBuffer(256);
  readonly #projectileQuery = new SpatialQueryBuffer(256);
  readonly #circleQuery: MutableCircleQuery = {
    x: 0,
    y: 0,
    radius: ACTOR_QUERY_RADIUS,
    elevation: 0,
  };
  readonly #segmentQuery: MutableSegmentQuery = {
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    padding: PROJECTILE_PADDING,
    elevation: 0,
  };
  readonly #separation: MutableVector2 = { x: 0, y: 0 };
  readonly #pathSink = new FixturePathSink();
  readonly #pathScheduler: FairPathRequestScheduler;
  readonly #pathRequests: MutablePathRequest[] = [];
  readonly #spatialDiagnostics: SpatialAllocationDiagnostics = {
    bucketCount: 0,
    bucketCreations: 0,
    bucketCapacityGrowths: 0,
    recordCellCapacityGrowths: 0,
    queryCount: 0,
  };
  readonly #timings: FixtureStageTimings = {
    snapshot: 0,
    actors: 0,
    projectiles: 0,
    particles: 0,
    spatial: 0,
    pathfinding: 0,
    cleanup: 0,
    total: 0,
  };
  readonly #timingSamples: MutableFixtureStageSamples = {
    sampling: false,
    count: 0,
    overflowCount: 0,
    simulation: new Float64Array(FIXTURE_STAGE_SAMPLE_CAPACITY),
    spatial: new Float64Array(FIXTURE_STAGE_SAMPLE_CAPACITY),
    pathfinding: new Float64Array(FIXTURE_STAGE_SAMPLE_CAPACITY),
  };
  readonly #timer: FixtureTimer | undefined;
  #simulationSteps = 0;
  #actorQueries = 0;
  #projectileQueries = 0;
  #actorCandidates = 0;
  #projectileCandidates = 0;
  #pathRequestsIssued = 0;
  #particleRecycles = 0;
  #projectileWraps = 0;
  #warmupStructuralAllocations = 0;

  public constructor(grid: NavigationGrid, timer?: FixtureTimer) {
    this.#timer = timer;
    const random = new Mulberry32(SYNTHETIC_FIXTURE_SEED);
    this.#spatial.reserve(
      {
        minX: -128,
        minY: -128,
        maxX: SYNTHETIC_WORLD_SIZE + 128,
        maxY: SYNTHETIC_WORLD_SIZE + 128,
      },
      32,
    );
    this.#spawnActors(random, grid);
    this.#spawnProjectiles(random);
    this.#spawnParticles(random);
    this.#spawnLoot(random);
    this.#pathScheduler = new FairPathRequestScheduler(
      new BoundedAStar(grid),
      this.#pathSink,
      {
        queueCapacity: SYNTHETIC_ACTOR_COUNT,
        perRequestExpansionCap: 2_048,
        maxRequestsPerTick: 1,
        maxExpansionsPerTick: 2_048,
      },
    );
    this.#rebuildSpatialIndex();
    this.#runActorQueries(false);
    this.#spatial.writeAllocationDiagnostics(this.#spatialDiagnostics);
    this.#warmupStructuralAllocations = this.#structuralAllocations();
    this.assertPopulations();
  }

  public step(deltaSeconds = 1 / 60): void {
    const totalStart = this.#now();
    let start = totalStart;
    this.lifecycle.transforms.snapshot();
    this.#writeTiming("snapshot", start);

    start = this.#now();
    this.#advanceActors(deltaSeconds);
    this.#writeTiming("actors", start);

    start = this.#now();
    this.#advanceProjectiles(deltaSeconds);
    this.#writeTiming("projectiles", start);

    start = this.#now();
    this.#advanceParticles(deltaSeconds);
    this.#writeTiming("particles", start);

    start = this.#now();
    this.#runSpatialQueries();
    this.#writeTiming("spatial", start);

    start = this.#now();
    this.#runPathRequest();
    this.#writeTiming("pathfinding", start);

    start = this.#now();
    this.lifecycle.flushCleanup();
    this.#writeTiming("cleanup", start);

    this.#simulationSteps += 1;
    this.#setTiming("total", this.#now() - totalStart);
    this.#recordTimingSample();
  }

  public cameraPosition(output: { x: number; y: number }): void {
    const phase = this.cameraPhase();
    const angle = phase * Math.PI * 2;
    const halfWidth = SYNTHETIC_CAMERA_WIDTH * 0.5;
    const halfHeight = SYNTHETIC_CAMERA_HEIGHT * 0.5;
    const rangeX = (SYNTHETIC_WORLD_SIZE - SYNTHETIC_CAMERA_WIDTH) * 0.48;
    const rangeY = (SYNTHETIC_WORLD_SIZE - SYNTHETIC_CAMERA_HEIGHT) * 0.48;
    output.x =
      halfWidth +
      rangeX +
      Math.cos(angle) * rangeX +
      Math.sin(angle * 2) * rangeX * 0.08;
    output.y = halfHeight + rangeY + Math.sin(angle) * rangeY;
  }

  public cameraPhase(): number {
    return (
      ((this.#simulationSteps / 60) % CAMERA_PATH_SECONDS) / CAMERA_PATH_SECONDS
    );
  }

  public markWarmupComplete(): void {
    this.#spatial.writeAllocationDiagnostics(this.#spatialDiagnostics);
    this.#warmupStructuralAllocations = this.#structuralAllocations();
  }

  public beginTimingSample(): void {
    this.#timingSamples.count = 0;
    this.#timingSamples.overflowCount = 0;
    this.#timingSamples.sampling = true;
  }

  public endTimingSample(): void {
    this.#timingSamples.sampling = false;
  }

  public rawTimingSamples(): RawFixtureStageSamples {
    return {
      simulationMilliseconds: Array.from(
        this.#timingSamples.simulation.subarray(0, this.#timingSamples.count),
      ),
      spatialMilliseconds: Array.from(
        this.#timingSamples.spatial.subarray(0, this.#timingSamples.count),
      ),
      pathfindingMilliseconds: Array.from(
        this.#timingSamples.pathfinding.subarray(0, this.#timingSamples.count),
      ),
    };
  }

  public assertNoStructuralAllocationsAfterWarmup(): void {
    this.#spatial.writeAllocationDiagnostics(this.#spatialDiagnostics);
    const allocationDelta =
      this.#structuralAllocations() - this.#warmupStructuralAllocations;
    if (allocationDelta !== 0) {
      throw new Error(
        `Fixture structural allocation contract failed with ${allocationDelta} post-warmup allocation(s).`,
      );
    }
  }

  public assertPopulations(): void {
    const diagnostics = this.lifecycle.diagnostics();
    if (
      diagnostics.liveEntities !== SYNTHETIC_ENTITY_COUNT ||
      this.actorIds.length !== SYNTHETIC_ACTOR_COUNT ||
      this.projectileIds.length !== SYNTHETIC_PROJECTILE_COUNT ||
      this.particleIds.length !== SYNTHETIC_PARTICLE_COUNT ||
      this.lootIds.length !== SYNTHETIC_LOOT_COUNT
    ) {
      throw new Error("Synthetic fixture population contract drifted.");
    }
  }

  public replaceActor(
    actor: number,
    onDestroyed?: (id: RuntimeEntityId) => void,
  ): {
    readonly destroyed: RuntimeEntityId;
    readonly created: RuntimeEntityId;
  } {
    if (
      !Number.isSafeInteger(actor) ||
      actor < 0 ||
      actor >= this.actorIds.length
    ) {
      throw new RangeError(
        "Technical actor slot is outside the fixed population.",
      );
    }
    const destroyed = this.actorIds[actor] as RuntimeEntityId;
    const transformIndex = this.lifecycle.transforms.indexOf(destroyed);
    if (transformIndex < 0) {
      throw new Error(`Technical actor ${destroyed} has no transform.`);
    }
    const transform = {
      x: this.lifecycle.transforms.x[transformIndex] ?? 0,
      y: this.lifecycle.transforms.y[transformIndex] ?? 0,
      elevation: this.lifecycle.transforms.elevation[transformIndex] ?? 0,
    };
    if (!this.lifecycle.requestDestroy(destroyed)) {
      throw new Error(`Technical actor ${destroyed} could not be destroyed.`);
    }
    this.lifecycle.flushCleanup((id) => {
      this.#spatial.remove(id);
      onDestroyed?.(id);
    });
    const created = this.lifecycle.create(
      transform,
      PresentationKind.Actor,
      actor % 4,
    );
    this.actorIds[actor] = created;
    const request = this.#pathRequests[actor];
    if (request === undefined) {
      throw new Error("Technical actor path request slot is missing.");
    }
    request.requesterId = created;
    this.#rebuildSpatialIndex();
    this.assertPopulations();
    return { destroyed, created };
  }

  public dispose(): void {
    this.#pathScheduler.clear();
    this.#spatial.clear();
    this.lifecycle.destroyAll();
  }

  public diagnostics(): SyntheticFixtureDiagnostics {
    this.#spatial.writeAllocationDiagnostics(this.#spatialDiagnostics);
    return {
      schema: SYNTHETIC_FIXTURE_SCHEMA,
      seed: SYNTHETIC_FIXTURE_SEED,
      updateOrder: TECHNICAL_UPDATE_ORDER,
      simulationSteps: this.#simulationSteps,
      cameraPhase: this.cameraPhase(),
      populations: {
        actors: this.actorIds.length,
        projectiles: this.projectileIds.length,
        cosmeticParticles: this.particleIds.length,
        loot: this.lootIds.length,
        total: this.lifecycle.diagnostics().liveEntities,
      },
      queries: {
        actorRadius: this.#actorQueries,
        projectileSweeps: this.#projectileQueries,
        actorCandidates: this.#actorCandidates,
        projectileCandidates: this.#projectileCandidates,
      },
      paths: {
        requested: this.#pathRequestsIssued,
        completed: this.#pathSink.completed,
        noPath: this.#pathSink.noPath,
        budgetExhausted: this.#pathSink.budgetExhausted,
        invalid: this.#pathSink.invalid,
        expansions: this.#pathSink.expansions,
      },
      spatialAllocations: { ...this.#spatialDiagnostics },
      projectAllocations: {
        structuralAfterWarmup:
          this.#structuralAllocations() - this.#warmupStructuralAllocations,
        particleRecycles: this.#particleRecycles,
        projectileWraps: this.#projectileWraps,
      },
      timingSamples: this.#timingSampleSummary(),
      lifecycle: this.lifecycle.diagnostics(),
    };
  }

  #spawnActors(random: Mulberry32, grid: NavigationGrid): void {
    for (let actor = 0; actor < SYNTHETIC_ACTOR_COUNT; actor += 1) {
      const gridX = (actor * 29 + random.nextInteger(31)) % grid.width;
      const gridY = (actor * 47 + random.nextInteger(31)) % grid.height;
      const x = gridX * 32 + 16;
      const y = gridY * 32 + 16;
      const id = this.lifecycle.create(
        { x, y, elevation: 0 },
        PresentationKind.Actor,
        actor % 4,
      );
      this.actorIds[actor] = id;
      for (let waypoint = 0; waypoint < WAYPOINTS_PER_ACTOR; waypoint += 1) {
        const index = actor * WAYPOINTS_PER_ACTOR + waypoint;
        const offsetX = waypoint === 0 || waypoint === 3 ? -48 : 48;
        const offsetY = waypoint < 2 ? -48 : 48;
        this.#actorWaypointsX[index] = clamp(
          x + offsetX + random.nextInteger(33) - 16,
          16,
          SYNTHETIC_WORLD_SIZE - 16,
        );
        this.#actorWaypointsY[index] = clamp(
          y + offsetY + random.nextInteger(33) - 16,
          16,
          SYNTHETIC_WORLD_SIZE - 16,
        );
      }
      const start = nearestWalkable(grid, gridX, gridY);
      const goal = nearestWalkable(
        grid,
        (gridX + 9 + actor) % grid.width,
        (gridY + 13 + actor * 3) % grid.height,
        start.elevation,
      );
      this.#pathRequests.push({ requesterId: id, start, goal });
    }
  }

  #spawnProjectiles(random: Mulberry32): void {
    for (
      let projectile = 0;
      projectile < SYNTHETIC_PROJECTILE_COUNT;
      projectile += 1
    ) {
      const angle = random.nextFloat() * Math.PI * 2;
      const speed = 180 + random.nextFloat() * 180;
      const id = this.lifecycle.create(
        {
          x: random.nextFloat() * SYNTHETIC_WORLD_SIZE,
          y: random.nextFloat() * SYNTHETIC_WORLD_SIZE,
          elevation: 0,
        },
        PresentationKind.Projectile,
        projectile % 4,
      );
      this.projectileIds[projectile] = id;
      this.#projectileVelocityX[projectile] = Math.cos(angle) * speed;
      this.#projectileVelocityY[projectile] = Math.sin(angle) * speed;
    }
  }

  #spawnParticles(random: Mulberry32): void {
    for (let particle = 0; particle < SYNTHETIC_PARTICLE_COUNT; particle += 1) {
      const lifetime = 0.75 + random.nextFloat() * 2.25;
      const id = this.lifecycle.create(
        {
          x: random.nextFloat() * SYNTHETIC_WORLD_SIZE,
          y: random.nextFloat() * SYNTHETIC_WORLD_SIZE,
          elevation: 0,
        },
        PresentationKind.CosmeticParticle,
        particle % 4,
      );
      this.particleIds[particle] = id;
      this.#particleVelocityX[particle] = random.nextFloat() * 36 - 18;
      this.#particleVelocityY[particle] = random.nextFloat() * 36 - 18;
      this.#particleLifetime[particle] = lifetime;
      this.#particleMaximumLifetime[particle] = lifetime;
      this.particleAlpha[particle] = 1;
    }
  }

  #spawnLoot(random: Mulberry32): void {
    for (let loot = 0; loot < SYNTHETIC_LOOT_COUNT; loot += 1) {
      const id = this.lifecycle.create(
        {
          x: ((loot * 53) % 127) * 32 + 16,
          y: ((loot * 79) % 127) * 32 + 16,
          elevation: 0,
        },
        PresentationKind.Loot,
        random.nextInteger(4),
      );
      this.lootIds[loot] = id;
    }
  }

  #advanceActors(deltaSeconds: number): void {
    const transforms = this.lifecycle.transforms;
    for (let actor = 0; actor < SYNTHETIC_ACTOR_COUNT; actor += 1) {
      const id = this.actorIds[actor] as RuntimeEntityId;
      const transformIndex = transforms.indexOf(id);
      if (transformIndex < 0) {
        throw new Error(`Technical actor ${id} has no transform.`);
      }
      const waypoint =
        actor * WAYPOINTS_PER_ACTOR + (this.#actorWaypoint[actor] ?? 0);
      const x = transforms.x[transformIndex] ?? 0;
      const y = transforms.y[transformIndex] ?? 0;
      const targetX = this.#actorWaypointsX[waypoint] ?? x;
      const targetY = this.#actorWaypointsY[waypoint] ?? y;
      let dx = targetX - x;
      let dy = targetY - y;
      const distance = Math.hypot(dx, dy);
      if (distance < 3) {
        this.#actorWaypoint[actor] =
          ((this.#actorWaypoint[actor] ?? 0) + 1) % WAYPOINTS_PER_ACTOR;
        continue;
      }
      dx /= distance;
      dy /= distance;
      const velocityX =
        (dx + (this.#actorSeparationX[actor] ?? 0)) * ACTOR_SPEED;
      const velocityY =
        (dy + (this.#actorSeparationY[actor] ?? 0)) * ACTOR_SPEED;
      transforms.x[transformIndex] = clamp(
        x + velocityX * deltaSeconds,
        8,
        SYNTHETIC_WORLD_SIZE - 8,
      );
      transforms.y[transformIndex] = clamp(
        y + velocityY * deltaSeconds,
        8,
        SYNTHETIC_WORLD_SIZE - 8,
      );
      this.actorDirections[actor] = directionFrame(velocityX, velocityY);
      this.actorFrames[actor] = Math.floor(this.#simulationSteps / 6) % 8;
    }
  }

  #advanceProjectiles(deltaSeconds: number): void {
    const transforms = this.lifecycle.transforms;
    for (
      let projectile = 0;
      projectile < SYNTHETIC_PROJECTILE_COUNT;
      projectile += 1
    ) {
      const id = this.projectileIds[projectile] as RuntimeEntityId;
      const index = transforms.indexOf(id);
      if (index < 0) {
        throw new Error(`Technical projectile ${id} has no transform.`);
      }
      let wrapped = false;
      let x =
        (transforms.x[index] ?? 0) +
        (this.#projectileVelocityX[projectile] ?? 0) * deltaSeconds;
      let y =
        (transforms.y[index] ?? 0) +
        (this.#projectileVelocityY[projectile] ?? 0) * deltaSeconds;
      if (x < 0) {
        x += SYNTHETIC_WORLD_SIZE;
        this.#projectileWraps += 1;
        wrapped = true;
      } else if (x >= SYNTHETIC_WORLD_SIZE) {
        x -= SYNTHETIC_WORLD_SIZE;
        this.#projectileWraps += 1;
        wrapped = true;
      }
      if (y < 0) {
        y += SYNTHETIC_WORLD_SIZE;
        this.#projectileWraps += 1;
        wrapped = true;
      } else if (y >= SYNTHETIC_WORLD_SIZE) {
        y -= SYNTHETIC_WORLD_SIZE;
        this.#projectileWraps += 1;
        wrapped = true;
      }
      transforms.x[index] = x;
      transforms.y[index] = y;
      if (wrapped) {
        transforms.previousX[index] = x;
        transforms.previousY[index] = y;
      }
    }
  }

  #advanceParticles(deltaSeconds: number): void {
    const transforms = this.lifecycle.transforms;
    for (let particle = 0; particle < SYNTHETIC_PARTICLE_COUNT; particle += 1) {
      const id = this.particleIds[particle] as RuntimeEntityId;
      const index = transforms.indexOf(id);
      if (index < 0) {
        throw new Error(`Technical particle ${id} has no transform.`);
      }
      let lifetime = (this.#particleLifetime[particle] ?? 0) - deltaSeconds;
      if (lifetime <= 0) {
        const maximum = this.#particleMaximumLifetime[particle] ?? 1;
        lifetime += maximum;
        transforms.x[index] =
          ((particle * 67 + this.#simulationSteps * 3) % 128) * 32 + 16;
        transforms.y[index] =
          ((particle * 97 + this.#simulationSteps * 5) % 128) * 32 + 16;
        transforms.previousX[index] = transforms.x[index] ?? 0;
        transforms.previousY[index] = transforms.y[index] ?? 0;
        this.#particleRecycles += 1;
      } else {
        transforms.x[index] = wrap(
          (transforms.x[index] ?? 0) +
            (this.#particleVelocityX[particle] ?? 0) * deltaSeconds,
        );
        transforms.y[index] = wrap(
          (transforms.y[index] ?? 0) +
            (this.#particleVelocityY[particle] ?? 0) * deltaSeconds,
        );
      }
      this.#particleLifetime[particle] = lifetime;
      this.particleAlpha[particle] =
        lifetime / (this.#particleMaximumLifetime[particle] ?? 1);
    }
  }

  #runSpatialQueries(): void {
    this.#rebuildSpatialIndex();
    this.#runActorQueries();
    const transforms = this.lifecycle.transforms;
    for (
      let projectile = 0;
      projectile < SYNTHETIC_PROJECTILE_COUNT;
      projectile += 1
    ) {
      const id = this.projectileIds[projectile] as RuntimeEntityId;
      const index = transforms.indexOf(id);
      if (index < 0) {
        throw new Error(`Technical projectile ${id} has no transform.`);
      }
      this.#segmentQuery.startX = transforms.previousX[index] ?? 0;
      this.#segmentQuery.startY = transforms.previousY[index] ?? 0;
      this.#segmentQuery.endX = transforms.x[index] ?? 0;
      this.#segmentQuery.endY = transforms.y[index] ?? 0;
      this.#spatial.querySegment(this.#segmentQuery, this.#projectileQuery);
      this.#projectileQueries += 1;
      this.#projectileCandidates += this.#projectileQuery.count;
    }
  }

  #runActorQueries(countDiagnostics = true): void {
    const transforms = this.lifecycle.transforms;
    for (let actor = 0; actor < SYNTHETIC_ACTOR_COUNT; actor += 1) {
      const id = this.actorIds[actor] as RuntimeEntityId;
      const index = transforms.indexOf(id);
      if (index < 0) {
        throw new Error(`Technical actor ${id} has no transform.`);
      }
      computeLocalSeparation(
        this.#spatial,
        id,
        transforms.x[index] ?? 0,
        transforms.y[index] ?? 0,
        0,
        ACTOR_QUERY_RADIUS,
        0.45,
        this.#circleQuery,
        this.#actorQuery,
        this.#separation,
      );
      this.#actorSeparationX[actor] = this.#separation.x;
      this.#actorSeparationY[actor] = this.#separation.y;
      if (countDiagnostics) {
        this.#actorQueries += 1;
        this.#actorCandidates += this.#actorQuery.count;
      }
    }
  }

  #rebuildSpatialIndex(): void {
    const transforms = this.lifecycle.transforms;
    for (let actor = 0; actor < SYNTHETIC_ACTOR_COUNT; actor += 1) {
      const id = this.actorIds[actor] as RuntimeEntityId;
      const index = transforms.indexOf(id);
      if (index < 0) {
        throw new Error(`Technical actor ${id} has no transform.`);
      }
      const x = transforms.x[index] ?? 0;
      const y = transforms.y[index] ?? 0;
      const bounds = this.#actorBounds[actor];
      if (bounds === undefined) {
        throw new Error("Technical actor bounds capacity drifted.");
      }
      bounds.minX = x - ACTOR_RADIUS;
      bounds.minY = y - ACTOR_RADIUS;
      bounds.maxX = x + ACTOR_RADIUS;
      bounds.maxY = y + ACTOR_RADIUS;
      this.#spatial.upsert(id, 0, bounds);
    }
  }

  #runPathRequest(): void {
    if (this.#simulationSteps % 3 === 0) {
      const requestIndex =
        Math.floor(this.#simulationSteps / 3) % SYNTHETIC_ACTOR_COUNT;
      const request = this.#pathRequests[requestIndex];
      if (request === undefined || this.#pathScheduler.request(request)) {
        throw new Error("Synthetic path request scheduler rejected work.");
      }
      this.#pathRequestsIssued += 1;
    }
    this.#pathScheduler.processTick();
  }

  #structuralAllocations(): number {
    return (
      this.#spatialDiagnostics.bucketCreations +
      this.#spatialDiagnostics.bucketCapacityGrowths +
      this.#spatialDiagnostics.recordCellCapacityGrowths
    );
  }

  #now(): number {
    return this.#timer?.nowMilliseconds() ?? 0;
  }

  #writeTiming(
    key: Exclude<keyof FixtureStageTimings, "total">,
    start: number,
  ) {
    this.#setTiming(key, this.#now() - start);
  }

  #setTiming(key: keyof FixtureStageTimings, value: number): void {
    (this.#timings as Record<keyof FixtureStageTimings, number>)[key] = value;
  }

  #recordTimingSample(): void {
    if (!this.#timingSamples.sampling) {
      return;
    }
    const index = this.#timingSamples.count;
    if (index >= this.#timingSamples.simulation.length) {
      this.#timingSamples.overflowCount += 1;
      return;
    }
    this.#timingSamples.simulation[index] = this.#timings.total;
    this.#timingSamples.spatial[index] = this.#timings.spatial;
    this.#timingSamples.pathfinding[index] = this.#timings.pathfinding;
    this.#timingSamples.count += 1;
  }

  #timingSampleSummary(): FixtureStageSampleSummary {
    return {
      sampling: this.#timingSamples.sampling,
      capacity: this.#timingSamples.simulation.length,
      overflowCount: this.#timingSamples.overflowCount,
      simulation: summarizeTimingSamples(
        this.#timingSamples.simulation,
        this.#timingSamples.count,
      ),
      spatial: summarizeTimingSamples(
        this.#timingSamples.spatial,
        this.#timingSamples.count,
      ),
      pathfinding: summarizeTimingSamples(
        this.#timingSamples.pathfinding,
        this.#timingSamples.count,
      ),
    };
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function wrap(value: number): number {
  if (value < 0) {
    return value + SYNTHETIC_WORLD_SIZE;
  }
  if (value >= SYNTHETIC_WORLD_SIZE) {
    return value - SYNTHETIC_WORLD_SIZE;
  }
  return value;
}

function directionFrame(x: number, y: number): number {
  if (Math.abs(x) >= Math.abs(y)) {
    return x >= 0 ? 1 : 3;
  }
  return y >= 0 ? 2 : 0;
}

function summarizeTimingSamples(
  values: Float64Array,
  count: number,
): TimingSampleSummary {
  let maximum: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const value = values[index] ?? 0;
    maximum = maximum === null ? value : Math.max(maximum, value);
  }
  return {
    sampleCount: count,
    p95Milliseconds: percentile95(values, count),
    maximumMilliseconds: maximum,
  };
}

function percentile95(values: Float64Array, count: number): number | null {
  if (count === 0) {
    return null;
  }
  const sorted = Array.from(values.subarray(0, count)).sort(
    (left, right) => left - right,
  );
  return sorted[Math.ceil(count * 0.95) - 1] ?? null;
}

function nearestWalkable(
  grid: NavigationGrid,
  startX: number,
  startY: number,
  requiredElevation?: number,
): GridPoint {
  for (let offset = 0; offset < grid.size; offset += 1) {
    const index = (startY * grid.width + startX + offset) % grid.size;
    const point = grid.pointAt(index);
    if (
      (requiredElevation === undefined ||
        point.elevation === requiredElevation) &&
      grid.isWalkable(point.x, point.y, point.elevation)
    ) {
      return point;
    }
  }
  throw new Error("Synthetic navigation grid contains no walkable cell.");
}

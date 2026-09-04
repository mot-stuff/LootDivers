import Phaser from "phaser";

import {
  FIXED_STEP_MILLISECONDS,
  NavigationGrid,
  SYNTHETIC_ACTOR_COUNT,
  SYNTHETIC_CAMERA_HEIGHT,
  SYNTHETIC_CAMERA_WIDTH,
  SYNTHETIC_ENTITY_COUNT,
  SYNTHETIC_LOOT_COUNT,
  SYNTHETIC_PARTICLE_COUNT,
  SYNTHETIC_PROJECTILE_COUNT,
  SyntheticLifecycleFixture,
  type RuntimeEntityId,
  type SyntheticFixtureDiagnostics,
} from "../../core";
import {
  NAVIGATION_GRID_VERSION,
  type CompiledNavigationGridBundle,
} from "../../world/contracts";

export const TECHNICAL_ENTITY_ATLAS = "fixture:technical-entity-atlas";
const NAVIGATION_URL = "/zones/technical-navigation.grid.json";
const MAP_TILES = 128;
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const ISO_ORIGIN_X = 4096;
const MAX_CATCH_UP_STEPS = 5;
const PRESENTATION_MARGIN = 96;

export interface PresentationPoolDiagnostics {
  readonly capacity: number;
  readonly active: number;
  readonly highWaterMark: number;
}

export interface SyntheticPresentationDiagnostics {
  readonly ready: boolean;
  readonly disposed: boolean;
  readonly atlasCount: number;
  readonly textureMemoryEstimateBytes: number;
  readonly presentationObjects: number;
  readonly visible: number;
  readonly culled: number;
  readonly terrainChunks: number;
  readonly foregroundCells: number;
  readonly listenerCount: number;
  readonly pools: {
    readonly actors: PresentationPoolDiagnostics;
    readonly projectiles: PresentationPoolDiagnostics;
    readonly particles: PresentationPoolDiagnostics;
    readonly loot: PresentationPoolDiagnostics;
  };
  readonly simulation: SyntheticFixtureDiagnostics | null;
  readonly frame: FrameSampleSummary;
  readonly jsHeapBytes: number | null;
  readonly drawCalls: number | null;
}

export interface FrameSampleSummary {
  readonly sampling: boolean;
  readonly sampleCount: number;
  readonly durationMilliseconds: number;
  readonly p95FrameIntervalMilliseconds: number | null;
  readonly p95MainThreadWorkMilliseconds: number | null;
  readonly intervalsOver33_4Milliseconds: number;
  readonly maximumFrameIntervalMilliseconds: number | null;
}

export interface RawFrameSamples {
  readonly frameIntervalsMilliseconds: readonly number[];
  readonly mainThreadWorkMilliseconds: readonly number[];
}

interface MutableFrameSamples {
  sampling: boolean;
  startedAt: number;
  endedAt: number;
  previousFrameAt: number;
  intervals: number[];
  mainThreadWork: number[];
}

export class SyntheticLifecyclePresentation {
  readonly #scene: Phaser.Scene;
  readonly #objects: Phaser.GameObjects.Image[] = [];
  readonly #actorObjects: Phaser.GameObjects.Image[] = [];
  readonly #projectileObjects: Phaser.GameObjects.Image[] = [];
  readonly #particleObjects: Phaser.GameObjects.Image[] = [];
  readonly #lootObjects: Phaser.GameObjects.Image[] = [];
  readonly #terrain: Phaser.GameObjects.Graphics[] = [];
  readonly #registry = new Map<RuntimeEntityId, Phaser.GameObjects.Image>();
  readonly #cameraPosition = { x: 0, y: 0 };
  readonly #samples: MutableFrameSamples = {
    sampling: false,
    startedAt: 0,
    endedAt: 0,
    previousFrameAt: 0,
    intervals: [],
    mainThreadWork: [],
  };
  #fixture: SyntheticLifecycleFixture | null = null;
  #accumulatorMilliseconds = 0;
  #ready = false;
  #disposed = false;
  #visible = 0;
  #culled = 0;
  #foregroundCells = 0;
  #listenerCount = 0;
  #visibilityHandler: (() => void) | null = null;
  #paused: boolean;

  public constructor(scene: Phaser.Scene, initiallyPaused = false) {
    this.#scene = scene;
    this.#paused = initiallyPaused;
  }

  public async create(): Promise<void> {
    if (this.#ready || this.#disposed) {
      throw new Error("Synthetic lifecycle presentation has invalid state.");
    }
    const response = await fetch(NAVIGATION_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Navigation request returned HTTP ${response.status}.`);
    }
    const data: unknown = await response.json();
    if (!isNavigationGrid(data)) {
      throw new Error("Synthetic navigation bundle is incompatible.");
    }
    await this.#loadAtlas();
    this.#registerAtlasFrames();
    this.#fixture = new SyntheticLifecycleFixture(new NavigationGrid(data), {
      nowMilliseconds: () => performance.now(),
    });
    this.#createTerrain();
    this.#createPools();
    this.#installVisibilityLifecycle();
    this.#fixture.assertPopulations();
    this.#ready = true;
  }

  public update(time: number, deltaMilliseconds: number): void {
    if (!this.#ready || this.#disposed || document.hidden || this.#paused) {
      return;
    }
    const workStart = performance.now();
    if (this.#samples.sampling) {
      if (this.#samples.previousFrameAt > 0) {
        this.#samples.intervals.push(time - this.#samples.previousFrameAt);
      }
      this.#samples.previousFrameAt = time;
    }
    this.#accumulatorMilliseconds += Math.min(
      deltaMilliseconds,
      FIXED_STEP_MILLISECONDS * MAX_CATCH_UP_STEPS,
    );
    let steps = 0;
    while (
      this.#accumulatorMilliseconds >= FIXED_STEP_MILLISECONDS &&
      steps < MAX_CATCH_UP_STEPS
    ) {
      this.#fixture?.step();
      this.#accumulatorMilliseconds -= FIXED_STEP_MILLISECONDS;
      steps += 1;
    }
    const alpha = this.#accumulatorMilliseconds / FIXED_STEP_MILLISECONDS;
    this.#syncPresentation(alpha);
    const work = performance.now() - workStart;
    if (this.#samples.sampling) {
      this.#samples.mainThreadWork.push(work);
    }
  }

  public beginSample(): void {
    if (!this.#ready || this.#disposed) {
      throw new Error("Fixture must be ready before sampling.");
    }
    this.#fixture?.markWarmupComplete();
    this.#samples.intervals.length = 0;
    this.#samples.mainThreadWork.length = 0;
    this.#samples.startedAt = performance.now();
    this.#samples.endedAt = 0;
    this.#samples.previousFrameAt = 0;
    this.#samples.sampling = true;
  }

  public advancePaused(steps: number): void {
    if (!this.#paused || !Number.isSafeInteger(steps) || steps < 0) {
      throw new Error(
        "Paused fixture advancement requires a non-negative step count.",
      );
    }
    for (let step = 0; step < steps; step += 1) {
      this.#fixture?.step();
    }
    this.#syncPresentation(0);
  }

  public endSample(): FrameSampleSummary {
    this.#samples.sampling = false;
    this.#samples.endedAt = performance.now();
    this.#fixture?.assertNoStructuralAllocationsAfterWarmup();
    return this.#frameSummary();
  }

  public rawSamples(): RawFrameSamples {
    return {
      frameIntervalsMilliseconds: [...this.#samples.intervals],
      mainThreadWorkMilliseconds: [...this.#samples.mainThreadWork],
    };
  }

  public diagnostics(): SyntheticPresentationDiagnostics {
    const renderer = this.#scene.game
      .renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const rendererStats = renderer as unknown as {
      drawCount?: number;
    };
    const memory = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    return {
      ready: this.#ready,
      disposed: this.#disposed,
      atlasCount: this.#scene.textures.exists(TECHNICAL_ENTITY_ATLAS) ? 1 : 0,
      textureMemoryEstimateBytes: 256 * 160 * 4,
      presentationObjects: this.#objects.length,
      visible: this.#visible,
      culled: this.#culled,
      terrainChunks: this.#terrain.length,
      foregroundCells: this.#foregroundCells,
      listenerCount: this.#listenerCount,
      pools: {
        actors: pool(this.#actorObjects),
        projectiles: pool(this.#projectileObjects),
        particles: pool(this.#particleObjects),
        loot: pool(this.#lootObjects),
      },
      simulation: this.#fixture?.diagnostics() ?? null,
      frame: this.#frameSummary(),
      jsHeapBytes: memory.memory?.usedJSHeapSize ?? null,
      drawCalls:
        typeof rendererStats.drawCount === "number"
          ? rendererStats.drawCount
          : null,
    };
  }

  public dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#ready = false;
    this.#samples.sampling = false;
    if (this.#visibilityHandler !== null) {
      document.removeEventListener("visibilitychange", this.#visibilityHandler);
      this.#visibilityHandler = null;
      this.#listenerCount = 0;
    }
    for (const object of this.#objects.splice(0)) {
      object.destroy();
    }
    for (const terrain of this.#terrain.splice(0)) {
      terrain.destroy();
    }
    this.#actorObjects.length = 0;
    this.#projectileObjects.length = 0;
    this.#particleObjects.length = 0;
    this.#lootObjects.length = 0;
    this.#registry.clear();
    this.#fixture?.dispose();
    this.#fixture = null;
    if (this.#scene.textures.exists(TECHNICAL_ENTITY_ATLAS)) {
      this.#scene.textures.remove(TECHNICAL_ENTITY_ATLAS);
    }
    this.#visible = 0;
    this.#culled = 0;
  }

  #registerAtlasFrames(): void {
    const texture = this.#scene.textures.get(TECHNICAL_ENTITY_ATLAS);
    for (let direction = 0; direction < 4; direction += 1) {
      for (let frame = 0; frame < 8; frame += 1) {
        texture.add(
          `actor-${direction}-${frame}`,
          0,
          frame * 32,
          direction * 32,
          32,
          32,
        );
      }
    }
    texture.add("projectile", 0, 0, 128, 32, 32);
    texture.add("particle", 0, 32, 128, 32, 32);
    texture.add("loot", 0, 64, 128, 32, 32);
  }

  async #loadAtlas(): Promise<void> {
    if (this.#scene.textures.exists(TECHNICAL_ENTITY_ATLAS)) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const complete = () => {
        this.#scene.load.off("loaderror", failed);
        resolve();
      };
      const failed = (file: { key?: string }) => {
        if (file.key !== TECHNICAL_ENTITY_ATLAS) {
          return;
        }
        this.#scene.load.off("complete", complete);
        reject(new Error("Synthetic entity atlas failed to load."));
      };
      this.#scene.load.once("complete", complete);
      this.#scene.load.on("loaderror", failed);
      this.#scene.load.svg(
        TECHNICAL_ENTITY_ATLAS,
        "/assets/technical-entities.svg",
      );
      this.#scene.load.start();
    });
  }

  #createPools(): void {
    const fixture = this.#requireFixture();
    this.#createPool(fixture.actorIds, this.#actorObjects, "actor-0-0", 1);
    this.#createPool(
      fixture.projectileIds,
      this.#projectileObjects,
      "projectile",
      0.7,
    );
    this.#createPool(
      fixture.particleIds,
      this.#particleObjects,
      "particle",
      0.32,
    );
    this.#createPool(fixture.lootIds, this.#lootObjects, "loot", 0.85);
    if (this.#objects.length !== SYNTHETIC_ENTITY_COUNT) {
      throw new Error("Presentation pool population contract drifted.");
    }
  }

  #createPool(
    ids: Uint32Array,
    output: Phaser.GameObjects.Image[],
    frame: string,
    scale: number,
  ): void {
    for (const numericId of ids) {
      const id = numericId as RuntimeEntityId;
      const image = this.#scene.add
        .image(0, 0, TECHNICAL_ENTITY_ATLAS, frame)
        .setOrigin(0.5, 1)
        .setScale(scale);
      output.push(image);
      this.#objects.push(image);
      this.#registry.set(id, image);
    }
  }

  #createTerrain(): void {
    const chunkTiles = 16;
    const chunks = MAP_TILES / chunkTiles;
    for (let layer = 0; layer < 5; layer += 1) {
      for (let chunkY = 0; chunkY < chunks; chunkY += 1) {
        for (let chunkX = 0; chunkX < chunks; chunkX += 1) {
          const graphics = this.#scene.add.graphics();
          const color =
            [0x1b3c48, 0x285663, 0x4d5147, 0x77654f, 0x416958][layer] ??
            0xffffff;
          const alpha = [1, 0.42, 0.35, 0.24, 0.45][layer] ?? 1;
          graphics.fillStyle(color, alpha);
          for (let localY = 0; localY < chunkTiles; localY += 1) {
            for (let localX = 0; localX < chunkTiles; localX += 1) {
              const tileX = chunkX * chunkTiles + localX;
              const tileY = chunkY * chunkTiles + localY;
              if (layer === 4 && (tileY * MAP_TILES + tileX) % 10 !== 0) {
                continue;
              }
              if (layer === 4) {
                this.#foregroundCells += 1;
              }
              const point = project(tileX * 32, tileY * 32);
              graphics.fillTriangle(
                point.x,
                point.y,
                point.x + 32,
                point.y + 16,
                point.x,
                point.y + 32,
              );
              graphics.fillTriangle(
                point.x,
                point.y,
                point.x,
                point.y + 32,
                point.x - 32,
                point.y + 16,
              );
            }
          }
          graphics.setDepth(layer === 4 ? 3_000_000 : -50_000 + layer);
          this.#terrain.push(graphics);
        }
      }
    }
    if (this.#foregroundCells !== Math.ceil((MAP_TILES * MAP_TILES) / 10)) {
      throw new Error(
        "Foreground coverage must be exactly the 10% fixture pattern.",
      );
    }
  }

  #syncPresentation(alpha: number): void {
    const fixture = this.#requireFixture();
    fixture.cameraPosition(this.#cameraPosition);
    const projectedCamera = project(
      this.#cameraPosition.x,
      this.#cameraPosition.y,
    );
    this.#scene.cameras.main.centerOn(projectedCamera.x, projectedCamera.y);
    this.#visible = 0;
    this.#culled = 0;
    this.#syncPool(
      fixture.actorIds,
      this.#actorObjects,
      alpha,
      (image, index) => {
        image.setFrame(
          `actor-${fixture.actorDirections[index] ?? 0}-${fixture.actorFrames[index] ?? 0}`,
        );
      },
    );
    this.#syncPool(fixture.projectileIds, this.#projectileObjects, alpha);
    this.#syncPool(
      fixture.particleIds,
      this.#particleObjects,
      alpha,
      (image, index) => {
        image.setAlpha(fixture.particleAlpha[index] ?? 1);
      },
    );
    this.#syncPool(fixture.lootIds, this.#lootObjects, alpha);
  }

  #syncPool(
    ids: Uint32Array,
    objects: Phaser.GameObjects.Image[],
    alpha: number,
    customize?: (image: Phaser.GameObjects.Image, index: number) => void,
  ): void {
    const transforms = this.#requireFixture().lifecycle.transforms;
    const camera = this.#scene.cameras.main;
    const left = camera.worldView.left - PRESENTATION_MARGIN;
    const right = camera.worldView.right + PRESENTATION_MARGIN;
    const top = camera.worldView.top - PRESENTATION_MARGIN;
    const bottom = camera.worldView.bottom + PRESENTATION_MARGIN;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index] as RuntimeEntityId;
      const transform = transforms.indexOf(id);
      const object = objects[index];
      if (object === undefined || transform < 0) {
        throw new Error("Presentation registry contains a stale entity.");
      }
      const x = interpolate(
        transforms.previousX[transform] ?? 0,
        transforms.x[transform] ?? 0,
        alpha,
      );
      const y = interpolate(
        transforms.previousY[transform] ?? 0,
        transforms.y[transform] ?? 0,
        alpha,
      );
      const point = project(x, y);
      const visible =
        point.x >= left &&
        point.x <= right &&
        point.y >= top &&
        point.y <= bottom;
      object.setVisible(visible);
      if (visible) {
        object.setPosition(point.x, point.y + TILE_HEIGHT);
        object.setDepth(
          Math.floor(point.y * 1_000) + (id as number) / 0x1_0000_0000,
        );
        customize?.(object, index);
        this.#visible += 1;
      } else {
        this.#culled += 1;
      }
    }
  }

  #installVisibilityLifecycle(): void {
    this.#visibilityHandler = () => {
      this.#accumulatorMilliseconds = 0;
      if (document.hidden) {
        this.#samples.previousFrameAt = 0;
      }
    };
    document.addEventListener("visibilitychange", this.#visibilityHandler);
    this.#listenerCount = 1;
  }

  #frameSummary(): FrameSampleSummary {
    const end = this.#samples.sampling
      ? performance.now()
      : this.#samples.endedAt;
    let over33 = 0;
    let maximum: number | null = null;
    for (const interval of this.#samples.intervals) {
      if (interval > 33.4) {
        over33 += 1;
      }
      maximum = maximum === null ? interval : Math.max(maximum, interval);
    }
    return {
      sampling: this.#samples.sampling,
      sampleCount: this.#samples.intervals.length,
      durationMilliseconds:
        this.#samples.startedAt === 0 ? 0 : end - this.#samples.startedAt,
      p95FrameIntervalMilliseconds: percentile95(this.#samples.intervals),
      p95MainThreadWorkMilliseconds: percentile95(this.#samples.mainThreadWork),
      intervalsOver33_4Milliseconds: over33,
      maximumFrameIntervalMilliseconds: maximum,
    };
  }

  #requireFixture(): SyntheticLifecycleFixture {
    if (this.#fixture === null) {
      throw new Error("Synthetic lifecycle fixture is not initialized.");
    }
    return this.#fixture;
  }
}

function project(x: number, y: number): { x: number; y: number } {
  return {
    x: ISO_ORIGIN_X + (x - y),
    y: (x + y) * 0.5,
  };
}

function interpolate(previous: number, current: number, alpha: number): number {
  return previous + (current - previous) * alpha;
}

function pool(
  objects: Phaser.GameObjects.Image[],
): PresentationPoolDiagnostics {
  let active = 0;
  for (const object of objects) {
    if (object.active) {
      active += 1;
    }
  }
  return {
    capacity: objects.length,
    active,
    highWaterMark: objects.length,
  };
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null;
}

function isNavigationGrid(
  value: unknown,
): value is CompiledNavigationGridBundle {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<CompiledNavigationGridBundle>;
  return (
    candidate.gridVersion === NAVIGATION_GRID_VERSION &&
    candidate.width === MAP_TILES &&
    candidate.height === MAP_TILES &&
    Array.isArray(candidate.costs) &&
    Array.isArray(candidate.elevations)
  );
}

export const FIXTURE_CAMERA_CONTRACT = {
  width: SYNTHETIC_CAMERA_WIDTH,
  height: SYNTHETIC_CAMERA_HEIGHT,
  pathSeconds: 30,
  tileWidth: TILE_WIDTH,
  tileHeight: TILE_HEIGHT,
  mapTiles: MAP_TILES,
} as const;

export const FIXTURE_POOL_CONTRACT = {
  actors: SYNTHETIC_ACTOR_COUNT,
  projectiles: SYNTHETIC_PROJECTILE_COUNT,
  particles: SYNTHETIC_PARTICLE_COUNT,
  loot: SYNTHETIC_LOOT_COUNT,
} as const;

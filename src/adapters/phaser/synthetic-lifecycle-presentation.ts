import Phaser from "phaser";

import {
  FixedStepRunner,
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
import {
  FixedPresentationPool,
  type FixedPresentationPoolDiagnostics,
} from "./fixed-presentation-pool";

export const TECHNICAL_ENTITY_ATLAS = "fixture:technical-entity-atlas";
const NAVIGATION_URL = "/zones/technical-navigation.grid.json";
const MAP_TILES = 128;
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;
const ISO_ORIGIN_X = 4096;
const MAX_CATCH_UP_STEPS = 5;
const PRESENTATION_MARGIN = 96;
const FRAME_SAMPLE_CAPACITY = 20_000;
const ACTOR_FRAME_NAMES = Array.from({ length: 32 }, (_, index) => {
  const direction = Math.floor(index / 8);
  return `actor-${direction}-${index % 8}`;
});

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
  readonly atlasLoadErrorListeners: number;
  readonly pools: {
    readonly actors: FixedPresentationPoolDiagnostics;
    readonly projectiles: FixedPresentationPoolDiagnostics;
    readonly particles: FixedPresentationPoolDiagnostics;
    readonly loot: FixedPresentationPoolDiagnostics;
  };
  readonly runner: FixtureRunnerDiagnostics;
  readonly renderTimingsMilliseconds: {
    readonly presentation: number;
    readonly renderSubmission: number;
    readonly combined: number;
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
  readonly callbackCount: number;
  readonly simulationSteps: number;
  readonly droppedMilliseconds: number;
  readonly catchUpCallbacks: number;
  readonly maximumStepsPerCallback: number;
  readonly warmupSteps: number;
  readonly invalidReasons: readonly string[];
  readonly sampleCapacity: number;
  readonly sampleOverflowCount: number;
}

export interface FixtureRunnerDiagnostics {
  readonly callbacks: number;
  readonly steps: number;
  readonly droppedMilliseconds: number;
  readonly catchUpCallbacks: number;
  readonly maximumStepsPerCallback: number;
  readonly visibilityChanges: number;
  readonly focusChanges: number;
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
  intervals: Float64Array;
  mainThreadWork: Float64Array;
  intervalCount: number;
  workCount: number;
  overflowCount: number;
}

export class SyntheticLifecyclePresentation {
  readonly #scene: Phaser.Scene;
  readonly #objects: Phaser.GameObjects.Image[] = [];
  readonly #terrain: Phaser.GameObjects.Graphics[] = [];
  readonly #registry = new Map<RuntimeEntityId, Phaser.GameObjects.Image>();
  readonly #cameraPosition = { x: 0, y: 0 };
  readonly #projectedPoint = { x: 0, y: 0 };
  readonly #samples: MutableFrameSamples = {
    sampling: false,
    startedAt: 0,
    endedAt: 0,
    previousFrameAt: 0,
    intervals: new Float64Array(FRAME_SAMPLE_CAPACITY),
    mainThreadWork: new Float64Array(FRAME_SAMPLE_CAPACITY),
    intervalCount: 0,
    workCount: 0,
    overflowCount: 0,
  };
  #fixture: SyntheticLifecycleFixture | null = null;
  #actorPool: FixedPresentationPool<Phaser.GameObjects.Image> | null = null;
  #projectilePool: FixedPresentationPool<Phaser.GameObjects.Image> | null =
    null;
  #particlePool: FixedPresentationPool<Phaser.GameObjects.Image> | null = null;
  #lootPool: FixedPresentationPool<Phaser.GameObjects.Image> | null = null;
  #clockMilliseconds = 0;
  #runner: FixedStepRunner | null = null;
  #callbacks = 0;
  #droppedMilliseconds = 0;
  #catchUpCallbacks = 0;
  #maximumStepsPerCallback = 0;
  #visibilityChanges = 0;
  #focusChanges = 0;
  #focused = true;
  #sampleStartSteps = 0;
  #sampleStartCallbacks = 0;
  #sampleStartDroppedMilliseconds = 0;
  #sampleStartCatchUpCallbacks = 0;
  #sampleMaximumStepsPerCallback = 0;
  #warmupSteps = 0;
  readonly #sampleInvalidReasons = new Set<string>();
  #ready = false;
  #disposed = false;
  #visible = 0;
  #culled = 0;
  #foregroundCells = 0;
  #listenerCount = 0;
  #frameWorkStartedAt = 0;
  #lastPresentationWork = 0;
  #lastRenderSubmissionWork = 0;
  #lastCombinedWork = 0;
  #visibilityHandler: (() => void) | null = null;
  #focusHandler: (() => void) | null = null;
  #blurHandler: (() => void) | null = null;
  #postRenderHandler: (() => void) | null = null;
  #paused: boolean;

  public constructor(scene: Phaser.Scene, initiallyPaused = false) {
    this.#scene = scene;
    this.#paused = initiallyPaused;
  }

  public async create(): Promise<void> {
    if (this.#ready || this.#disposed) {
      throw new Error("Synthetic lifecycle presentation has invalid state.");
    }
    try {
      const response = await fetch(NAVIGATION_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Navigation request returned HTTP ${response.status}.`);
      }
      const data: unknown = await response.json();
      if (!isNavigationGrid(data)) {
        throw new Error("Synthetic navigation bundle is incompatible.");
      }
      await this.#loadAtlas();
      if (this.#disposed) {
        throw new Error(
          "Synthetic lifecycle presentation was disposed while loading.",
        );
      }
      this.#registerAtlasFrames();
      this.#fixture = new SyntheticLifecycleFixture(new NavigationGrid(data), {
        nowMilliseconds: () => performance.now(),
      });
      this.#runner = new FixedStepRunner(
        { nowMilliseconds: () => this.#clockMilliseconds },
        () => this.#fixture?.step(),
        { maxCatchUpSteps: MAX_CATCH_UP_STEPS },
      );
      this.#createTerrain();
      this.#createPools();
      this.#installVisibilityLifecycle();
      this.#installRenderTiming();
      this.#fixture.assertPopulations();
      this.#clockMilliseconds = performance.now();
      if (!this.#paused) {
        this.#runner.resume();
      }
      this.#ready = true;
    } catch (error: unknown) {
      this.dispose();
      throw error;
    }
  }

  public update(time: number, deltaMilliseconds: number): void {
    void deltaMilliseconds;
    if (
      !this.#ready ||
      this.#disposed ||
      document.hidden ||
      !this.#focused ||
      this.#paused
    ) {
      return;
    }
    const workStart = performance.now();
    this.#frameWorkStartedAt = workStart;
    if (this.#samples.sampling) {
      if (this.#samples.previousFrameAt > 0) {
        if (this.#samples.intervalCount < this.#samples.intervals.length) {
          this.#samples.intervals[this.#samples.intervalCount] =
            time - this.#samples.previousFrameAt;
          this.#samples.intervalCount += 1;
        } else {
          this.#samples.overflowCount += 1;
          this.invalidateSample("frame-sample-capacity-exhausted");
        }
      }
      this.#samples.previousFrameAt = time;
    }
    this.#clockMilliseconds = performance.now();
    const advance = this.#runner?.advance();
    if (advance === undefined) {
      throw new Error("Fixed-step runner is unavailable.");
    }
    this.#callbacks += 1;
    this.#droppedMilliseconds += advance.droppedMilliseconds;
    if (advance.stepsRun > 1) {
      this.#catchUpCallbacks += 1;
    }
    this.#maximumStepsPerCallback = Math.max(
      this.#maximumStepsPerCallback,
      advance.stepsRun,
    );
    if (this.#samples.sampling) {
      this.#sampleMaximumStepsPerCallback = Math.max(
        this.#sampleMaximumStepsPerCallback,
        advance.stepsRun,
      );
    }
    this.#syncPresentation(advance.interpolationAlpha);
    this.#lastPresentationWork = performance.now() - workStart;
  }

  public beginSample(): void {
    if (!this.#ready || this.#disposed) {
      throw new Error("Fixture must be ready before sampling.");
    }
    this.#fixture?.markWarmupComplete();
    this.#warmupSteps = this.#fixture?.diagnostics().simulationSteps ?? 0;
    this.#sampleStartSteps = this.#warmupSteps;
    this.#sampleStartCallbacks = this.#callbacks;
    this.#sampleStartDroppedMilliseconds = this.#droppedMilliseconds;
    this.#sampleStartCatchUpCallbacks = this.#catchUpCallbacks;
    this.#sampleMaximumStepsPerCallback = 0;
    this.#sampleInvalidReasons.clear();
    this.#samples.intervalCount = 0;
    this.#samples.workCount = 0;
    this.#samples.overflowCount = 0;
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

  public invalidateSample(reason: string): void {
    if (this.#samples.sampling) {
      this.#sampleInvalidReasons.add(reason);
    }
  }

  public cycleActor(actor: number): {
    readonly destroyed: RuntimeEntityId;
    readonly created: RuntimeEntityId;
  } {
    const fixture = this.#requireFixture();
    const pool = this.#requirePool(this.#actorPool, "actor");
    const result = fixture.replaceActor(actor, (id) => {
      if (!pool.release(id)) {
        throw new Error(`Actor presentation ${id} was not active.`);
      }
      this.#registry.delete(id);
    });
    const object = pool.acquire(result.created);
    this.#registry.set(result.created, object);
    this.#syncPresentation(0);
    return result;
  }

  public rawSamples(): RawFrameSamples {
    return {
      frameIntervalsMilliseconds: Array.from(
        this.#samples.intervals.subarray(0, this.#samples.intervalCount),
      ),
      mainThreadWorkMilliseconds: Array.from(
        this.#samples.mainThreadWork.subarray(0, this.#samples.workCount),
      ),
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
      atlasLoadErrorListeners: this.#scene.load.listenerCount("loaderror"),
      pools: {
        actors:
          this.#actorPool?.diagnostics() ??
          emptyPoolDiagnostics(SYNTHETIC_ACTOR_COUNT),
        projectiles:
          this.#projectilePool?.diagnostics() ??
          emptyPoolDiagnostics(SYNTHETIC_PROJECTILE_COUNT),
        particles:
          this.#particlePool?.diagnostics() ??
          emptyPoolDiagnostics(SYNTHETIC_PARTICLE_COUNT),
        loot:
          this.#lootPool?.diagnostics() ??
          emptyPoolDiagnostics(SYNTHETIC_LOOT_COUNT),
      },
      runner: this.#runnerDiagnostics(),
      renderTimingsMilliseconds: {
        presentation: this.#lastPresentationWork,
        renderSubmission: this.#lastRenderSubmissionWork,
        combined: this.#lastCombinedWork,
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
    }
    if (this.#focusHandler !== null) {
      window.removeEventListener("focus", this.#focusHandler);
      this.#focusHandler = null;
    }
    if (this.#blurHandler !== null) {
      window.removeEventListener("blur", this.#blurHandler);
      this.#blurHandler = null;
    }
    if (this.#postRenderHandler !== null) {
      this.#scene.game.events.off(
        Phaser.Core.Events.POST_RENDER,
        this.#postRenderHandler,
      );
      this.#postRenderHandler = null;
    }
    this.#listenerCount = 0;
    this.#actorPool?.releaseAll();
    this.#projectilePool?.releaseAll();
    this.#particlePool?.releaseAll();
    this.#lootPool?.releaseAll();
    for (const object of this.#objects.splice(0)) {
      object.destroy();
    }
    for (const terrain of this.#terrain.splice(0)) {
      terrain.destroy();
    }
    this.#actorPool = null;
    this.#projectilePool = null;
    this.#particlePool = null;
    this.#lootPool = null;
    this.#registry.clear();
    this.#fixture?.dispose();
    this.#fixture = null;
    this.#runner?.pause();
    this.#runner = null;
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
      const cleanup = () => {
        this.#scene.load.off("complete", complete);
        this.#scene.load.off("loaderror", failed);
      };
      const complete = () => {
        cleanup();
        resolve();
      };
      const failed = (file: { key?: string }) => {
        if (file.key !== TECHNICAL_ENTITY_ATLAS) {
          return;
        }
        cleanup();
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
    this.#actorPool = this.#createPool(
      SYNTHETIC_ACTOR_COUNT,
      fixture.actorIds,
      "actor-0-0",
      1,
    );
    this.#projectilePool = this.#createPool(
      SYNTHETIC_PROJECTILE_COUNT,
      fixture.projectileIds,
      "projectile",
      0.7,
    );
    this.#particlePool = this.#createPool(
      SYNTHETIC_PARTICLE_COUNT,
      fixture.particleIds,
      "particle",
      0.32,
    );
    this.#lootPool = this.#createPool(
      SYNTHETIC_LOOT_COUNT,
      fixture.lootIds,
      "loot",
      0.85,
    );
    if (this.#objects.length !== SYNTHETIC_ENTITY_COUNT) {
      throw new Error("Presentation pool population contract drifted.");
    }
  }

  #createPool(
    capacity: number,
    ids: Uint32Array,
    frame: string,
    scale: number,
  ): FixedPresentationPool<Phaser.GameObjects.Image> {
    const pool = new FixedPresentationPool(
      capacity,
      () => {
        const image = this.#scene.add
          .image(0, 0, TECHNICAL_ENTITY_ATLAS, frame)
          .setOrigin(0.5, 1)
          .setScale(scale);
        this.#objects.push(image);
        return image;
      },
      (image) => {
        image.setActive(true).setVisible(false);
      },
      (image) => {
        image.setActive(false).setVisible(false);
      },
    );
    for (const numericId of ids) {
      const id = numericId as RuntimeEntityId;
      const image = pool.acquire(id);
      this.#registry.set(id, image);
    }
    return pool;
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
    projectInto(
      this.#cameraPosition.x,
      this.#cameraPosition.y,
      this.#projectedPoint,
    );
    this.#scene.cameras.main.centerOn(
      this.#projectedPoint.x,
      this.#projectedPoint.y,
    );
    this.#visible = 0;
    this.#culled = 0;
    this.#syncPool(
      fixture.actorIds,
      this.#requirePool(this.#actorPool, "actor"),
      alpha,
      "actor",
    );
    this.#syncPool(
      fixture.projectileIds,
      this.#requirePool(this.#projectilePool, "projectile"),
      alpha,
    );
    this.#syncPool(
      fixture.particleIds,
      this.#requirePool(this.#particlePool, "particle"),
      alpha,
      "particle",
    );
    this.#syncPool(
      fixture.lootIds,
      this.#requirePool(this.#lootPool, "loot"),
      alpha,
    );
  }

  #syncPool(
    ids: Uint32Array,
    pool: FixedPresentationPool<Phaser.GameObjects.Image>,
    alpha: number,
    customization?: "actor" | "particle",
  ): void {
    const fixture = this.#requireFixture();
    const transforms = fixture.lifecycle.transforms;
    const camera = this.#scene.cameras.main;
    const left = camera.worldView.left - PRESENTATION_MARGIN;
    const right = camera.worldView.right + PRESENTATION_MARGIN;
    const top = camera.worldView.top - PRESENTATION_MARGIN;
    const bottom = camera.worldView.bottom + PRESENTATION_MARGIN;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index] as RuntimeEntityId;
      const transform = transforms.indexOf(id);
      const object = pool.get(id);
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
      projectInto(x, y, this.#projectedPoint);
      const point = this.#projectedPoint;
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
        if (customization === "actor") {
          const frameIndex =
            (fixture.actorDirections[index] ?? 0) * 8 +
            (fixture.actorFrames[index] ?? 0);
          object.setFrame(ACTOR_FRAME_NAMES[frameIndex] ?? "actor-0-0");
        } else if (customization === "particle") {
          object.setAlpha(fixture.particleAlpha[index] ?? 1);
        }
        this.#visible += 1;
      } else {
        this.#culled += 1;
      }
    }
  }

  #installVisibilityLifecycle(): void {
    this.#visibilityHandler = () => {
      this.#visibilityChanges += 1;
      if (document.hidden) {
        this.invalidateSample("visibility-hidden");
        this.#runner?.pause();
        this.#samples.previousFrameAt = 0;
      } else if (this.#focused && !this.#paused) {
        this.#clockMilliseconds = performance.now();
        this.#runner?.resume();
      }
    };
    this.#focusHandler = () => {
      this.#focusChanges += 1;
      this.#focused = true;
      if (!document.hidden && !this.#paused) {
        this.#clockMilliseconds = performance.now();
        this.#runner?.resume();
      }
    };
    this.#blurHandler = () => {
      this.#focusChanges += 1;
      this.#focused = false;
      this.invalidateSample("focus-lost");
      this.#runner?.pause();
      this.#samples.previousFrameAt = 0;
    };
    document.addEventListener("visibilitychange", this.#visibilityHandler);
    window.addEventListener("focus", this.#focusHandler);
    window.addEventListener("blur", this.#blurHandler);
    this.#listenerCount = 3;
  }

  #installRenderTiming(): void {
    this.#postRenderHandler = () => {
      if (this.#frameWorkStartedAt === 0) {
        return;
      }
      this.#lastCombinedWork = performance.now() - this.#frameWorkStartedAt;
      this.#lastRenderSubmissionWork = Math.max(
        0,
        this.#lastCombinedWork - this.#lastPresentationWork,
      );
      this.#frameWorkStartedAt = 0;
      if (!this.#samples.sampling) {
        return;
      }
      if (this.#samples.workCount < this.#samples.mainThreadWork.length) {
        this.#samples.mainThreadWork[this.#samples.workCount] =
          this.#lastCombinedWork;
        this.#samples.workCount += 1;
      } else {
        this.#samples.overflowCount += 1;
        this.invalidateSample("work-sample-capacity-exhausted");
      }
    };
    this.#scene.game.events.on(
      Phaser.Core.Events.POST_RENDER,
      this.#postRenderHandler,
    );
    this.#listenerCount += 1;
  }

  #frameSummary(): FrameSampleSummary {
    const end = this.#samples.sampling
      ? performance.now()
      : this.#samples.endedAt;
    let over33 = 0;
    let maximum: number | null = null;
    for (let index = 0; index < this.#samples.intervalCount; index += 1) {
      const interval = this.#samples.intervals[index] ?? 0;
      if (interval > 33.4) {
        over33 += 1;
      }
      maximum = maximum === null ? interval : Math.max(maximum, interval);
    }
    return {
      sampling: this.#samples.sampling,
      sampleCount: this.#samples.intervalCount,
      durationMilliseconds:
        this.#samples.startedAt === 0 ? 0 : end - this.#samples.startedAt,
      p95FrameIntervalMilliseconds: percentile95(
        this.#samples.intervals,
        this.#samples.intervalCount,
      ),
      p95MainThreadWorkMilliseconds: percentile95(
        this.#samples.mainThreadWork,
        this.#samples.workCount,
      ),
      intervalsOver33_4Milliseconds: over33,
      maximumFrameIntervalMilliseconds: maximum,
      callbackCount: this.#callbacks - this.#sampleStartCallbacks,
      simulationSteps:
        (this.#fixture?.diagnostics().simulationSteps ?? 0) -
        this.#sampleStartSteps,
      droppedMilliseconds:
        this.#droppedMilliseconds - this.#sampleStartDroppedMilliseconds,
      catchUpCallbacks:
        this.#catchUpCallbacks - this.#sampleStartCatchUpCallbacks,
      maximumStepsPerCallback: this.#sampleMaximumStepsPerCallback,
      warmupSteps: this.#warmupSteps,
      invalidReasons: [...this.#sampleInvalidReasons],
      sampleCapacity: this.#samples.intervals.length,
      sampleOverflowCount: this.#samples.overflowCount,
    };
  }

  #runnerDiagnostics(): FixtureRunnerDiagnostics {
    return {
      callbacks: this.#callbacks,
      steps: this.#fixture?.diagnostics().simulationSteps ?? 0,
      droppedMilliseconds: this.#droppedMilliseconds,
      catchUpCallbacks: this.#catchUpCallbacks,
      maximumStepsPerCallback: this.#maximumStepsPerCallback,
      visibilityChanges: this.#visibilityChanges,
      focusChanges: this.#focusChanges,
    };
  }

  #requirePool(
    pool: FixedPresentationPool<Phaser.GameObjects.Image> | null,
    label: string,
  ): FixedPresentationPool<Phaser.GameObjects.Image> {
    if (pool === null) {
      throw new Error(`${label} presentation pool is unavailable.`);
    }
    return pool;
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

function projectInto(
  x: number,
  y: number,
  output: { x: number; y: number },
): void {
  output.x = ISO_ORIGIN_X + (x - y);
  output.y = (x + y) * 0.5;
}

function interpolate(previous: number, current: number, alpha: number): number {
  return previous + (current - previous) * alpha;
}

function emptyPoolDiagnostics(
  capacity: number,
): FixedPresentationPoolDiagnostics {
  return {
    capacity,
    active: 0,
    available: capacity,
    highWaterMark: 0,
    acquisitions: 0,
    releases: 0,
    exhaustionAttempts: 0,
    overflowAttempts: 0,
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

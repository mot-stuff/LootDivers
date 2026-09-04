import Phaser from "phaser";

import type { CanvasViewportReadModel } from "../../presentation/shell-contracts";
import { applyCanvasViewport } from "../browser/canvas-viewport";
import { assertWebGL2Context } from "../browser/webgl2";
import {
  IsometricZoneAdapter,
  type ZoneLifecycleDiagnostics,
} from "./isometric-world";
import {
  FIXTURE_CAMERA_CONTRACT,
  SyntheticLifecyclePresentation,
  type FrameSampleSummary,
  type RawFrameSamples,
  type SyntheticPresentationDiagnostics,
} from "./synthetic-lifecycle-presentation";

const LOGICAL_WORLD_WIDTH = 960;
const LOGICAL_WORLD_HEIGHT = 540;

class TechnicalWorldScene extends Phaser.Scene {
  readonly #onReady: (adapter: IsometricZoneAdapter) => void;
  readonly #onError: (error: Error) => void;
  readonly #fullFixture: boolean;
  #fixture: SyntheticLifecyclePresentation | null = null;

  public constructor(
    onReady: (adapter: IsometricZoneAdapter) => void,
    onError: (error: Error) => void,
    fullFixture: boolean,
  ) {
    super("technical-isometric-world");
    this.#onReady = onReady;
    this.#onError = onError;
    this.#fullFixture = fullFixture;
  }

  public create(): void {
    this.configureLogicalViewport();
    this.add
      .text(
        16,
        16,
        this.#fullFixture
          ? "TASK-P0-008 · BEHAVIORLESS LIFECYCLE FIXTURE"
          : "TASK-P0-006 · SYNTHETIC ISOMETRIC FIXTURE",
        {
          color: "#e8f1ff",
          fontFamily: "monospace",
          fontSize: "14px",
        },
      )
      .setDepth(4_000_000);

    const adapter = new IsometricZoneAdapter(this);
    void adapter
      .load()
      .then(async () => {
        if (this.#fullFixture) {
          this.#fixture = new SyntheticLifecyclePresentation(this);
          await this.#fixture.create();
          this.configureLogicalViewport();
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.#fixture?.dispose();
            this.#fixture = null;
          });
        }
        this.#onReady(adapter);
      })
      .catch((error: unknown) => {
        this.#onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }

  public override update(time: number, delta: number): void {
    this.#fixture?.update(time, delta);
  }

  public configureLogicalViewport(): void {
    const logicalWidth = this.#fullFixture
      ? FIXTURE_CAMERA_CONTRACT.width
      : LOGICAL_WORLD_WIDTH;
    const logicalHeight = this.#fullFixture
      ? FIXTURE_CAMERA_CONTRACT.height
      : LOGICAL_WORLD_HEIGHT;
    const widthScale = this.scale.gameSize.width / logicalWidth;
    const heightScale = this.scale.gameSize.height / logicalHeight;
    const zoom = Math.min(widthScale, heightScale);
    this.cameras.main.setZoom(zoom);
    if (!this.#fullFixture) {
      this.cameras.main.setScroll(
        (LOGICAL_WORLD_WIDTH - this.scale.gameSize.width) / 2,
        (LOGICAL_WORLD_HEIGHT - this.scale.gameSize.height) / 2,
      );
    }
  }

  public fixtureDiagnostics(): SyntheticPresentationDiagnostics | null {
    return this.#fixture?.diagnostics() ?? null;
  }

  public beginFixtureSample(): void {
    this.#fixture?.beginSample();
  }

  public endFixtureSample(): FrameSampleSummary {
    if (this.#fixture === null) {
      throw new Error("Full lifecycle fixture is not active.");
    }
    return this.#fixture.endSample();
  }

  public disposeFixture(): void {
    this.#fixture?.dispose();
  }

  public async resetFixture(): Promise<void> {
    this.#fixture?.dispose();
    this.#fixture = new SyntheticLifecyclePresentation(this);
    await this.#fixture.create();
  }

  public async resetFixtureAtStep(steps: number): Promise<void> {
    this.#fixture?.dispose();
    this.#fixture = new SyntheticLifecyclePresentation(this, true);
    await this.#fixture.create();
    this.#fixture.advancePaused(steps);
  }

  public fixtureRawSamples(): RawFrameSamples {
    if (this.#fixture === null) {
      throw new Error("Full lifecycle fixture is not active.");
    }
    return this.#fixture.rawSamples();
  }
}

export interface TechnicalWorldController {
  diagnostics(): ZoneLifecycleDiagnostics;
  load(url?: string): Promise<void>;
  pick(screenX: number, screenY: number): void;
  unload(): void;
}

export interface PhaserBootResult {
  readonly game: Phaser.Game;
  readonly rendererVersion: string;
  readonly world: TechnicalWorldController;
  readonly fixture: {
    diagnostics(): SyntheticPresentationDiagnostics | null;
    beginSample(): void;
    endSample(): FrameSampleSummary;
    dispose(): void;
    reset(): Promise<void>;
    resetAtStep(steps: number): Promise<void>;
    rawSamples(): RawFrameSamples;
  };
  resize(viewport: CanvasViewportReadModel): void;
}

export interface PhaserBootOptions {
  readonly fullFixture?: boolean;
}

export function bootPhaser(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
  options: PhaserBootOptions = {},
): Promise<PhaserBootResult> {
  return new Promise((resolve, reject) => {
    try {
      const gameRef: { current?: Phaser.Game } = {};
      const scene = new TechnicalWorldScene(
        (world) => {
          const game = gameRef.current;
          if (game === undefined) {
            reject(
              new Error("Phaser scene became ready before game creation."),
            );
            return;
          }
          try {
            resolve({
              game,
              rendererVersion: assertWebGL2Context(game.canvas),
              world,
              fixture: {
                diagnostics: () => scene.fixtureDiagnostics(),
                beginSample: () => {
                  scene.beginFixtureSample();
                },
                endSample: () => scene.endFixtureSample(),
                dispose: () => {
                  scene.disposeFixture();
                },
                reset: () => scene.resetFixture(),
                resetAtStep: (steps) => scene.resetFixtureAtStep(steps),
                rawSamples: () => scene.fixtureRawSamples(),
              },
              resize(viewport) {
                game.scale.resize(
                  viewport.backingWidth,
                  viewport.backingHeight,
                );
                scene.configureLogicalViewport();
                applyCanvasViewport(game.canvas, viewport);
              },
            });
          } catch (error: unknown) {
            game.destroy(true);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        reject,
        options.fullFixture ?? false,
      );
      gameRef.current = new Phaser.Game({
        type: Phaser.WEBGL,
        width: canvas.width,
        height: canvas.height,
        canvas,
        // Phaser 4.2.1's GameConfig declaration omits WebGL2RenderingContext,
        // although its WebGL renderer accepts and uses the supplied context.
        context: context as unknown as CanvasRenderingContext2D,
        backgroundColor: "#101a2b",
        render: {
          antialias: true,
          transparent: false,
        },
        // Keyboard ownership stays in the browser adapter so DOM focus can gate
        // input before an intent is emitted.
        input: {
          keyboard: false,
        },
        scene,
      });
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

import Phaser from "phaser";

import { assertWebGL2Context } from "../browser/webgl2";
import {
  IsometricZoneAdapter,
  type ZoneLifecycleDiagnostics,
} from "./isometric-world";

class TechnicalWorldScene extends Phaser.Scene {
  readonly #onReady: (adapter: IsometricZoneAdapter) => void;
  readonly #onError: (error: Error) => void;

  public constructor(
    onReady: (adapter: IsometricZoneAdapter) => void,
    onError: (error: Error) => void,
  ) {
    super("technical-isometric-world");
    this.#onReady = onReady;
    this.#onError = onError;
  }

  public create(): void {
    this.add
      .text(16, 16, "TASK-P0-006 · SYNTHETIC ISOMETRIC FIXTURE", {
        color: "#e8f1ff",
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setDepth(4_000_000);

    const adapter = new IsometricZoneAdapter(this);
    void adapter
      .load()
      .then(() => {
        this.#onReady(adapter);
      })
      .catch((error: unknown) => {
        this.#onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }
}

export interface TechnicalWorldController {
  diagnostics(): ZoneLifecycleDiagnostics;
  load(): Promise<void>;
  pick(screenX: number, screenY: number): void;
  unload(): void;
}

export interface PhaserBootResult {
  readonly game: Phaser.Game;
  readonly rendererVersion: string;
  readonly world: TechnicalWorldController;
}

export function bootPhaser(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
): Promise<PhaserBootResult> {
  return new Promise((resolve, reject) => {
    try {
      const gameRef: { current?: Phaser.Game } = {};
      const scene = new TechnicalWorldScene((world) => {
        const game = gameRef.current;
        if (game === undefined) {
          reject(new Error("Phaser scene became ready before game creation."));
          return;
        }
        try {
          resolve({
            game,
            rendererVersion: assertWebGL2Context(game.canvas),
            world,
          });
        } catch (error: unknown) {
          game.destroy(true);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, reject);
      gameRef.current = new Phaser.Game({
        type: Phaser.WEBGL,
        width: 960,
        height: 540,
        canvas,
        // Phaser 4.2.1's GameConfig declaration omits WebGL2RenderingContext,
        // although its WebGL renderer accepts and uses the supplied context.
        context: context as unknown as CanvasRenderingContext2D,
        backgroundColor: "#101a2b",
        render: {
          antialias: true,
          transparent: false,
        },
        scene,
      });
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

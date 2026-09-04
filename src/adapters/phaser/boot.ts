import Phaser from "phaser";

import { assertWebGL2Context } from "../browser/webgl2";

class DiagnosticScene extends Phaser.Scene {
  public constructor() {
    super("foundation-diagnostic");
  }

  public create(): void {
    this.add
      .text(480, 270, "Phaser 4.2.1 · WebGL2", {
        color: "#e8f1ff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "30px",
      })
      .setOrigin(0.5);
  }
}

export interface PhaserBootResult {
  readonly game: Phaser.Game;
  readonly rendererVersion: string;
}

export function bootPhaser(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
): Promise<PhaserBootResult> {
  return new Promise((resolve, reject) => {
    try {
      new Phaser.Game({
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
        scene: DiagnosticScene,
        callbacks: {
          postBoot: (bootedGame) => {
            try {
              resolve({
                game: bootedGame,
                rendererVersion: assertWebGL2Context(bootedGame.canvas),
              });
            } catch (error: unknown) {
              bootedGame.destroy(true);
              reject(error instanceof Error ? error : new Error(String(error)));
            }
          },
        },
      });
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

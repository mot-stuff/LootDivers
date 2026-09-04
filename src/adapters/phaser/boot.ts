import Phaser from "phaser";

import type { CanvasViewportReadModel } from "../../presentation/shell-contracts";
import { applyCanvasViewport } from "../browser/canvas-viewport";
import { assertWebGL2Context } from "../browser/webgl2";

class DiagnosticScene extends Phaser.Scene {
  private label?: Phaser.GameObjects.Text;

  public constructor() {
    super("foundation-diagnostic");
  }

  public create(): void {
    this.label = this.add
      .text(0, 0, "Phaser 4.2.1 · WebGL2", {
        color: "#e8f1ff",
        fontFamily: "system-ui, sans-serif",
        fontSize: "30px",
      })
      .setOrigin(0.5);

    const centerLabel = (
      gameSize: Pick<Phaser.Structs.Size, "height" | "width">,
    ): void => {
      this.label?.setPosition(gameSize.width / 2, gameSize.height / 2);
    };

    centerLabel(this.scale.gameSize);
    this.scale.on(Phaser.Scale.Events.RESIZE, centerLabel);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, centerLabel);
    });
  }
}

export interface PhaserBootResult {
  readonly game: Phaser.Game;
  readonly rendererVersion: string;
  resize(viewport: CanvasViewportReadModel): void;
}

export function bootPhaser(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
): Promise<PhaserBootResult> {
  return new Promise((resolve, reject) => {
    try {
      new Phaser.Game({
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
        scene: DiagnosticScene,
        callbacks: {
          postBoot: (bootedGame) => {
            try {
              resolve({
                game: bootedGame,
                rendererVersion: assertWebGL2Context(bootedGame.canvas),
                resize(viewport) {
                  bootedGame.scale.resize(
                    viewport.backingWidth,
                    viewport.backingHeight,
                  );
                  applyCanvasViewport(bootedGame.canvas, viewport);
                },
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

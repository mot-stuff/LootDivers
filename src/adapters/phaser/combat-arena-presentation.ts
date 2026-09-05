import Phaser from "phaser";

import {
  CombatArenaSimulation,
  FixedStepRunner,
  type CombatArenaDiagnostics,
} from "../../core";
import { CombatInputAdapter } from "./combat-input";

const ORIGIN_X = 480;
const ORIGIN_Y = 72;
const ISO_X_SCALE = 0.65;
const ISO_Y_SCALE = 0.34;
const PRESENTATION_DEPTH = 3_500_000;

export interface CombatPresentationDiagnostics extends CombatArenaDiagnostics {
  readonly pausedForUi: boolean;
  readonly playerCanvasX: number;
  readonly playerCanvasY: number;
  readonly pointerCanvasX: number;
  readonly pointerCanvasY: number;
}

export class CombatArenaPresentation {
  readonly #simulation = new CombatArenaSimulation();
  readonly #input: CombatInputAdapter;
  readonly #runner: FixedStepRunner;
  readonly #arenaGraphics: Phaser.GameObjects.Graphics;
  readonly #playerGraphics: Phaser.GameObjects.Graphics;
  readonly #feedbackGraphics: Phaser.GameObjects.Graphics;
  readonly #statusText: Phaser.GameObjects.Text;
  #pausedForUi = true;
  #lastPointerX = ORIGIN_X + 150;
  #lastPointerY = ORIGIN_Y + 180;

  public constructor(
    readonly scene: Phaser.Scene,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.#input = new CombatInputAdapter(scene, canvas);
    this.#runner = new FixedStepRunner(
      { nowMilliseconds: () => performance.now() },
      (step) => this.#simulation.step(step),
    );
    this.#arenaGraphics = scene.add.graphics().setDepth(PRESENTATION_DEPTH);
    this.#playerGraphics = scene.add
      .graphics()
      .setDepth(PRESENTATION_DEPTH + 2);
    this.#feedbackGraphics = scene.add
      .graphics()
      .setDepth(PRESENTATION_DEPTH + 3);
    this.#statusText = scene.add
      .text(24, 446, "", {
        color: "#e8f1ff",
        fontFamily: "monospace",
        fontSize: "16px",
        lineSpacing: 7,
      })
      .setDepth(PRESENTATION_DEPTH + 4);
    this.drawArena();
    this.render(0);
  }

  public update(): void {
    const input = this.#input.sample();
    const focused = this.#input.gameplayFocused;
    if (focused && !this.#runner.isRunning) {
      this.#runner.resume();
    } else if (!focused && this.#runner.isRunning) {
      this.#runner.pause();
    }
    this.#pausedForUi = !focused;

    if (input.resetRequested) {
      this.reset();
    }
    this.#simulation.setMovement(input.movementX, input.movementY);
    if (input.dodgeRequested) {
      this.#simulation.requestDodge();
    }
    if (input.hasPointer) {
      this.#lastPointerX = input.pointerX;
      this.#lastPointerY = input.pointerY;
    }
    const player = this.#simulation.diagnostics();
    const playerPoint = this.project(player.x, player.y);
    const aim = this.inverseProjectDelta(
      this.#lastPointerX - playerPoint.x,
      this.#lastPointerY - playerPoint.y,
    );
    this.#simulation.setAim(aim.x, aim.y);

    const result = this.#runner.advance();
    this.render(result.interpolationAlpha);
  }

  public reset(): void {
    this.#simulation.reset();
  }

  public diagnostics(): CombatPresentationDiagnostics {
    const state = this.#simulation.diagnostics();
    const point = this.project(state.x, state.y);
    return {
      ...state,
      pausedForUi: this.#pausedForUi,
      playerCanvasX: point.x,
      playerCanvasY: point.y,
      pointerCanvasX: this.#lastPointerX,
      pointerCanvasY: this.#lastPointerY,
    };
  }

  public setAimDirection(x: number, y: number): void {
    this.#simulation.setAim(x, y);
    const state = this.#simulation.diagnostics();
    const target = this.project(state.x + x * 100, state.y + y * 100);
    this.#lastPointerX = target.x;
    this.#lastPointerY = target.y;
  }

  public dispose(): void {
    this.#runner.pause();
    this.#input.dispose();
    this.#arenaGraphics.destroy();
    this.#playerGraphics.destroy();
    this.#feedbackGraphics.destroy();
    this.#statusText.destroy();
  }

  private drawArena(): void {
    const top = this.project(0, 0);
    const right = this.project(this.#simulation.config.width, 0);
    const bottom = this.project(
      this.#simulation.config.width,
      this.#simulation.config.height,
    );
    const left = this.project(0, this.#simulation.config.height);
    const points = [top, right, bottom, left].map(
      ({ x, y }) => new Phaser.Math.Vector2(x, y),
    );

    this.#arenaGraphics.fillStyle(0x10263a, 0.98);
    this.#arenaGraphics.fillPoints(points, true);
    this.#arenaGraphics.lineStyle(5, 0x64d8cb, 1);
    this.#arenaGraphics.strokePoints(points, true);

    this.#arenaGraphics.lineStyle(1, 0x31536a, 0.55);
    for (let x = 80; x < this.#simulation.config.width; x += 80) {
      const start = this.project(x, 0);
      const end = this.project(x, this.#simulation.config.height);
      this.#arenaGraphics.lineBetween(start.x, start.y, end.x, end.y);
    }
    for (let y = 60; y < this.#simulation.config.height; y += 60) {
      const start = this.project(0, y);
      const end = this.project(this.#simulation.config.width, y);
      this.#arenaGraphics.lineBetween(start.x, start.y, end.x, end.y);
    }
  }

  private render(alpha: number): void {
    const state = this.#simulation.diagnostics();
    const x = Phaser.Math.Linear(state.previousX, state.x, alpha);
    const y = Phaser.Math.Linear(state.previousY, state.y, alpha);
    const point = this.project(x, y);
    const facingScreenX = (state.facingX - state.facingY) * ISO_X_SCALE;
    const facingScreenY = (state.facingX + state.facingY) * ISO_Y_SCALE;
    const facingLength = Math.hypot(facingScreenX, facingScreenY) || 1;

    this.#playerGraphics.clear();
    this.#playerGraphics.fillStyle(state.dodging ? 0xffffff : 0x5ce1e6, 0.24);
    this.#playerGraphics.fillEllipse(point.x, point.y + 8, 52, 25);
    this.#playerGraphics.fillStyle(state.dodging ? 0xf9f3a6 : 0x5ce1e6, 1);
    this.#playerGraphics.fillCircle(point.x, point.y - 8, 17);
    this.#playerGraphics.lineStyle(5, 0x08111f, 1);
    this.#playerGraphics.lineBetween(
      point.x,
      point.y - 8,
      point.x + (facingScreenX / facingLength) * 35,
      point.y - 8 + (facingScreenY / facingLength) * 35,
    );

    this.#feedbackGraphics.clear();
    this.#feedbackGraphics.fillStyle(0x07111e, 0.9);
    this.#feedbackGraphics.fillRoundedRect(626, 472, 310, 42, 8);
    this.#feedbackGraphics.fillStyle(state.dodgeReady ? 0x57d895 : 0x4f86b8, 1);
    this.#feedbackGraphics.fillRoundedRect(
      634,
      480,
      294 * state.cooldownProgress,
      26,
      5,
    );
    this.#feedbackGraphics.lineStyle(
      2,
      state.dodgeReady ? 0xa7f3cf : 0x76b8ff,
      1,
    );
    this.#feedbackGraphics.strokeRoundedRect(626, 472, 310, 42, 8);

    const focusStatus = this.#pausedForUi
      ? "PAUSED · click arena to play"
      : "ACTIVE";
    const dodgeStatus = state.dodgeReady
      ? "READY"
      : `${(state.cooldownTicksRemaining / 60).toFixed(1)}s`;
    this.#statusText.setText(
      `WASD move · SPACE dodge · R reset · Mouse aim\n${focusStatus}                                  DODGE ${dodgeStatus}`,
    );
  }

  private project(
    x: number,
    y: number,
  ): { readonly x: number; readonly y: number } {
    return {
      x: ORIGIN_X + (x - y) * ISO_X_SCALE,
      y: ORIGIN_Y + (x + y) * ISO_Y_SCALE,
    };
  }

  private inverseProjectDelta(
    screenX: number,
    screenY: number,
  ): { readonly x: number; readonly y: number } {
    const difference = screenX / ISO_X_SCALE;
    const sum = screenY / ISO_Y_SCALE;
    return {
      x: (difference + sum) / 2,
      y: (sum - difference) / 2,
    };
  }
}

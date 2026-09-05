import Phaser from "phaser";

import {
  CombatArenaSimulation,
  FixedStepRunner,
  type CombatArenaDiagnostics,
  type CombatArenaEvent,
  type DamageResult,
} from "../../core";
import type { CombatHudReadModel } from "../../presentation/shell-contracts";
import { CombatInputAdapter } from "./combat-input";

const ORIGIN_X = 480;
const ORIGIN_Y = 72;
const ISO_X_SCALE = 0.65;
const ISO_Y_SCALE = 0.34;
const PRESENTATION_DEPTH = 3_500_000;
const INITIAL_TARGET_ID = "enemy:integration-target";

export interface CombatPresentationDiagnostics extends CombatArenaDiagnostics {
  readonly pausedForUi: boolean;
  readonly playerCanvasX: number;
  readonly playerCanvasY: number;
  readonly facingCanvasX: number;
  readonly facingCanvasY: number;
  readonly impactCount: number;
  readonly deathFeedbackCount: number;
}

export class CombatArenaPresentation {
  readonly #simulation = new CombatArenaSimulation();
  readonly #input: CombatInputAdapter;
  readonly #runner: FixedStepRunner;
  readonly #arenaGraphics: Phaser.GameObjects.Graphics;
  readonly #combatGraphics: Phaser.GameObjects.Graphics;
  readonly #playerGraphics: Phaser.GameObjects.Graphics;
  readonly #renderedPlayerPoint = new Phaser.Math.Vector2();
  readonly #renderedFacingPoint = new Phaser.Math.Vector2();
  #pausedForUi = true;
  #lastHudKey = "";
  #lastPointerX = ORIGIN_X + 150;
  #lastPointerY = ORIGIN_Y + 180;
  #impactCount = 0;
  #deathFeedbackCount = 0;
  #targetFlashUntil = 0;
  #playerFlashUntil = 0;

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
    this.#combatGraphics = scene.add
      .graphics()
      .setDepth(PRESENTATION_DEPTH + 1);
    this.#playerGraphics = scene.add
      .graphics()
      .setDepth(PRESENTATION_DEPTH + 2);
    this.#simulation.registerTarget({
      id: INITIAL_TARGET_ID,
      x: this.#simulation.config.width / 2 + 92,
      y: this.#simulation.config.height / 2,
      radius: 20,
      maxHealth: 100,
    });
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
    if (input.primaryAttackRequested) {
      this.#simulation.requestPrimaryAttack();
    }
    if (input.hasPointer) {
      this.#lastPointerX = input.pointerX;
      this.#lastPointerY = input.pointerY;
    }
    const player = this.#simulation.diagnostics();
    const playerPoint = this.project(player.x, player.y);
    this.scene.cameras.main.centerOn(playerPoint.x, playerPoint.y);
    const aimOriginY = playerPoint.y - 8;
    const pointerPoint = this.scene.cameras.main.getWorldPoint(
      this.#lastPointerX,
      this.#lastPointerY,
    );
    const aim = this.inverseProjectDelta(
      pointerPoint.x - playerPoint.x,
      pointerPoint.y - aimOriginY,
    );
    this.#simulation.setAim(aim.x, aim.y);

    const result = this.#runner.advance();
    this.consumeEvents(this.#simulation.drainEvents());
    this.render(result.interpolationAlpha);
  }

  public reset(): void {
    this.#simulation.reset();
    this.#impactCount = 0;
    this.#deathFeedbackCount = 0;
    this.#targetFlashUntil = 0;
    this.#playerFlashUntil = 0;
  }

  public diagnostics(): CombatPresentationDiagnostics {
    return {
      ...this.#simulation.diagnostics(),
      pausedForUi: this.#pausedForUi,
      playerCanvasX: this.#renderedPlayerPoint.x,
      playerCanvasY: this.#renderedPlayerPoint.y,
      facingCanvasX: this.#renderedFacingPoint.x,
      facingCanvasY: this.#renderedFacingPoint.y,
      impactCount: this.#impactCount,
      deathFeedbackCount: this.#deathFeedbackCount,
    };
  }

  public applyPlayerDamage(amount: number): DamageResult {
    const result = this.#simulation.applyPlayerDamage({
      amount,
      sourceId: INITIAL_TARGET_ID,
    });
    this.consumeEvents(this.#simulation.drainEvents());
    this.render(0);
    return result;
  }

  public setAimDirection(x: number, y: number): void {
    this.#simulation.setAim(x, y);
    const state = this.#simulation.diagnostics();
    const target = this.project(state.x + x * 100, state.y + y * 100);
    const canvasTarget = this.scene.cameras.main.matrixCombined.transformPoint(
      target.x,
      target.y,
    );
    this.#lastPointerX = canvasTarget.x;
    this.#lastPointerY = canvasTarget.y;
  }

  public dispose(): void {
    this.#runner.pause();
    this.#input.dispose();
    this.#arenaGraphics.destroy();
    this.#combatGraphics.destroy();
    this.#playerGraphics.destroy();
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
    this.scene.cameras.main.centerOn(point.x, point.y);
    const facingScreenX = (state.facingX - state.facingY) * ISO_X_SCALE;
    const facingScreenY = (state.facingX + state.facingY) * ISO_Y_SCALE;
    const facingLength = Math.hypot(facingScreenX, facingScreenY) || 1;
    const facingEndX = point.x + (facingScreenX / facingLength) * 35;
    const facingEndY = point.y - 8 + (facingScreenY / facingLength) * 35;

    this.#combatGraphics.clear();
    this.drawAttack(state, point);
    this.drawTargets(state);

    this.#playerGraphics.clear();
    const playerColor = state.playerDead
      ? 0x59636f
      : performance.now() < this.#playerFlashUntil
        ? 0xff6b6b
        : state.dodging
          ? 0xf9f3a6
          : 0x5ce1e6;
    this.#playerGraphics.fillStyle(playerColor, 0.24);
    this.#playerGraphics.fillEllipse(point.x, point.y + 8, 52, 25);
    this.#playerGraphics.fillStyle(playerColor, 1);
    this.#playerGraphics.fillCircle(point.x, point.y - 8, 17);
    this.#playerGraphics.lineStyle(5, 0x08111f, 1);
    this.#playerGraphics.lineBetween(
      point.x,
      point.y - 8,
      facingEndX,
      facingEndY,
    );
    const cameraMatrix = this.scene.cameras.main.matrixCombined;
    cameraMatrix.transformPoint(
      point.x,
      point.y - 8,
      this.#renderedPlayerPoint,
    );
    cameraMatrix.transformPoint(
      facingEndX,
      facingEndY,
      this.#renderedFacingPoint,
    );

    this.publishHud(state);
  }

  private drawAttack(
    state: CombatArenaDiagnostics,
    playerPoint: { readonly x: number; readonly y: number },
  ): void {
    if (state.attackPhase === "idle" || state.attackPhase === "recovery") {
      return;
    }
    const attack = this.#simulation.config.primaryAttack;
    const centerAngle = Math.atan2(state.attackAimY, state.attackAimX);
    const halfAngle = (attack.halfAngleDegrees * Math.PI) / 180;
    const points = [new Phaser.Math.Vector2(playerPoint.x, playerPoint.y - 8)];
    for (let index = 0; index <= 8; index += 1) {
      const angle = centerAngle - halfAngle + (halfAngle * 2 * index) / 8;
      const endpoint = this.project(
        state.x + Math.cos(angle) * attack.range,
        state.y + Math.sin(angle) * attack.range,
      );
      points.push(new Phaser.Math.Vector2(endpoint.x, endpoint.y));
    }
    this.#combatGraphics.fillStyle(
      state.attackPhase === "active" ? 0xffd166 : 0x8ecae6,
      state.attackPhase === "active" ? 0.34 : 0.15,
    );
    this.#combatGraphics.fillPoints(points, true);
    this.#combatGraphics.lineStyle(3, 0xffd166, 0.9);
    this.#combatGraphics.strokePoints(points.slice(1), false);
  }

  private drawTargets(state: CombatArenaDiagnostics): void {
    for (const target of state.targets) {
      const point = this.project(target.x, target.y);
      const flashing =
        target.id === INITIAL_TARGET_ID &&
        performance.now() < this.#targetFlashUntil;
      const color = target.dead ? 0x4b5563 : flashing ? 0xffffff : 0xef476f;
      this.#combatGraphics.fillStyle(color, target.dead ? 0.45 : 1);
      this.#combatGraphics.fillCircle(point.x, point.y - 8, target.radius);
      this.#combatGraphics.lineStyle(4, 0x08111f, 1);
      if (target.dead) {
        this.#combatGraphics.lineBetween(
          point.x - 12,
          point.y - 20,
          point.x + 12,
          point.y + 4,
        );
        this.#combatGraphics.lineBetween(
          point.x + 12,
          point.y - 20,
          point.x - 12,
          point.y + 4,
        );
      } else {
        const healthWidth = 44 * (target.health / target.maxHealth);
        this.#combatGraphics.fillStyle(0x32131b, 1);
        this.#combatGraphics.fillRect(point.x - 22, point.y - 38, 44, 5);
        this.#combatGraphics.fillStyle(0xff6b6b, 1);
        this.#combatGraphics.fillRect(
          point.x - 22,
          point.y - 38,
          healthWidth,
          5,
        );
      }
    }
  }

  private consumeEvents(events: readonly CombatArenaEvent[]): void {
    for (const event of events) {
      if (event.type === "damage-applied") {
        this.#impactCount += 1;
        if (event.targetId === "player") {
          this.#playerFlashUntil = performance.now() + 110;
        } else {
          this.#targetFlashUntil = performance.now() + 110;
        }
      } else if (event.type === "entity-died") {
        this.#deathFeedbackCount += 1;
      }
    }
  }

  private publishHud(state: CombatArenaDiagnostics): void {
    const hud: CombatHudReadModel = {
      paused: this.#pausedForUi,
      dodgeReady: state.dodgeReady,
      cooldownProgress: Math.round(state.cooldownProgress * 20) / 20,
      cooldownSecondsRemaining:
        Math.ceil((state.cooldownTicksRemaining / 60) * 10) / 10,
    };
    const key = JSON.stringify(hud);
    if (key === this.#lastHudKey) {
      return;
    }
    this.#lastHudKey = key;
    this.canvas.dispatchEvent(
      new CustomEvent<CombatHudReadModel>("rarpg:combat-hud", {
        bubbles: true,
        detail: hud,
      }),
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

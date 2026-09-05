import Phaser from "phaser";

import {
  CombatArenaSimulation,
  FIXED_STEP_SECONDS,
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

export interface CombatPresentationDiagnostics extends CombatArenaDiagnostics {
  readonly pausedForUi: boolean;
  readonly playerCanvasX: number;
  readonly playerCanvasY: number;
  readonly facingCanvasX: number;
  readonly facingCanvasY: number;
  readonly enemyCanvasX: number;
  readonly enemyCanvasY: number;
  readonly enemyHealthBarCanvasX: number;
  readonly enemyHealthBarCanvasY: number;
  readonly enemyHealthBarVisible: boolean;
  readonly impactCount: number;
  readonly deathFeedbackCount: number;
  readonly enemyStrikeFeedbackCount: number;
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
  readonly #renderedEnemyPoint = new Phaser.Math.Vector2();
  readonly #renderedEnemyHealthBarPoint = new Phaser.Math.Vector2();
  #pausedForUi = true;
  #automationPaused = false;
  #lastHudKey = "";
  #lastPointerX = ORIGIN_X + 150;
  #lastPointerY = ORIGIN_Y + 180;
  #impactCount = 0;
  #deathFeedbackCount = 0;
  #enemyStrikeFeedbackCount = 0;
  #targetFlashUntil = 0;
  #playerFlashUntil = 0;
  #enemyStrikeUntil = 0;

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
    this.drawArena();
    this.render(0);
  }

  public update(): void {
    const input = this.#input.sample();
    const focused = this.#input.gameplayFocused;
    if (focused && !this.#automationPaused && !this.#runner.isRunning) {
      this.#runner.resume();
    } else if ((!focused || this.#automationPaused) && this.#runner.isRunning) {
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
    this.#runner.reset();
    this.#simulation.reset();
    this.#impactCount = 0;
    this.#deathFeedbackCount = 0;
    this.#enemyStrikeFeedbackCount = 0;
    this.#targetFlashUntil = 0;
    this.#playerFlashUntil = 0;
    this.#enemyStrikeUntil = 0;
    this.render(0);
  }

  public diagnostics(): CombatPresentationDiagnostics {
    return {
      ...this.#simulation.diagnostics(),
      pausedForUi: this.#pausedForUi,
      playerCanvasX: this.#renderedPlayerPoint.x,
      playerCanvasY: this.#renderedPlayerPoint.y,
      facingCanvasX: this.#renderedFacingPoint.x,
      facingCanvasY: this.#renderedFacingPoint.y,
      enemyCanvasX: this.#renderedEnemyPoint.x,
      enemyCanvasY: this.#renderedEnemyPoint.y,
      enemyHealthBarCanvasX: this.#renderedEnemyHealthBarPoint.x,
      enemyHealthBarCanvasY: this.#renderedEnemyHealthBarPoint.y,
      enemyHealthBarVisible: !this.#simulation.diagnostics().enemy.dead,
      impactCount: this.#impactCount,
      deathFeedbackCount: this.#deathFeedbackCount,
      enemyStrikeFeedbackCount: this.#enemyStrikeFeedbackCount,
    };
  }

  public applyPlayerDamage(amount: number): DamageResult {
    const result = this.#simulation.applyPlayerDamage({
      amount,
      sourceId: this.#simulation.config.enemy.id,
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

  public setAutomationPaused(paused: boolean): void {
    this.#automationPaused = paused;
    if (paused) {
      this.#runner.pause();
    }
  }

  public requestDodge(): void {
    this.#simulation.requestDodge();
  }

  public requestPrimaryAttack(): void {
    this.#simulation.requestPrimaryAttack();
  }

  public advancePaused(steps: number): void {
    if (!this.#automationPaused) {
      throw new Error("Combat automation must be paused before advancing.");
    }
    if (!Number.isSafeInteger(steps) || steps < 0) {
      throw new RangeError("Combat steps must be a non-negative safe integer.");
    }
    for (let index = 0; index < steps; index += 1) {
      this.#simulation.step({
        tick: this.#simulation.diagnostics().tick,
        deltaSeconds: FIXED_STEP_SECONDS,
      });
    }
    this.consumeEvents(this.#simulation.drainEvents());
    this.render(0);
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
    this.drawEnemy(state, alpha);

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

  private drawEnemy(state: CombatArenaDiagnostics, alpha: number): void {
    const enemy = state.enemy;
    const x = Phaser.Math.Linear(enemy.previousX, enemy.x, alpha);
    const y = Phaser.Math.Linear(enemy.previousY, enemy.y, alpha);
    const point = this.project(x, y);
    const flashing = performance.now() < this.#targetFlashUntil;
    const color = enemy.dead ? 0x4b5563 : flashing ? 0xffffff : 0xef476f;
    this.#combatGraphics.fillStyle(color, enemy.dead ? 0.45 : 1);
    this.#combatGraphics.fillCircle(point.x, point.y - 8, enemy.radius);
    this.#combatGraphics.lineStyle(4, 0x08111f, 1);
    if (enemy.dead) {
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
      const facingScreenX = (enemy.facingX - enemy.facingY) * ISO_X_SCALE;
      const facingScreenY = (enemy.facingX + enemy.facingY) * ISO_Y_SCALE;
      const facingLength = Math.hypot(facingScreenX, facingScreenY) || 1;
      this.#combatGraphics.lineBetween(
        point.x,
        point.y - 8,
        point.x + (facingScreenX / facingLength) * 25,
        point.y - 8 + (facingScreenY / facingLength) * 25,
      );
      if (enemy.state === "windup") {
        const progress =
          1 -
          enemy.windupTicksRemaining /
            this.#simulation.config.enemy.attackWindupTicks;
        this.#combatGraphics.lineStyle(3 + progress * 5, 0xffd166, 0.95);
        this.#combatGraphics.strokeCircle(
          point.x,
          point.y - 8,
          enemy.radius + 8 + progress * 8,
        );
      } else if (performance.now() < this.#enemyStrikeUntil) {
        this.#combatGraphics.lineStyle(7, 0xff9f1c, 0.9);
        this.#combatGraphics.strokeCircle(
          point.x,
          point.y - 8,
          enemy.radius + 15,
        );
      }
      const healthBarWidth = Math.max(28, enemy.radius * 2.4);
      const healthBarY = point.y - enemy.radius - 14;
      const healthWidth = healthBarWidth * (enemy.health / enemy.maxHealth);
      this.#combatGraphics.fillStyle(0x32131b, 1);
      this.#combatGraphics.fillRect(
        point.x - healthBarWidth / 2,
        healthBarY,
        healthBarWidth,
        4,
      );
      this.#combatGraphics.fillStyle(0xff6b6b, 1);
      this.#combatGraphics.fillRect(
        point.x - healthBarWidth / 2,
        healthBarY,
        healthWidth,
        4,
      );
    }
    this.scene.cameras.main.matrixCombined.transformPoint(
      point.x,
      point.y - 8,
      this.#renderedEnemyPoint,
    );
    this.scene.cameras.main.matrixCombined.transformPoint(
      point.x,
      point.y - enemy.radius - 14,
      this.#renderedEnemyHealthBarPoint,
    );
  }

  private consumeEvents(events: readonly CombatArenaEvent[]): void {
    for (const event of events) {
      if (event.type === "damage-applied") {
        this.#impactCount += 1;
        if (event.targetId === "player") {
          this.#playerFlashUntil = performance.now() + 110;
          this.#enemyStrikeFeedbackCount += 1;
          this.#enemyStrikeUntil = performance.now() + 140;
        } else {
          this.#targetFlashUntil = performance.now() + 110;
        }
      } else if (
        event.type === "damage-ignored" &&
        event.targetId === "player"
      ) {
        this.#enemyStrikeFeedbackCount += 1;
        this.#enemyStrikeUntil = performance.now() + 140;
      } else if (event.type === "entity-died") {
        this.#deathFeedbackCount += 1;
      }
    }
  }

  private publishHud(state: CombatArenaDiagnostics): void {
    const hud: CombatHudReadModel = {
      paused: this.#pausedForUi,
      playerHealth: state.playerHealth,
      playerMaxHealth: state.playerMaxHealth,
      playerDead: state.playerDead,
      placeholderManaCurrent: 100,
      placeholderManaMaximum: 100,
      placeholderExperienceCurrent: 0,
      placeholderExperienceMaximum: 100,
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

import { FIXED_TICKS_PER_SECOND, type FixedStep } from "./fixed-step";
import { PresentationKind, TechnicalEntityLifecycle } from "./entity-lifecycle";
import type { RuntimeEntityId } from "./ids";

export interface CombatArenaConfig {
  readonly width: number;
  readonly height: number;
  readonly playerRadius: number;
  readonly moveSpeed: number;
  readonly dodgeSpeed: number;
  readonly dodgeDurationSeconds: number;
  readonly dodgeCooldownSeconds: number;
}

export interface CombatArenaDiagnostics {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly previousX: number;
  readonly previousY: number;
  readonly facingX: number;
  readonly facingY: number;
  readonly movementX: number;
  readonly movementY: number;
  readonly dodging: boolean;
  readonly dodgeReady: boolean;
  readonly dodgeTicksRemaining: number;
  readonly cooldownTicksRemaining: number;
  readonly cooldownProgress: number;
  readonly dodgeCount: number;
}

export const DEFAULT_COMBAT_ARENA_CONFIG: CombatArenaConfig = {
  width: 640,
  height: 360,
  playerRadius: 18,
  moveSpeed: 190,
  dodgeSpeed: 510,
  dodgeDurationSeconds: 0.18,
  dodgeCooldownSeconds: 0.8,
};

function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * FIXED_TICKS_PER_SECOND));
}

export class CombatArenaSimulation {
  readonly #dodgeDurationTicks: number;
  readonly #dodgeCooldownTicks: number;
  readonly #lifecycle = new TechnicalEntityLifecycle(1);
  readonly #playerId: RuntimeEntityId;
  #tick = 0;
  #movementX = 0;
  #movementY = 0;
  #facingX = 1;
  #facingY = 0;
  #dodgeX = 1;
  #dodgeY = 0;
  #dodgeRequested = false;
  #dodgeTicksRemaining = 0;
  #cooldownTicksRemaining = 0;
  #dodgeCount = 0;

  public constructor(
    readonly config: CombatArenaConfig = DEFAULT_COMBAT_ARENA_CONFIG,
  ) {
    this.validateConfig(config);
    this.#dodgeDurationTicks = secondsToTicks(config.dodgeDurationSeconds);
    this.#dodgeCooldownTicks = secondsToTicks(config.dodgeCooldownSeconds);
    this.#playerId = this.#lifecycle.create(
      { x: config.width / 2, y: config.height / 2, elevation: 0 },
      PresentationKind.Actor,
    );
  }

  public setMovement(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("Movement input must be finite.");
    }
    const length = Math.hypot(x, y);
    if (length === 0) {
      this.#movementX = 0;
      this.#movementY = 0;
      return;
    }
    this.#movementX = x / length;
    this.#movementY = y / length;
  }

  public setAim(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("Aim input must be finite.");
    }
    const length = Math.hypot(x, y);
    if (length === 0) {
      return;
    }
    this.#facingX = x / length;
    this.#facingY = y / length;
  }

  public requestDodge(): void {
    this.#dodgeRequested = true;
  }

  public step(step: FixedStep): void {
    this.#tick = step.tick + 1;
    this.#lifecycle.transforms.snapshot();

    if (
      this.#dodgeRequested &&
      this.#cooldownTicksRemaining === 0 &&
      this.#dodgeTicksRemaining === 0
    ) {
      this.beginDodge();
    }
    this.#dodgeRequested = false;

    const dodging = this.#dodgeTicksRemaining > 0;
    const directionX = dodging ? this.#dodgeX : this.#movementX;
    const directionY = dodging ? this.#dodgeY : this.#movementY;
    const speed = dodging ? this.config.dodgeSpeed : this.config.moveSpeed;
    const transformIndex = this.playerTransformIndex();
    this.#lifecycle.transforms.x[transformIndex] =
      (this.#lifecycle.transforms.x[transformIndex] ?? 0) +
      directionX * speed * step.deltaSeconds;
    this.#lifecycle.transforms.y[transformIndex] =
      (this.#lifecycle.transforms.y[transformIndex] ?? 0) +
      directionY * speed * step.deltaSeconds;
    this.clampToArena();

    if (this.#dodgeTicksRemaining > 0) {
      this.#dodgeTicksRemaining -= 1;
    }
    if (this.#cooldownTicksRemaining > 0) {
      this.#cooldownTicksRemaining -= 1;
    }
  }

  public reset(): void {
    const transformIndex = this.playerTransformIndex();
    this.#tick = 0;
    this.#lifecycle.transforms.x[transformIndex] = this.config.width / 2;
    this.#lifecycle.transforms.y[transformIndex] = this.config.height / 2;
    this.#lifecycle.transforms.previousX[transformIndex] =
      this.config.width / 2;
    this.#lifecycle.transforms.previousY[transformIndex] =
      this.config.height / 2;
    this.#movementX = 0;
    this.#movementY = 0;
    this.#facingX = 1;
    this.#facingY = 0;
    this.#dodgeX = 1;
    this.#dodgeY = 0;
    this.#dodgeRequested = false;
    this.#dodgeTicksRemaining = 0;
    this.#cooldownTicksRemaining = 0;
    this.#dodgeCount = 0;
  }

  public diagnostics(): CombatArenaDiagnostics {
    const transformIndex = this.playerTransformIndex();
    return {
      tick: this.#tick,
      x: this.#lifecycle.transforms.x[transformIndex] ?? 0,
      y: this.#lifecycle.transforms.y[transformIndex] ?? 0,
      previousX: this.#lifecycle.transforms.previousX[transformIndex] ?? 0,
      previousY: this.#lifecycle.transforms.previousY[transformIndex] ?? 0,
      facingX: this.#facingX,
      facingY: this.#facingY,
      movementX: this.#movementX,
      movementY: this.#movementY,
      dodging: this.#dodgeTicksRemaining > 0,
      dodgeReady:
        this.#dodgeTicksRemaining === 0 && this.#cooldownTicksRemaining === 0,
      dodgeTicksRemaining: this.#dodgeTicksRemaining,
      cooldownTicksRemaining: this.#cooldownTicksRemaining,
      cooldownProgress:
        1 - this.#cooldownTicksRemaining / this.#dodgeCooldownTicks,
      dodgeCount: this.#dodgeCount,
    };
  }

  private beginDodge(): void {
    if (this.#movementX !== 0 || this.#movementY !== 0) {
      this.#dodgeX = this.#movementX;
      this.#dodgeY = this.#movementY;
    } else {
      this.#dodgeX = this.#facingX;
      this.#dodgeY = this.#facingY;
    }
    this.#dodgeTicksRemaining = this.#dodgeDurationTicks;
    this.#cooldownTicksRemaining = this.#dodgeCooldownTicks;
    this.#dodgeCount += 1;
  }

  private clampToArena(): void {
    const radius = this.config.playerRadius;
    const transformIndex = this.playerTransformIndex();
    this.#lifecycle.transforms.x[transformIndex] = Math.min(
      this.config.width - radius,
      Math.max(radius, this.#lifecycle.transforms.x[transformIndex] ?? radius),
    );
    this.#lifecycle.transforms.y[transformIndex] = Math.min(
      this.config.height - radius,
      Math.max(radius, this.#lifecycle.transforms.y[transformIndex] ?? radius),
    );
  }

  private playerTransformIndex(): number {
    const index = this.#lifecycle.transforms.indexOf(this.#playerId);
    if (index < 0) {
      throw new Error("Combat player transform is not registered.");
    }
    return index;
  }

  private validateConfig(config: CombatArenaConfig): void {
    const positiveValues = [
      config.width,
      config.height,
      config.playerRadius,
      config.moveSpeed,
      config.dodgeSpeed,
      config.dodgeDurationSeconds,
      config.dodgeCooldownSeconds,
    ];
    if (positiveValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new RangeError(
        "Combat arena configuration must be finite and positive.",
      );
    }
    if (
      config.playerRadius * 2 >= config.width ||
      config.playerRadius * 2 >= config.height
    ) {
      throw new RangeError("Player radius must fit inside the combat arena.");
    }
    if (config.dodgeCooldownSeconds < config.dodgeDurationSeconds) {
      throw new RangeError(
        "Dodge cooldown must not be shorter than its duration.",
      );
    }
  }
}

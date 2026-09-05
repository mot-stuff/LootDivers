import type { FixedStep } from "./fixed-step";
import {
  HealthPool,
  type DamageRequest,
  type DamageResult,
  type HealthReadModel,
} from "./health";

export type MeleeEnemyState =
  "approaching" | "windup" | "recovering" | "idle" | "dead";

export interface SimpleMeleeEnemyConfig {
  readonly id: string;
  readonly spawnX: number;
  readonly spawnY: number;
  readonly radius: number;
  readonly maxHealth: number;
  readonly moveSpeed: number;
  readonly meleeRange: number;
  readonly attackDamage: number;
  readonly attackWindupTicks: number;
  readonly attackIntervalTicks: number;
}

export interface MeleeEnemyTarget {
  readonly x: number;
  readonly y: number;
  readonly dead: boolean;
}

export interface SimpleMeleeEnemyDiagnostics {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly previousX: number;
  readonly previousY: number;
  readonly radius: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly dead: boolean;
  readonly state: MeleeEnemyState;
  readonly facingX: number;
  readonly facingY: number;
  readonly windupTicksRemaining: number;
  readonly cadenceTicksRemaining: number;
  readonly attackCount: number;
  readonly damageAttemptCount: number;
  readonly damageAppliedCount: number;
}

export type PlayerDamageApplicator = (request: DamageRequest) => DamageResult;

export class SimpleMeleeEnemy {
  readonly #health: HealthPool;
  #x: number;
  #y: number;
  #previousX: number;
  #previousY: number;
  #facingX = -1;
  #facingY = 0;
  #state: MeleeEnemyState = "approaching";
  #windupTicksRemaining = 0;
  #cadenceTicksRemaining = 0;
  #attackCount = 0;
  #damageAttemptCount = 0;
  #damageAppliedCount = 0;

  public constructor(readonly config: SimpleMeleeEnemyConfig) {
    validateConfig(config);
    this.#health = new HealthPool(config.maxHealth);
    this.#x = config.spawnX;
    this.#y = config.spawnY;
    this.#previousX = config.spawnX;
    this.#previousY = config.spawnY;
  }

  public get health(): HealthReadModel {
    return this.#health.health;
  }

  public applyDamage(request: DamageRequest): DamageResult {
    const result = this.#health.applyDamage(request);
    if (result.died) {
      this.#state = "dead";
      this.#windupTicksRemaining = 0;
      this.#cadenceTicksRemaining = 0;
    }
    return result;
  }

  public step(
    step: FixedStep,
    target: MeleeEnemyTarget,
    applyPlayerDamage: PlayerDamageApplicator,
  ): void {
    this.#previousX = this.#x;
    this.#previousY = this.#y;
    if (this.#health.health.dead) {
      this.#state = "dead";
      return;
    }
    if (target.dead) {
      this.cancelAttack("idle");
      return;
    }

    const deltaX = target.x - this.#x;
    const deltaY = target.y - this.#y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance > 0) {
      this.#facingX = deltaX / distance;
      this.#facingY = deltaY / distance;
    }
    const inRange = distance <= this.config.meleeRange;

    if (!inRange) {
      if (this.#state === "windup") {
        this.cancelAttack("approaching");
      }
      const travel = Math.min(
        this.config.moveSpeed * step.deltaSeconds,
        distance - this.config.meleeRange,
      );
      this.#x += this.#facingX * travel;
      this.#y += this.#facingY * travel;
      this.#state = "approaching";
      if (this.#cadenceTicksRemaining > 0) {
        this.#cadenceTicksRemaining -= 1;
      }
      return;
    }

    if (this.#state === "windup") {
      this.#windupTicksRemaining -= 1;
      if (this.#windupTicksRemaining === 0) {
        this.resolveAttack(applyPlayerDamage);
      }
      return;
    }

    if (this.#cadenceTicksRemaining > 0) {
      this.#state = "recovering";
      this.#cadenceTicksRemaining -= 1;
      if (this.#cadenceTicksRemaining === 0) {
        this.beginWindup();
      }
      return;
    }

    this.beginWindup();
  }

  public reset(): void {
    this.#health.reset();
    this.#x = this.config.spawnX;
    this.#y = this.config.spawnY;
    this.#previousX = this.config.spawnX;
    this.#previousY = this.config.spawnY;
    this.#facingX = -1;
    this.#facingY = 0;
    this.#state = "approaching";
    this.#windupTicksRemaining = 0;
    this.#cadenceTicksRemaining = 0;
    this.#attackCount = 0;
    this.#damageAttemptCount = 0;
    this.#damageAppliedCount = 0;
  }

  public diagnostics(): SimpleMeleeEnemyDiagnostics {
    const health = this.#health.health;
    return {
      id: this.config.id,
      x: this.#x,
      y: this.#y,
      previousX: this.#previousX,
      previousY: this.#previousY,
      radius: this.config.radius,
      health: health.current,
      maxHealth: health.max,
      dead: health.dead,
      state: this.#state,
      facingX: this.#facingX,
      facingY: this.#facingY,
      windupTicksRemaining: this.#windupTicksRemaining,
      cadenceTicksRemaining: this.#cadenceTicksRemaining,
      attackCount: this.#attackCount,
      damageAttemptCount: this.#damageAttemptCount,
      damageAppliedCount: this.#damageAppliedCount,
    };
  }

  private beginWindup(): void {
    this.#state = "windup";
    this.#windupTicksRemaining = this.config.attackWindupTicks;
    this.#attackCount += 1;
  }

  private resolveAttack(applyPlayerDamage: PlayerDamageApplicator): void {
    this.#damageAttemptCount += 1;
    const result = applyPlayerDamage({
      amount: this.config.attackDamage,
      sourceId: this.config.id,
    });
    if (result.applied > 0) {
      this.#damageAppliedCount += 1;
    }
    if (result.died) {
      this.cancelAttack("idle");
      return;
    }
    this.#state = "recovering";
    this.#cadenceTicksRemaining =
      this.config.attackIntervalTicks - this.config.attackWindupTicks;
  }

  private cancelAttack(nextState: MeleeEnemyState): void {
    this.#state = nextState;
    this.#windupTicksRemaining = 0;
    this.#cadenceTicksRemaining = 0;
  }
}

function validateConfig(config: SimpleMeleeEnemyConfig): void {
  if (config.id.length === 0) {
    throw new RangeError("Melee enemy ID must not be empty.");
  }
  const finitePositive = [
    config.radius,
    config.maxHealth,
    config.moveSpeed,
    config.meleeRange,
    config.attackDamage,
  ];
  if (
    !Number.isFinite(config.spawnX) ||
    !Number.isFinite(config.spawnY) ||
    finitePositive.some((value) => !Number.isFinite(value) || value <= 0) ||
    !Number.isSafeInteger(config.attackWindupTicks) ||
    config.attackWindupTicks < 1 ||
    !Number.isSafeInteger(config.attackIntervalTicks) ||
    config.attackIntervalTicks <= config.attackWindupTicks
  ) {
    throw new RangeError("Melee enemy configuration is invalid.");
  }
}

import { FIXED_TICKS_PER_SECOND, type FixedStep } from "./fixed-step";
import { HealthPool, type DamageRequest, type DamageResult } from "./health";
import { PresentationKind, TechnicalEntityLifecycle } from "./entity-lifecycle";
import type { RuntimeEntityId } from "./ids";

export type AttackPhase = "idle" | "startup" | "active" | "recovery";

export interface PrimaryAttackConfig {
  readonly startupTicks: number;
  readonly activeTicks: number;
  readonly recoveryTicks: number;
  readonly damage: number;
  readonly range: number;
  readonly halfAngleDegrees: number;
}

export interface CombatArenaConfig {
  readonly width: number;
  readonly height: number;
  readonly playerRadius: number;
  readonly playerMaxHealth: number;
  readonly moveSpeed: number;
  readonly dodgeSpeed: number;
  readonly dodgeDurationSeconds: number;
  readonly dodgeCooldownSeconds: number;
  readonly primaryAttack: PrimaryAttackConfig;
}

export interface CombatTargetRegistration {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxHealth: number;
}

export interface CombatTargetReadModel extends CombatTargetRegistration {
  readonly health: number;
  readonly dead: boolean;
}

export type CombatArenaEvent =
  | {
      readonly type: "attack-started";
      readonly tick: number;
      readonly executionId: number;
      readonly aimX: number;
      readonly aimY: number;
    }
  | {
      readonly type: "damage-applied";
      readonly tick: number;
      readonly sourceId: string;
      readonly targetId: string;
      readonly amount: number;
      readonly currentHealth: number;
    }
  | {
      readonly type: "damage-ignored";
      readonly tick: number;
      readonly targetId: string;
      readonly reason: "dead" | "invulnerable";
    }
  | {
      readonly type: "entity-died";
      readonly tick: number;
      readonly entityId: string;
    };

export interface CombatArenaEventReader {
  drainEvents(): readonly CombatArenaEvent[];
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
  readonly playerHealth: number;
  readonly playerMaxHealth: number;
  readonly playerDead: boolean;
  readonly attackPhase: AttackPhase;
  readonly attackPhaseTicksRemaining: number;
  readonly attackExecutionId: number;
  readonly attackCount: number;
  readonly attackAimX: number;
  readonly attackAimY: number;
  readonly attackHitCount: number;
  readonly targets: readonly CombatTargetReadModel[];
  readonly eventCount: number;
}

export const DEFAULT_COMBAT_ARENA_CONFIG: CombatArenaConfig = {
  width: 1_200,
  height: 800,
  playerRadius: 18,
  playerMaxHealth: 100,
  moveSpeed: 190,
  dodgeSpeed: 510,
  dodgeDurationSeconds: 0.18,
  dodgeCooldownSeconds: 0.8,
  primaryAttack: {
    startupTicks: 4,
    activeTicks: 3,
    recoveryTicks: 8,
    damage: 25,
    range: 110,
    halfAngleDegrees: 55,
  },
};

function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * FIXED_TICKS_PER_SECOND));
}

interface MutableCombatTarget {
  registration: CombatTargetRegistration;
  readonly health: HealthPool;
}

export class CombatArenaSimulation implements CombatArenaEventReader {
  readonly #dodgeDurationTicks: number;
  readonly #dodgeCooldownTicks: number;
  readonly #lifecycle = new TechnicalEntityLifecycle(1);
  readonly #playerId: RuntimeEntityId;
  readonly #playerHealth: HealthPool;
  readonly #targets = new Map<string, MutableCombatTarget>();
  readonly #events: CombatArenaEvent[] = [];
  readonly #attackHitTargets = new Set<string>();
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
  #attackRequested = false;
  #attackPhase: AttackPhase = "idle";
  #attackPhaseTicksRemaining = 0;
  #attackExecutionId = 0;
  #attackCount = 0;
  #attackAimX = 1;
  #attackAimY = 0;
  #attackHitCount = 0;

  public constructor(
    readonly config: CombatArenaConfig = DEFAULT_COMBAT_ARENA_CONFIG,
  ) {
    this.validateConfig(config);
    this.#dodgeDurationTicks = secondsToTicks(config.dodgeDurationSeconds);
    this.#dodgeCooldownTicks = secondsToTicks(config.dodgeCooldownSeconds);
    this.#playerHealth = new HealthPool(config.playerMaxHealth);
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

  public requestPrimaryAttack(): void {
    this.#attackRequested = true;
  }

  public registerTarget(registration: CombatTargetRegistration): void {
    this.validateTarget(registration);
    if (this.#targets.has(registration.id)) {
      throw new Error(
        `Combat target "${registration.id}" is already registered.`,
      );
    }
    this.#targets.set(registration.id, {
      registration: { ...registration },
      health: new HealthPool(registration.maxHealth),
    });
  }

  public removeTarget(id: string): boolean {
    return this.#targets.delete(id);
  }

  public setTargetPosition(id: string, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("Combat target position must be finite.");
    }
    const target = this.#targets.get(id);
    if (target === undefined) {
      throw new Error(`Combat target "${id}" is not registered.`);
    }
    target.registration = { ...target.registration, x, y };
  }

  public applyPlayerDamage(request: DamageRequest): DamageResult {
    const result = this.#playerHealth.applyDamage(
      request,
      this.#dodgeTicksRemaining > 0,
    );
    if (result.ignoredReason !== null) {
      this.#events.push({
        type: "damage-ignored",
        tick: this.#tick,
        targetId: "player",
        reason: result.ignoredReason,
      });
      return result;
    }
    if (result.applied > 0) {
      this.#events.push({
        type: "damage-applied",
        tick: this.#tick,
        sourceId: request.sourceId ?? "unknown",
        targetId: "player",
        amount: result.applied,
        currentHealth: result.currentHealth,
      });
    }
    if (result.died) {
      this.#events.push({
        type: "entity-died",
        tick: this.#tick,
        entityId: "player",
      });
      this.cancelPlayerActions();
    }
    return result;
  }

  public step(step: FixedStep): void {
    this.#tick = step.tick + 1;
    this.#lifecycle.transforms.snapshot();

    if (
      !this.#playerHealth.health.dead &&
      this.#dodgeRequested &&
      this.#cooldownTicksRemaining === 0 &&
      this.#dodgeTicksRemaining === 0
    ) {
      this.beginDodge();
    }
    this.#dodgeRequested = false;

    if (
      !this.#playerHealth.health.dead &&
      this.#attackRequested &&
      this.#attackPhase === "idle" &&
      this.#dodgeTicksRemaining === 0
    ) {
      this.beginAttack();
    }
    this.#attackRequested = false;

    const dodging =
      !this.#playerHealth.health.dead && this.#dodgeTicksRemaining > 0;
    const directionX = dodging ? this.#dodgeX : this.#movementX;
    const directionY = dodging ? this.#dodgeY : this.#movementY;
    const speed = dodging ? this.config.dodgeSpeed : this.config.moveSpeed;
    const transformIndex = this.playerTransformIndex();
    if (!this.#playerHealth.health.dead) {
      this.#lifecycle.transforms.x[transformIndex] =
        (this.#lifecycle.transforms.x[transformIndex] ?? 0) +
        directionX * speed * step.deltaSeconds;
      this.#lifecycle.transforms.y[transformIndex] =
        (this.#lifecycle.transforms.y[transformIndex] ?? 0) +
        directionY * speed * step.deltaSeconds;
    }
    this.clampToArena();

    this.advanceAttack();
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
    this.#playerHealth.reset();
    for (const target of this.#targets.values()) {
      target.health.reset();
    }
    this.#attackRequested = false;
    this.#attackPhase = "idle";
    this.#attackPhaseTicksRemaining = 0;
    this.#attackExecutionId = 0;
    this.#attackCount = 0;
    this.#attackAimX = 1;
    this.#attackAimY = 0;
    this.#attackHitCount = 0;
    this.#attackHitTargets.clear();
    this.#events.length = 0;
  }

  public drainEvents(): readonly CombatArenaEvent[] {
    return this.#events.splice(0);
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
      playerHealth: this.#playerHealth.health.current,
      playerMaxHealth: this.#playerHealth.health.max,
      playerDead: this.#playerHealth.health.dead,
      attackPhase: this.#attackPhase,
      attackPhaseTicksRemaining: this.#attackPhaseTicksRemaining,
      attackExecutionId: this.#attackExecutionId,
      attackCount: this.#attackCount,
      attackAimX: this.#attackAimX,
      attackAimY: this.#attackAimY,
      attackHitCount: this.#attackHitCount,
      targets: [...this.#targets.values()].map((target) => ({
        ...target.registration,
        health: target.health.health.current,
        dead: target.health.health.dead,
      })),
      eventCount: this.#events.length,
    };
  }

  private beginAttack(): void {
    this.#attackExecutionId += 1;
    this.#attackCount += 1;
    this.#attackAimX = this.#facingX;
    this.#attackAimY = this.#facingY;
    this.#attackHitCount = 0;
    this.#attackHitTargets.clear();
    this.#attackPhase =
      this.config.primaryAttack.startupTicks > 0 ? "startup" : "active";
    this.#attackPhaseTicksRemaining =
      this.#attackPhase === "startup"
        ? this.config.primaryAttack.startupTicks
        : this.config.primaryAttack.activeTicks;
    this.#events.push({
      type: "attack-started",
      tick: this.#tick,
      executionId: this.#attackExecutionId,
      aimX: this.#attackAimX,
      aimY: this.#attackAimY,
    });
  }

  private advanceAttack(): void {
    if (this.#attackPhase === "idle") {
      return;
    }
    if (this.#attackPhase === "active") {
      this.applyAttackHits();
    }
    this.#attackPhaseTicksRemaining -= 1;
    if (this.#attackPhaseTicksRemaining > 0) {
      return;
    }
    if (this.#attackPhase === "startup") {
      this.#attackPhase = "active";
      this.#attackPhaseTicksRemaining = this.config.primaryAttack.activeTicks;
    } else if (this.#attackPhase === "active") {
      if (this.config.primaryAttack.recoveryTicks > 0) {
        this.#attackPhase = "recovery";
        this.#attackPhaseTicksRemaining =
          this.config.primaryAttack.recoveryTicks;
      } else {
        this.finishAttack();
      }
    } else {
      this.finishAttack();
    }
  }

  private finishAttack(): void {
    this.#attackPhase = "idle";
    this.#attackPhaseTicksRemaining = 0;
    this.#attackHitTargets.clear();
  }

  private applyAttackHits(): void {
    const transformIndex = this.playerTransformIndex();
    const playerX = this.#lifecycle.transforms.x[transformIndex] ?? 0;
    const playerY = this.#lifecycle.transforms.y[transformIndex] ?? 0;
    const attack = this.config.primaryAttack;
    const minimumDot = Math.cos((attack.halfAngleDegrees * Math.PI) / 180);

    for (const [targetId, target] of this.#targets) {
      if (target.health.health.dead || this.#attackHitTargets.has(targetId)) {
        continue;
      }
      const deltaX = target.registration.x - playerX;
      const deltaY = target.registration.y - playerY;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance > attack.range + target.registration.radius) {
        continue;
      }
      const dot =
        distance === 0
          ? 1
          : (deltaX * this.#attackAimX + deltaY * this.#attackAimY) / distance;
      if (dot < minimumDot) {
        continue;
      }

      this.#attackHitTargets.add(targetId);
      const result = target.health.applyDamage({
        amount: attack.damage,
        sourceId: "player",
      });
      if (result.applied > 0) {
        this.#attackHitCount += 1;
        this.#events.push({
          type: "damage-applied",
          tick: this.#tick,
          sourceId: "player",
          targetId,
          amount: result.applied,
          currentHealth: result.currentHealth,
        });
      }
      if (result.died) {
        this.#events.push({
          type: "entity-died",
          tick: this.#tick,
          entityId: targetId,
        });
      }
    }
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

  private cancelPlayerActions(): void {
    this.#movementX = 0;
    this.#movementY = 0;
    this.#dodgeRequested = false;
    this.#dodgeTicksRemaining = 0;
    this.#attackRequested = false;
    this.#attackPhase = "idle";
    this.#attackPhaseTicksRemaining = 0;
    this.#attackHitTargets.clear();
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
      config.playerMaxHealth,
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
    const attack = config.primaryAttack;
    if (
      !Number.isSafeInteger(attack.startupTicks) ||
      attack.startupTicks < 0 ||
      !Number.isSafeInteger(attack.activeTicks) ||
      attack.activeTicks < 1 ||
      !Number.isSafeInteger(attack.recoveryTicks) ||
      attack.recoveryTicks < 0 ||
      !Number.isFinite(attack.damage) ||
      attack.damage <= 0 ||
      !Number.isFinite(attack.range) ||
      attack.range <= 0 ||
      !Number.isFinite(attack.halfAngleDegrees) ||
      attack.halfAngleDegrees <= 0 ||
      attack.halfAngleDegrees > 180
    ) {
      throw new RangeError("Primary attack configuration is invalid.");
    }
  }

  private validateTarget(target: CombatTargetRegistration): void {
    if (target.id.length === 0) {
      throw new RangeError("Combat target ID must not be empty.");
    }
    const values = [target.x, target.y, target.radius, target.maxHealth];
    if (
      values.some((value) => !Number.isFinite(value)) ||
      target.radius <= 0 ||
      target.maxHealth <= 0
    ) {
      throw new RangeError("Combat target values must be finite and positive.");
    }
  }
}

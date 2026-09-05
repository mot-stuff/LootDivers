import { FIXED_TICKS_PER_SECOND, type FixedStep } from "./fixed-step";
import { AbilityExecutionEngine } from "./ability-runtime";
import type {
  AbilityCooldownHandle,
  AbilityExecutionSnapshot,
  AbilityRequestResult,
  AbilityStatRead,
  AbilityTarget,
  ResourcePaymentHandle,
  ResourceReservationHandle,
} from "./ability-runtime-contracts";
import {
  ABILITY_DAMAGE_EXECUTOR_ID,
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  MANA_RESOURCE_ID,
  OUTGOING_DAMAGE_STAT_ID,
  RefreshingStatusStore,
  WINTER_PULSE_ID,
  damageAfterModifier,
  definitionById,
  pointInArea,
  sweptCircleHitFraction,
  targetMatches,
  type CombatAbilityId,
} from "./combat-abilities";
import { HealthPool, type DamageRequest, type DamageResult } from "./health";
import { PresentationKind, TechnicalEntityLifecycle } from "./entity-lifecycle";
import type { RuntimeEntityId } from "./ids";
import { Mulberry32 } from "./random";
import {
  SimpleMeleeEnemy,
  type SimpleMeleeEnemyConfig,
  type SimpleMeleeEnemyDiagnostics,
} from "./simple-melee-enemy";

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
  readonly enemy: SimpleMeleeEnemyConfig;
}

export interface CombatTargetReadModel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly maxHealth: number;
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
    }
  | {
      readonly type: "ability-activated";
      readonly tick: number;
      readonly abilityId: CombatAbilityId;
      readonly x: number;
      readonly y: number;
    };

export interface CombatProjectileReadModel {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly abilityId: CombatAbilityId;
}

export interface CombatAreaFeedbackReadModel {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly abilityId: CombatAbilityId;
  readonly ticksRemaining: number;
}

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
  readonly mana: number;
  readonly maxMana: number;
  readonly cooldowns: Readonly<Record<CombatAbilityId, number>>;
  readonly statuses: readonly {
    readonly targetId: string;
    readonly statusId: "chilled" | "focused" | "weakened";
    readonly ticksRemaining: number;
  }[];
  readonly projectiles: readonly CombatProjectileReadModel[];
  readonly areaFeedback: readonly CombatAreaFeedbackReadModel[];
  readonly lastAbilityResult: {
    readonly abilityId: CombatAbilityId;
    readonly accepted: boolean;
    readonly reason?: string;
  } | null;
  readonly enemy: SimpleMeleeEnemyDiagnostics;
  readonly targets: readonly CombatTargetReadModel[];
  readonly eventCount: number;
}

export const DEFAULT_COMBAT_ARENA_CONFIG: CombatArenaConfig = {
  width: 1_200,
  height: 800,
  playerRadius: 18,
  playerMaxHealth: 100,
  moveSpeed: 260,
  dodgeSpeed: 650,
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
  enemy: {
    id: "enemy:melee-prototype",
    spawnX: 860,
    spawnY: 400,
    radius: 14,
    maxHealth: 50,
    moveSpeed: 165,
    meleeRange: 54,
    attackDamage: 10,
    attackWindupTicks: 18,
    attackIntervalTicks: 60,
  },
};

function secondsToTicks(seconds: number): number {
  return Math.max(1, Math.round(seconds * FIXED_TICKS_PER_SECOND));
}

export class CombatArenaSimulation implements CombatArenaEventReader {
  readonly #dodgeDurationTicks: number;
  readonly #dodgeCooldownTicks: number;
  readonly #lifecycle = new TechnicalEntityLifecycle(1);
  readonly #playerId: RuntimeEntityId;
  readonly #playerHealth: HealthPool;
  readonly #enemy: SimpleMeleeEnemy;
  readonly #events: CombatArenaEvent[] = [];
  readonly #attackHitTargets = new Set<string>();
  readonly #statuses = new RefreshingStatusStore();
  readonly #cooldownEnds = new Map<string, number>();
  readonly #payments = new Map<number, number>();
  readonly #projectiles: {
    id: number;
    x: number;
    y: number;
    directionX: number;
    directionY: number;
    distance: number;
    damage: number;
  }[] = [];
  readonly #areaFeedback: {
    id: number;
    x: number;
    y: number;
    radius: number;
    abilityId: CombatAbilityId;
    expiresAtTick: number;
  }[] = [];
  readonly #activeExecutions = new Map<number, AbilityExecutionSnapshot>();
  #abilityEngine: AbilityExecutionEngine;
  #manaSubunits = 1_000;
  #nextSettlementToken = 1;
  #nextCooldownToken = 1;
  #nextProjectileId = 1;
  #nextFeedbackId = 1;
  #lastAbilityResult: CombatArenaDiagnostics["lastAbilityResult"] = null;
  #pendingCleave:
    | { readonly damageMultiplier: number; readonly resolveAtTick: number }
    | undefined;
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
    this.#enemy = new SimpleMeleeEnemy(config.enemy);
    this.#playerId = this.#lifecycle.create(
      { x: config.width / 2, y: config.height / 2, elevation: 0 },
      PresentationKind.Actor,
    );
    this.#abilityEngine = this.createAbilityEngine();
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
    if (
      !this.#playerHealth.health.dead &&
      this.#attackPhase === "idle" &&
      this.#dodgeTicksRemaining === 0
    ) {
      this.beginAttack();
    }
  }

  public requestAbility(
    abilityId: CombatAbilityId,
    target?: AbilityTarget,
  ): AbilityRequestResult {
    const resolvedTarget =
      target ??
      (abilityId === DEFIANT_SIGNAL_ID
        ? { kind: "self" as const }
        : { kind: "direction" as const, x: this.#facingX, y: this.#facingY });
    const result = this.#abilityEngine.request({
      abilityId,
      sourceId: this.#playerId,
      target: resolvedTarget,
      requestedAtTick: this.#tick,
    });
    this.#lastAbilityResult = result.accepted
      ? { abilityId, accepted: true }
      : { abilityId, accepted: false, reason: result.reason };
    if (result.accepted && result.execution.stage !== "complete") {
      this.#activeExecutions.set(
        result.execution.executionId,
        result.execution,
      );
    }
    if (abilityId === BASIC_CLEAVE_ID && result.accepted) {
      this.#attackExecutionId = result.execution.executionId;
      this.#attackCount += 1;
      this.#attackAimX =
        result.execution.target.kind === "direction"
          ? result.execution.target.x
          : this.#facingX;
      this.#attackAimY =
        result.execution.target.kind === "direction"
          ? result.execution.target.y
          : this.#facingY;
      this.#attackHitCount = 0;
      this.#attackPhase = "startup";
      this.#attackPhaseTicksRemaining =
        definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0;
      this.#events.push({
        type: "attack-started",
        tick: this.#tick,
        executionId: this.#attackExecutionId,
        aimX: this.#attackAimX,
        aimY: this.#attackAimY,
      });
    }
    return result;
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
      this.#statuses.clear();
      this.#activeExecutions.clear();
      this.#projectiles.length = 0;
      this.#areaFeedback.length = 0;
    }
    return result;
  }

  public step(step: FixedStep): void {
    this.#tick = step.tick + 1;
    this.#lifecycle.transforms.snapshot();
    this.#statuses.expire(this.#tick);
    if (
      this.#pendingCleave !== undefined &&
      this.#tick >= this.#pendingCleave.resolveAtTick
    ) {
      this.applyAttackHits(this.#pendingCleave.damageMultiplier);
      this.#pendingCleave = undefined;
    }
    if (!this.#playerHealth.health.dead) {
      this.#manaSubunits = Math.min(1_000, this.#manaSubunits + 1);
    }
    for (let index = this.#areaFeedback.length - 1; index >= 0; index -= 1) {
      if ((this.#areaFeedback[index]?.expiresAtTick ?? 0) <= this.#tick) {
        this.#areaFeedback.splice(index, 1);
      }
    }

    if (
      !this.#playerHealth.health.dead &&
      this.#dodgeRequested &&
      this.#cooldownTicksRemaining === 0 &&
      this.#dodgeTicksRemaining === 0
    ) {
      this.beginDodge();
    }
    this.#dodgeRequested = false;

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

    this.advanceAbilityExecutions();
    const player = this.playerPosition();
    this.advanceProjectiles(step);
    this.#enemy.step(
      step,
      {
        x: player.x,
        y: player.y,
        dead: this.#playerHealth.health.dead,
      },
      (request) => this.applyPlayerDamage(request),
      {
        moveSpeedMultiplier: this.#statuses.has(this.config.enemy.id, "chilled")
          ? 0.7
          : 1,
        outgoingDamageMultiplier: this.#statuses.has(
          this.config.enemy.id,
          "weakened",
        )
          ? 0.8
          : 1,
      },
    );
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
    this.#enemy.reset();
    this.#attackPhase = "idle";
    this.#attackPhaseTicksRemaining = 0;
    this.#attackExecutionId = 0;
    this.#attackCount = 0;
    this.#attackAimX = 1;
    this.#attackAimY = 0;
    this.#attackHitCount = 0;
    this.#attackHitTargets.clear();
    this.#events.length = 0;
    this.#statuses.clear();
    this.#cooldownEnds.clear();
    this.#payments.clear();
    this.#projectiles.length = 0;
    this.#areaFeedback.length = 0;
    this.#activeExecutions.clear();
    this.#manaSubunits = 1_000;
    this.#nextSettlementToken = 1;
    this.#nextCooldownToken = 1;
    this.#nextProjectileId = 1;
    this.#nextFeedbackId = 1;
    this.#lastAbilityResult = null;
    this.#pendingCleave = undefined;
    this.#abilityEngine = this.createAbilityEngine();
  }

  public drainEvents(): readonly CombatArenaEvent[] {
    return this.#events.splice(0);
  }

  public diagnostics(): CombatArenaDiagnostics {
    const transformIndex = this.playerTransformIndex();
    const enemy = this.#enemy.diagnostics();
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
      mana: this.#manaSubunits / 10,
      maxMana: 100,
      cooldowns: {
        [BASIC_CLEAVE_ID]: this.cooldownRemaining(BASIC_CLEAVE_ID),
        [CINDER_DART_ID]: this.cooldownRemaining(CINDER_DART_ID),
        [WINTER_PULSE_ID]: this.cooldownRemaining(WINTER_PULSE_ID),
        [DEFIANT_SIGNAL_ID]: this.cooldownRemaining(DEFIANT_SIGNAL_ID),
      },
      statuses: this.#statuses.values().map((status) => ({
        targetId: status.targetId,
        statusId: status.statusId,
        ticksRemaining: status.expiresAtTick - this.#tick,
      })),
      projectiles: this.#projectiles.map((projectile) => ({
        id: projectile.id,
        x: projectile.x,
        y: projectile.y,
        radius: 6,
        abilityId: CINDER_DART_ID,
      })),
      areaFeedback: this.#areaFeedback.map((feedback) => ({
        id: feedback.id,
        x: feedback.x,
        y: feedback.y,
        radius: feedback.radius,
        abilityId: feedback.abilityId,
        ticksRemaining: feedback.expiresAtTick - this.#tick,
      })),
      lastAbilityResult: this.#lastAbilityResult,
      enemy,
      targets: [
        {
          id: enemy.id,
          x: enemy.x,
          y: enemy.y,
          radius: enemy.radius,
          maxHealth: enemy.maxHealth,
          health: enemy.health,
          dead: enemy.dead,
        },
      ],
      eventCount: this.#events.length,
    };
  }

  private beginAttack(): void {
    this.#attackHitTargets.clear();
    this.requestAbility(BASIC_CLEAVE_ID, {
      kind: "direction",
      x: this.#facingX,
      y: this.#facingY,
    });
  }

  private advanceAbilityExecutions(): void {
    for (const executionId of [...this.#activeExecutions.keys()]) {
      const next = this.#abilityEngine.advance(executionId, this.#tick);
      if (next.abilityId === BASIC_CLEAVE_ID) {
        this.#attackPhase =
          next.stage === "startup" ||
          next.stage === "active" ||
          next.stage === "recovery"
            ? next.stage
            : "idle";
        const definition = definitionById(BASIC_CLEAVE_ID);
        const duration =
          next.stage === "startup"
            ? definition?.timing.startupTicks
            : next.stage === "active"
              ? definition?.timing.activeTicks
              : next.stage === "recovery"
                ? definition?.timing.recoveryTicks
                : 0;
        this.#attackPhaseTicksRemaining = Math.max(
          0,
          (duration ?? 0) - next.stageElapsedTicks,
        );
        if (this.#attackPhase === "idle") this.#attackHitTargets.clear();
      }
      if (next.stage === "complete" || next.stage === "cancel") {
        this.#activeExecutions.delete(executionId);
      } else {
        this.#activeExecutions.set(executionId, next);
      }
    }
  }

  private applyAttackHits(damageMultiplier = 1): void {
    const transformIndex = this.playerTransformIndex();
    const playerX = this.#lifecycle.transforms.x[transformIndex] ?? 0;
    const playerY = this.#lifecycle.transforms.y[transformIndex] ?? 0;
    const attack = this.config.primaryAttack;
    const minimumDot = Math.cos((attack.halfAngleDegrees * Math.PI) / 180);

    const target = this.#enemy.diagnostics();
    if (target.dead || this.#attackHitTargets.has(target.id)) {
      return;
    }
    const deltaX = target.x - playerX;
    const deltaY = target.y - playerY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance > attack.range + target.radius) {
      return;
    }
    const dot =
      distance === 0
        ? 1
        : (deltaX * this.#attackAimX + deltaY * this.#attackAimY) / distance;
    if (dot < minimumDot) {
      return;
    }

    this.#attackHitTargets.add(target.id);
    const result = this.#enemy.applyDamage({
      amount: damageAfterModifier(attack.damage, damageMultiplier),
      sourceId: "player",
    });
    if (result.applied > 0) {
      this.#attackHitCount += 1;
      this.#events.push({
        type: "damage-applied",
        tick: this.#tick,
        sourceId: "player",
        targetId: target.id,
        amount: result.applied,
        currentHealth: result.currentHealth,
      });
    }
    if (result.died) {
      this.#statuses.clearTarget(target.id);
      this.#events.push({
        type: "entity-died",
        tick: this.#tick,
        entityId: target.id,
      });
    }
  }

  private createAbilityEngine(): AbilityExecutionEngine {
    return new AbilityExecutionEngine({
      definitions: { get: definitionById },
      resources: {
        canSpend: (_entityId, resourceId, amount) =>
          resourceId === MANA_RESOURCE_ID && this.#manaSubunits >= amount * 10,
        pay: (_entityId, _resourceId, amount): ResourcePaymentHandle => {
          const handle = {
            kind: "payment" as const,
            token: this.#nextSettlementToken++,
          };
          const subunits = amount * 10;
          this.#manaSubunits -= subunits;
          this.#payments.set(handle.token, subunits);
          return handle;
        },
        reserve: (
          _entityId,
          _resourceId,
          amount,
        ): ResourceReservationHandle => {
          const handle = {
            kind: "reservation" as const,
            token: this.#nextSettlementToken++,
          };
          const subunits = amount * 10;
          this.#manaSubunits -= subunits;
          this.#payments.set(handle.token, subunits);
          return handle;
        },
        refund: (handle) => {
          this.#manaSubunits += this.takePayment(handle.token);
        },
        commit: (handle) => {
          this.takePayment(handle.token);
        },
        release: (handle) => {
          this.#manaSubunits += this.takePayment(handle.token);
        },
      },
      cooldowns: {
        remainingTicks: (_entityId, abilityId, atTick) =>
          Math.max(0, (this.#cooldownEnds.get(abilityId) ?? atTick) - atTick),
        start: (
          entityId,
          abilityId,
          atTick,
          durationTicks,
        ): AbilityCooldownHandle => {
          const handle = {
            token: this.#nextCooldownToken++,
            entityId,
            abilityId,
          };
          this.#cooldownEnds.set(abilityId, atTick + durationTicks);
          return handle;
        },
        clear: (handle) => this.#cooldownEnds.delete(handle.abilityId),
      },
      stats: {
        read: (_entityId, statId) =>
          statId === OUTGOING_DAMAGE_STAT_ID &&
          this.#statuses.has("player", "focused")
            ? 1.2
            : 1,
      },
      targets: {
        validate: (request, definition) => {
          if (!targetMatches(request.target, definition.targeting.mode)) {
            return false;
          }
          if (request.target.kind === "direction") {
            return Math.hypot(request.target.x, request.target.y) > 0;
          }
          if (request.target.kind === "point") {
            const player = this.playerPosition();
            return (
              Math.hypot(
                request.target.x - player.x,
                request.target.y - player.y,
              ) <= definition.targeting.range
            );
          }
          return true;
        },
      },
      events: { publish: () => undefined },
      random: new Mulberry32(0x00c0_ba77),
      executors: {
        has: (kind) => kind === ABILITY_DAMAGE_EXECUTOR_ID,
        get: (kind) =>
          kind === ABILITY_DAMAGE_EXECUTOR_ID
            ? {
                execute: (_effect, context) => {
                  this.executeCombatAbility(
                    context.ability.id,
                    context.target,
                    (read) => context.readStat(read),
                  );
                },
              }
            : undefined,
      },
      triggerLimits: { maximumDepth: 2, maximumEffectsPerTick: 16 },
    });
  }

  private executeCombatAbility(
    abilityId: CombatAbilityId,
    target: AbilityTarget,
    readStat: (read: AbilityStatRead) => number,
  ): void {
    const player = this.playerPosition();
    const multiplier =
      abilityId === DEFIANT_SIGNAL_ID
        ? 1
        : readStat({
            subject: "source",
            statId: OUTGOING_DAMAGE_STAT_ID,
            policy: "snapshot",
          });
    if (abilityId === BASIC_CLEAVE_ID) {
      this.#pendingCleave = {
        damageMultiplier: multiplier,
        resolveAtTick: this.#tick + 1,
      };
    } else if (abilityId === CINDER_DART_ID && target.kind === "direction") {
      const length = Math.hypot(target.x, target.y);
      this.#projectiles.push({
        id: this.#nextProjectileId++,
        x: player.x,
        y: player.y,
        directionX: target.x / length,
        directionY: target.y / length,
        distance: 0,
        damage: damageAfterModifier(30, multiplier),
      });
    } else if (abilityId === WINTER_PULSE_ID && target.kind === "point") {
      this.#areaFeedback.push({
        id: this.#nextFeedbackId++,
        x: target.x,
        y: target.y,
        radius: 100,
        abilityId,
        expiresAtTick: this.#tick + 18,
      });
      const enemy = this.#enemy.diagnostics();
      if (
        !enemy.dead &&
        pointInArea(target.x, target.y, 100, enemy.x, enemy.y, enemy.radius)
      ) {
        this.damageEnemy(damageAfterModifier(20, multiplier));
        if (!this.#enemy.health.dead) {
          this.#statuses.apply(enemy.id, "chilled", this.#tick, 120);
        }
      }
    } else if (abilityId === DEFIANT_SIGNAL_ID) {
      this.#statuses.apply("player", "focused", this.#tick, 180);
      const enemy = this.#enemy.diagnostics();
      if (
        !enemy.dead &&
        pointInArea(player.x, player.y, 180, enemy.x, enemy.y, enemy.radius)
      ) {
        this.#statuses.apply(enemy.id, "weakened", this.#tick, 180);
      }
      this.#areaFeedback.push({
        id: this.#nextFeedbackId++,
        x: player.x,
        y: player.y,
        radius: 180,
        abilityId,
        expiresAtTick: this.#tick + 18,
      });
    }
    this.#events.push({
      type: "ability-activated",
      tick: this.#tick,
      abilityId,
      x: target.kind === "point" ? target.x : player.x,
      y: target.kind === "point" ? target.y : player.y,
    });
  }

  private advanceProjectiles(step: FixedStep): void {
    for (let index = this.#projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.#projectiles[index];
      if (projectile === undefined) continue;
      const travel = Math.min(
        600 * step.deltaSeconds,
        600 - projectile.distance,
      );
      const endX = projectile.x + projectile.directionX * travel;
      const endY = projectile.y + projectile.directionY * travel;
      const enemy = this.#enemy.diagnostics();
      const hit = enemy.dead
        ? null
        : sweptCircleHitFraction(
            projectile.x,
            projectile.y,
            endX,
            endY,
            6,
            enemy.x,
            enemy.y,
            enemy.radius,
          );
      if (hit !== null) {
        projectile.x += (endX - projectile.x) * hit;
        projectile.y += (endY - projectile.y) * hit;
        this.damageEnemy(projectile.damage);
        this.#projectiles.splice(index, 1);
        continue;
      }
      projectile.x = endX;
      projectile.y = endY;
      projectile.distance += travel;
      if (projectile.distance >= 600) this.#projectiles.splice(index, 1);
    }
  }

  private damageEnemy(amount: number): void {
    const target = this.#enemy.diagnostics();
    const result = this.#enemy.applyDamage({ amount, sourceId: "player" });
    if (result.applied > 0) {
      this.#events.push({
        type: "damage-applied",
        tick: this.#tick,
        sourceId: "player",
        targetId: target.id,
        amount: result.applied,
        currentHealth: result.currentHealth,
      });
    }
    if (result.died) {
      this.#statuses.clearTarget(target.id);
      this.#events.push({
        type: "entity-died",
        tick: this.#tick,
        entityId: target.id,
      });
    }
  }

  private takePayment(token: number): number {
    const amount = this.#payments.get(token);
    if (amount === undefined)
      throw new Error(`Unknown mana settlement ${token}.`);
    this.#payments.delete(token);
    return amount;
  }

  private cooldownRemaining(abilityId: CombatAbilityId): number {
    return Math.max(
      0,
      (this.#cooldownEnds.get(abilityId) ?? this.#tick) - this.#tick,
    );
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
    this.#attackPhase = "idle";
    this.#attackPhaseTicksRemaining = 0;
    this.#attackExecutionId = 0;
    this.#attackCount = 0;
    this.#attackHitCount = 0;
    this.#attackHitTargets.clear();
    this.#pendingCleave = undefined;
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

  private playerPosition(): { readonly x: number; readonly y: number } {
    const index = this.playerTransformIndex();
    return {
      x: this.#lifecycle.transforms.x[index] ?? 0,
      y: this.#lifecycle.transforms.y[index] ?? 0,
    };
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
}

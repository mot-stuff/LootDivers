import { FIXED_TICKS_PER_SECOND, type FixedStep } from "./fixed-step";
import { AbilityExecutionEngine } from "./ability-runtime";
import type {
  AbilityCooldownHandle,
  AbilityExecutionSnapshot,
  AbilityRejectionReason,
  AbilityRequestResult,
  AbilityStatRead,
  AbilityTarget,
  CustomAbilityEffect,
  ResourcePaymentHandle,
  ResourceReservationHandle,
} from "./ability-runtime-contracts";
import {
  ABILITY_DAMAGE_EXECUTOR_ID,
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  COMBAT_ABILITY_DEFINITIONS,
  DEFIANT_SIGNAL_ID,
  MANA_RESOURCE_ID,
  MOVE_SPEED_STAT_ID,
  OUTGOING_DAMAGE_STAT_ID,
  RefreshingStatusStore,
  WINTER_PULSE_ID,
  damageAfterModifier,
  pointInArea,
  sweptCircleHitFraction,
  targetMatches,
  type CombatEffectParameter,
  type CombatAbilityId,
  type CombatAbilityDefinition,
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
import {
  CharacterItemLoadout,
  type EquipmentStats,
  type EquipResult,
  type LoadoutAssignmentResult,
  type LoadoutSlot,
  type StoneConsumptionResult,
} from "./item-loadout";
import type { EquipmentSlot } from "./item-catalog";
import type { EquipmentItemInstance, ItemInstance } from "./item-generation";
import type { InventoryAddResult } from "./inventory";
import {
  DEFAULT_ENEMY_LOOT_WEIGHTS,
  DeterministicEnemyLootGenerator,
  type EnemyLootWeights,
  type WorldLootDrop,
} from "./enemy-loot";

export type AttackPhase = "idle" | "startup" | "active" | "recovery";

export interface CombatArenaConfig {
  readonly width: number;
  readonly height: number;
  readonly playerRadius: number;
  readonly playerMaxHealth: number;
  readonly moveSpeed: number;
  readonly dodgeSpeed: number;
  readonly dodgeDurationSeconds: number;
  readonly dodgeCooldownSeconds: number;
  readonly loot: {
    readonly seed: number;
    readonly pickupRadius: number;
    readonly rarityWeights: EnemyLootWeights;
  };
  readonly abilityDefinitions: readonly CombatAbilityDefinition[];
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
    }
  | {
      readonly type: "loot-dropped";
      readonly tick: number;
      readonly drop: WorldLootDrop;
    }
  | {
      readonly type: "loot-picked";
      readonly tick: number;
      readonly dropId: string;
      readonly item: ItemInstance;
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

export type CombatAbilityActivationKind =
  | "ready"
  | "unknown"
  | "executing"
  | "busy"
  | "defeated"
  | "cooldown"
  | "insufficient-resource";

export interface CombatAbilityActivationReadModel {
  readonly abilityId: CombatAbilityId;
  readonly kind: CombatAbilityActivationKind;
  readonly canActivate: boolean;
  readonly rejectionReason?: AbilityRejectionReason;
  readonly cooldownTicksRemaining: number;
  readonly manaCost: number;
  readonly currentExecution: AbilityExecutionSnapshot | null;
}

export interface CombatArenaEventReader {
  drainEvents(): readonly CombatArenaEvent[];
}

export interface CharacterItemLoadoutReadModel {
  readonly inventory: readonly (ItemInstance | null)[];
  readonly equipment: Readonly<
    Record<EquipmentSlot, EquipmentItemInstance | null>
  >;
  readonly ownedAbilities: readonly CombatAbilityId[];
  readonly assignments: Readonly<Record<LoadoutSlot, CombatAbilityId | null>>;
  readonly stats: EquipmentStats;
}

export type CombatSlotRequestResult =
  | AbilityRequestResult
  | {
      readonly accepted: false;
      readonly reason: "slot-empty";
      readonly history: readonly [];
    };

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
  readonly abilities: readonly CombatAbilityActivationReadModel[];
  readonly currentExecution: AbilityExecutionSnapshot | null;
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
  readonly worldLoot: readonly WorldLootDrop[];
  readonly enemyKillCount: number;
  readonly lootDropCount: number;
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
  loot: {
    seed: 0x10_07_5eed,
    pickupRadius: 36,
    rarityWeights: DEFAULT_ENEMY_LOOT_WEIGHTS,
  },
  abilityDefinitions: COMBAT_ABILITY_DEFINITIONS,
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
  readonly #characterItems = new CharacterItemLoadout();
  readonly #lootGenerator: DeterministicEnemyLootGenerator;
  readonly #worldLoot: WorldLootDrop[] = [];
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
    radius: number;
    speedPerSecond: number;
    maximumRange: number;
    abilityId: CombatAbilityId;
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
  #nextLootDropId = 1;
  #lastAbilityResult: CombatArenaDiagnostics["lastAbilityResult"] = null;
  #pendingCleave:
    | {
        readonly damage: number;
        readonly range: number;
        readonly halfAngleDegrees: number;
        readonly aimX: number;
        readonly aimY: number;
        readonly resolveAtTick: number;
      }
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
    this.#playerHealth = new HealthPool(this.characterStats().maximumHealth);
    this.#enemy = new SimpleMeleeEnemy(config.enemy);
    this.#lootGenerator = new DeterministicEnemyLootGenerator(config.loot);
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
    if (this.#dodgeTicksRemaining === 0) {
      this.requestAbilitySlot("lmb");
    }
  }

  public requestAbilitySlot(
    slot: LoadoutSlot,
    target?: AbilityTarget,
  ): CombatSlotRequestResult {
    const abilityId = this.#characterItems.loadout()[slot];
    if (abilityId === null) {
      return { accepted: false, reason: "slot-empty", history: [] };
    }
    return this.requestAbility(
      abilityId,
      this.resolveSlotTarget(abilityId, target),
    );
  }

  public addCharacterItem(item: ItemInstance): InventoryAddResult {
    return this.#characterItems.addItem(item);
  }

  public equipCharacterItem(inventoryIndex: number): EquipResult {
    const result = this.#characterItems.equipFromInventory(inventoryIndex);
    if (result.accepted) this.synchronizeEquipmentHealth();
    return result;
  }

  public unequipCharacterItem(slot: EquipmentSlot): InventoryAddResult {
    const result = this.#characterItems.unequip(slot);
    if (result.accepted) this.synchronizeEquipmentHealth();
    return result;
  }

  public consumeCharacterAbilityStone(
    inventoryIndex: number,
    selectedAbilityId: CombatAbilityId,
  ): StoneConsumptionResult {
    return this.#characterItems.consumeAbilityStone(
      inventoryIndex,
      selectedAbilityId,
    );
  }

  public assignAbilitySlot(
    slot: LoadoutSlot,
    abilityId: CombatAbilityId | null,
  ): LoadoutAssignmentResult {
    return this.#characterItems.assignAbility(slot, abilityId);
  }

  public characterItemLoadout(): CharacterItemLoadoutReadModel {
    return {
      inventory: this.#characterItems.inventorySlots(),
      equipment: this.#characterItems.equipment(),
      ownedAbilities: this.#characterItems.ownedAbilities(),
      assignments: this.#characterItems.loadout(),
      stats: this.characterStats(),
    };
  }

  public abilityActivation(
    abilityId: CombatAbilityId,
  ): CombatAbilityActivationReadModel {
    const definition = this.definitionById(abilityId);
    const currentExecution = this.currentExecution();
    const cooldownTicksRemaining = this.cooldownRemaining(abilityId);
    const manaCost =
      definition?.costs
        .filter((cost) => cost.resourceId === MANA_RESOURCE_ID)
        .reduce((total, cost) => total + cost.amount, 0) ?? 0;
    const unavailable = (
      kind: Exclude<CombatAbilityActivationKind, "ready">,
      rejectionReason: AbilityRejectionReason,
    ): CombatAbilityActivationReadModel => ({
      abilityId,
      kind,
      canActivate: false,
      rejectionReason,
      cooldownTicksRemaining,
      manaCost,
      currentExecution,
    });

    if (this.#playerHealth.health.dead) {
      return unavailable("defeated", "player-defeated");
    }
    if (definition === undefined) {
      return unavailable("unknown", "ability-unknown");
    }
    if (currentExecution !== null) {
      return unavailable(
        currentExecution.abilityId === abilityId ? "executing" : "busy",
        "ability-busy",
      );
    }
    if (cooldownTicksRemaining > 0) {
      return unavailable("cooldown", "cooldown-active");
    }
    if (definition !== undefined && this.#manaSubunits < manaCost * 10) {
      return unavailable("insufficient-resource", "insufficient-resource");
    }
    return {
      abilityId,
      kind: "ready",
      canActivate: true,
      cooldownTicksRemaining,
      manaCost,
      currentExecution: null,
    };
  }

  public requestAbility(
    abilityId: CombatAbilityId,
    target?: AbilityTarget,
  ): AbilityRequestResult {
    const activation = this.abilityActivation(abilityId);
    if (!activation.canActivate) {
      const result: AbilityRequestResult = {
        accepted: false,
        reason: activation.rejectionReason ?? "ability-busy",
        history: [
          { stage: "request", tick: this.#tick },
          { stage: "validate", tick: this.#tick },
          { stage: "reject", tick: this.#tick },
        ],
      };
      this.#lastAbilityResult = {
        abilityId,
        accepted: false,
        reason: result.reason,
      };
      return result;
    }
    const definition = this.definitionById(abilityId);
    const resolvedTarget =
      target ??
      (definition?.targeting.mode === "self"
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
      this.#attackHitTargets.clear();
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
        this.definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0;
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
      this.applyAttackHits(this.#pendingCleave);
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
        moveSpeedMultiplier: this.#statuses.multiplier(
          this.config.enemy.id,
          MOVE_SPEED_STAT_ID,
        ),
        outgoingDamageMultiplier: this.#statuses.multiplier(
          this.config.enemy.id,
          OUTGOING_DAMAGE_STAT_ID,
        ),
      },
    );
    this.pickUpNearbyLoot();
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
      abilities: [
        BASIC_CLEAVE_ID,
        CINDER_DART_ID,
        WINTER_PULSE_ID,
        DEFIANT_SIGNAL_ID,
      ].map((abilityId) => this.abilityActivation(abilityId)),
      currentExecution: this.currentExecution(),
      statuses: this.#statuses.values().map((status) => ({
        targetId: status.targetId,
        statusId: status.statusId,
        ticksRemaining: status.expiresAtTick - this.#tick,
      })),
      projectiles: this.#projectiles.map((projectile) => ({
        id: projectile.id,
        x: projectile.x,
        y: projectile.y,
        radius: projectile.radius,
        abilityId: projectile.abilityId,
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
      worldLoot: [...this.#worldLoot],
      enemyKillCount: this.#lootGenerator.killsGenerated(),
      lootDropCount: this.#nextLootDropId - 1,
      eventCount: this.#events.length,
    };
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
        const definition = this.definitionById(BASIC_CLEAVE_ID);
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

  private applyAttackHits(attack: {
    readonly damage: number;
    readonly range: number;
    readonly halfAngleDegrees: number;
    readonly aimX: number;
    readonly aimY: number;
  }): void {
    const transformIndex = this.playerTransformIndex();
    const playerX = this.#lifecycle.transforms.x[transformIndex] ?? 0;
    const playerY = this.#lifecycle.transforms.y[transformIndex] ?? 0;
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
        : (deltaX * attack.aimX + deltaY * attack.aimY) / distance;
    if (dot < minimumDot) {
      return;
    }

    this.#attackHitTargets.add(target.id);
    const result = this.#enemy.applyDamage({
      amount: attack.damage,
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
      this.handleEnemyDeath(target);
    }
  }

  private createAbilityEngine(): AbilityExecutionEngine {
    return new AbilityExecutionEngine({
      definitions: { get: (id) => this.definitionById(id) },
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
        read: (_entityId, statId) => {
          const temporaryMultiplier = this.#statuses.multiplier(
            "player",
            statId,
          );
          return statId === OUTGOING_DAMAGE_STAT_ID
            ? this.characterStats().outgoingAbilityDamageMultiplier *
                temporaryMultiplier
            : temporaryMultiplier;
        },
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
                execute: (effect, context) => {
                  this.executeCombatAbility(
                    effect as CustomAbilityEffect<
                      readonly CombatEffectParameter[]
                    >,
                    context.target,
                    (read) => context.readStat(read),
                    context.ability.id,
                    context.effectIndex,
                  );
                },
              }
            : undefined,
      },
      triggerLimits: { maximumDepth: 2, maximumEffectsPerTick: 16 },
    });
  }

  private executeCombatAbility(
    effect: CustomAbilityEffect<readonly CombatEffectParameter[]>,
    target: AbilityTarget,
    readStat: (read: AbilityStatRead) => number,
    abilityId: CombatAbilityId,
    effectIndex: number,
  ): void {
    const player = this.playerPosition();
    const parameters = effect.parameters[0]?.value;
    if (parameters === undefined) {
      throw new Error(`Combat effect "${abilityId}" has no parameters.`);
    }
    const damageMultiplier =
      parameters.kind === "cone-damage" ||
      parameters.kind === "projectile" ||
      parameters.kind === "area-damage"
        ? readStat({
            subject: "source",
            statId: OUTGOING_DAMAGE_STAT_ID,
            policy: "snapshot",
          })
        : 1;
    if (parameters.kind === "cone-damage" && target.kind === "direction") {
      const length = Math.hypot(target.x, target.y);
      this.#pendingCleave = {
        damage: damageAfterModifier(parameters.damage, damageMultiplier),
        range: parameters.range,
        halfAngleDegrees: parameters.halfAngleDegrees,
        aimX: target.x / length,
        aimY: target.y / length,
        resolveAtTick: this.#tick + 1,
      };
    } else if (
      parameters.kind === "projectile" &&
      target.kind === "direction"
    ) {
      const length = Math.hypot(target.x, target.y);
      this.#projectiles.push({
        id: this.#nextProjectileId++,
        x: player.x,
        y: player.y,
        directionX: target.x / length,
        directionY: target.y / length,
        distance: 0,
        damage: damageAfterModifier(parameters.damage, damageMultiplier),
        radius: parameters.radius,
        speedPerSecond: parameters.speedPerSecond,
        maximumRange: parameters.maximumRange,
        abilityId,
      });
    } else if (parameters.kind === "area-damage") {
      const center = target.kind === "point" ? target : player;
      this.addAreaFeedback(
        abilityId,
        center.x,
        center.y,
        parameters.radius,
        parameters.feedbackTicks,
      );
      const enemy = this.#enemy.diagnostics();
      if (
        !enemy.dead &&
        pointInArea(
          center.x,
          center.y,
          parameters.radius,
          enemy.x,
          enemy.y,
          enemy.radius,
        )
      ) {
        this.damageEnemy(
          damageAfterModifier(parameters.damage, damageMultiplier),
        );
      }
    } else if (parameters.kind === "area-status") {
      const center = target.kind === "point" ? target : player;
      this.addAreaFeedback(
        abilityId,
        center.x,
        center.y,
        parameters.radius,
        parameters.feedbackTicks,
      );
      const enemy = this.#enemy.diagnostics();
      if (
        !enemy.dead &&
        pointInArea(
          center.x,
          center.y,
          parameters.radius,
          enemy.x,
          enemy.y,
          enemy.radius,
        )
      ) {
        this.#statuses.apply(
          enemy.id,
          parameters.statusId,
          this.#tick,
          parameters.durationTicks,
          parameters.modifier,
        );
      }
    } else if (parameters.kind === "self-status") {
      this.#statuses.apply(
        "player",
        parameters.statusId,
        this.#tick,
        parameters.durationTicks,
        parameters.modifier,
      );
    }
    if (effectIndex === 0) {
      this.#events.push({
        type: "ability-activated",
        tick: this.#tick,
        abilityId,
        x: target.kind === "point" ? target.x : player.x,
        y: target.kind === "point" ? target.y : player.y,
      });
    }
  }

  private advanceProjectiles(step: FixedStep): void {
    for (let index = this.#projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.#projectiles[index];
      if (projectile === undefined) continue;
      const travel = Math.min(
        projectile.speedPerSecond * step.deltaSeconds,
        projectile.maximumRange - projectile.distance,
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
            projectile.radius,
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
      if (projectile.distance >= projectile.maximumRange) {
        this.#projectiles.splice(index, 1);
      }
    }
  }

  private addAreaFeedback(
    abilityId: CombatAbilityId,
    x: number,
    y: number,
    radius: number,
    feedbackTicks: number,
  ): void {
    if (feedbackTicks <= 0) return;
    this.#areaFeedback.push({
      id: this.#nextFeedbackId++,
      x,
      y,
      radius,
      abilityId,
      expiresAtTick: this.#tick + feedbackTicks,
    });
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
      this.handleEnemyDeath(target);
    }
  }

  private handleEnemyDeath(target: SimpleMeleeEnemyDiagnostics): void {
    this.#statuses.clearTarget(target.id);
    this.#events.push({
      type: "entity-died",
      tick: this.#tick,
      entityId: target.id,
    });

    const generated = this.#lootGenerator.generateForKill();
    for (const item of generated.items) {
      const drop: WorldLootDrop = {
        dropId: `loot:drop-${this.#nextLootDropId++}`,
        item,
        x: target.x,
        y: target.y,
      };
      this.#worldLoot.push(drop);
      this.#events.push({ type: "loot-dropped", tick: this.#tick, drop });
    }
  }

  private pickUpNearbyLoot(): void {
    const player = this.playerPosition();
    for (let index = this.#worldLoot.length - 1; index >= 0; index -= 1) {
      const drop = this.#worldLoot[index];
      if (
        drop === undefined ||
        Math.hypot(drop.x - player.x, drop.y - player.y) >
          this.config.loot.pickupRadius
      ) {
        continue;
      }
      const result = this.#characterItems.addItem(drop.item);
      if (!result.accepted) continue;
      this.#worldLoot.splice(index, 1);
      this.#events.push({
        type: "loot-picked",
        tick: this.#tick,
        dropId: drop.dropId,
        item: drop.item,
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

  private currentExecution(): AbilityExecutionSnapshot | null {
    return this.#activeExecutions.values().next().value ?? null;
  }

  private definitionById(
    abilityId: CombatAbilityId,
  ): CombatAbilityDefinition | undefined {
    return this.config.abilityDefinitions.find(
      (definition) => definition.id === abilityId,
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

  private characterStats(): EquipmentStats {
    return this.#characterItems.stats({
      maximumHealth: this.config.playerMaxHealth,
      outgoingAbilityDamageBasisPoints: 10_000,
    });
  }

  private synchronizeEquipmentHealth(): void {
    this.#playerHealth.updateMaximum(this.characterStats().maximumHealth);
  }

  private resolveSlotTarget(
    abilityId: CombatAbilityId,
    target: AbilityTarget | undefined,
  ): AbilityTarget {
    const definition = this.definitionById(abilityId);
    if (definition?.targeting.mode === "self") {
      return { kind: "self" };
    }

    const player = this.playerPosition();
    if (definition?.targeting.mode === "point") {
      if (target?.kind === "point") return target;
      const direction =
        target?.kind === "direction"
          ? this.normalizedDirection(target.x, target.y)
          : { x: this.#facingX, y: this.#facingY };
      return {
        kind: "point",
        x: player.x + direction.x * definition.targeting.range,
        y: player.y + direction.y * definition.targeting.range,
      };
    }

    if (definition?.targeting.mode === "direction") {
      if (target?.kind === "direction") return target;
      if (target?.kind === "point") {
        return {
          kind: "direction",
          x: target.x - player.x,
          y: target.y - player.y,
        };
      }
      return { kind: "direction", x: this.#facingX, y: this.#facingY };
    }

    return target ?? { kind: "self" };
  }

  private normalizedDirection(
    x: number,
    y: number,
  ): { readonly x: number; readonly y: number } {
    const length = Math.hypot(x, y);
    return length === 0
      ? { x: this.#facingX, y: this.#facingY }
      : { x: x / length, y: y / length };
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
      config.loot.pickupRadius,
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
    if (
      config.abilityDefinitions.length === 0 ||
      new Set(config.abilityDefinitions.map(({ id }) => id)).size !==
        config.abilityDefinitions.length
    ) {
      throw new RangeError(
        "Combat ability definitions must be non-empty with unique ids.",
      );
    }
  }
}

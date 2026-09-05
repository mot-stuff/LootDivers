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
import {
  persistentInstanceId,
  type ContentId,
  type RuntimeEntityId,
} from "./ids";
import { Mulberry32 } from "./random";
import {
  SimpleMeleeEnemy,
  type EnemyRank,
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
import {
  BASE_MAXIMUM_MANA,
  BASE_MOVE_SPEED_BASIS_POINTS,
  CharacterProgression,
  type AttributeId,
  type CharacterProgressionReadModel,
  type ExperienceGrantResult,
  type ProgressionSpendResult,
} from "./progression";
import {
  INTERACT_RADIUS,
  ProfessionProgression,
  recipeById,
  type OreNodeDefinition,
  type ProfessionReadModel,
  type WorldInteractableKind,
} from "./professions";
import { TutorialTracker, type TutorialReadModel } from "./tutorial";
import {
  ASHTRAIL_ENEMY,
  ASHTRAIL_EXPANSE_ID,
  HOLLOWDEEP_BRUISER_ID,
  HOLLOWDEEP_CULLING_QUEST,
  WAKESHORE_LANDING_ID,
  WAKESHORE_SCUTTLER_ID,
  ZONE_CATALOG,
  vendorOfferById,
  zoneById,
  type QuestStage,
  type ZoneDefinition,
  type ZoneId,
} from "./world-zones";
import type { EquipmentSlot, FlaskSlot, WearableSlot } from "./item-catalog";
import {
  createMaterialStack,
  generateEquipmentItem,
  type EquipmentItemInstance,
  type ItemInstance,
} from "./item-generation";
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
  readonly rank: EnemyRank;
}

export type MinimapMarkerKind =
  "player" | "enemy" | "portal" | "node" | "forge" | "vendor" | "quest";

export interface MinimapMarkerReadModel {
  readonly id: string;
  readonly kind: MinimapMarkerKind;
  readonly x: number;
  readonly y: number;
  readonly rank?: EnemyRank;
}

export interface MinimapBoundsReadModel {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MinimapReadModel {
  readonly width: number;
  readonly height: number;
  readonly floorColor: number;
  readonly edgeColor: number;
  readonly walkable: MinimapBoundsReadModel;
  readonly markers: readonly MinimapMarkerReadModel[];
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

export interface CharacterCombatStats extends EquipmentStats {
  readonly maximumMana: number;
  readonly moveSpeedBasisPoints: number;
  readonly abilityDamageBasisPoints: Readonly<
    Partial<Record<CombatAbilityId, number>>
  >;
  readonly statusDurationBasisPoints: Readonly<
    Partial<Record<CombatAbilityId, number>>
  >;
}

export interface CharacterItemLoadoutReadModel {
  readonly inventory: readonly (ItemInstance | null)[];
  readonly equipment: Readonly<
    Record<EquipmentSlot, EquipmentItemInstance | null>
  >;
  readonly flasks: Readonly<Record<FlaskSlot, EquipmentItemInstance | null>>;
  readonly ownedAbilities: readonly CombatAbilityId[];
  readonly assignments: Readonly<Record<LoadoutSlot, CombatAbilityId | null>>;
  readonly stats: CharacterCombatStats;
}

export type CombatSlotRequestResult =
  | AbilityRequestResult
  | {
      readonly accepted: false;
      readonly reason: "slot-empty";
      readonly history: readonly [];
    };

export type LootPickupFailure =
  | "player-defeated"
  | "no-drop-in-range"
  | "unknown-drop"
  | "out-of-range"
  | "inventory-rejected";

export type LootPickupResult =
  | {
      readonly pickedUp: true;
      readonly dropId: string;
      readonly item: ItemInstance;
    }
  | { readonly pickedUp: false; readonly reason: LootPickupFailure };

export interface WorldInteractableReadModel {
  readonly id: ContentId;
  readonly kind: WorldInteractableKind;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly depleted: boolean;
  readonly requiredLevel: number;
  readonly respawnTicksRemaining: number;
}

export interface GatheringReadModel {
  readonly nodeId: ContentId;
  readonly displayName: string;
  readonly ticksRemaining: number;
  readonly totalTicks: number;
}

export type InteractFailure =
  | LootPickupFailure
  | "node-depleted"
  | "skill-requirement"
  | "already-gathering"
  | "inventory-rejected"
  | "nothing-in-range";

export type InteractResult =
  | { readonly kind: "loot"; readonly result: LootPickupResult }
  | { readonly kind: "gather-started"; readonly nodeId: ContentId }
  | { readonly kind: "forge-opened" }
  | { readonly kind: "vendor-opened" }
  | { readonly kind: "portal-used"; readonly zoneId: ZoneId }
  | { readonly kind: "quest-accepted" }
  | { readonly kind: "quest-progress" }
  | { readonly kind: "quest-completed" }
  | { readonly kind: "quest-already-complete" }
  | { readonly kind: "rejected"; readonly reason: InteractFailure };

export type TravelFailure = "unknown-zone";

export interface TravelResult {
  readonly accepted: boolean;
  readonly reason?: TravelFailure;
  readonly zoneId?: ZoneId;
}

export type VendorTradeFailure =
  | "vendor-closed"
  | "unknown-offer"
  | "missing-ingredients"
  | "inventory-rejected";

export interface VendorTradeResult {
  readonly accepted: boolean;
  readonly reason?: VendorTradeFailure;
  readonly item?: ItemInstance;
}

export interface QuestReadModel {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly stage: QuestStage;
}

export type CraftFailure =
  | "unknown-recipe"
  | "forge-closed"
  | "skill-requirement"
  | "missing-ingredients"
  | "inventory-rejected";

export interface CraftResult {
  readonly accepted: boolean;
  readonly reason?: CraftFailure;
  readonly item?: ItemInstance;
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
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
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
  readonly enemies: readonly SimpleMeleeEnemyDiagnostics[];
  readonly targets: readonly CombatTargetReadModel[];
  readonly minimap: MinimapReadModel;
  readonly worldLoot: readonly WorldLootDrop[];
  readonly enemyKillCount: number;
  readonly lootDropCount: number;
  readonly eventCount: number;
  readonly interactables: readonly WorldInteractableReadModel[];
  readonly gathering: GatheringReadModel | null;
  readonly forgeOpen: boolean;
  readonly vendorOpen: boolean;
  readonly professions: readonly ProfessionReadModel[];
  readonly zoneId: ZoneId;
  readonly zoneName: string;
  readonly quest: QuestReadModel;
  readonly tutorial: TutorialReadModel;
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
    pickupRadius: 72,
    rarityWeights: DEFAULT_ENEMY_LOOT_WEIGHTS,
  },
  abilityDefinitions: COMBAT_ABILITY_DEFINITIONS,
  enemy: ASHTRAIL_ENEMY,
};

const DORMANT_ENEMY: SimpleMeleeEnemyConfig = {
  ...ASHTRAIL_ENEMY,
  id: "enemy:zone-dormant",
  spawnX: 2_400,
  spawnY: 2_400,
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
  #enemies: SimpleMeleeEnemy[];
  readonly #characterItems = new CharacterItemLoadout();
  readonly #progression = new CharacterProgression();
  readonly #professions = new ProfessionProgression();
  readonly #tutorial = new TutorialTracker();
  #zoneId: ZoneId = ASHTRAIL_EXPANSE_ID;
  #questStage: QuestStage = "inactive";
  #vendorOpen = false;
  #nextVendorSerial = 1;
  readonly #nodeCharges = new Map<ContentId, number>();
  readonly #nodeRespawnAt = new Map<ContentId, number>();
  #gathering:
    | {
        readonly nodeId: ContentId;
        readonly resolveAtTick: number;
        readonly totalTicks: number;
      }
    | undefined;
  #forgeOpen = false;
  #nextCraftSerial = 1;
  #nextMaterialSerial = 1;
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
  #manaMaximumSubunits = 1_000;
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
    this.#manaMaximumSubunits = this.manaMaximumSubunits();
    this.#manaSubunits = this.#manaMaximumSubunits;
    this.#enemies = [new SimpleMeleeEnemy(config.enemy)];
    this.#lootGenerator = new DeterministicEnemyLootGenerator(config.loot);
    this.resetNodeCharges();
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
    this.cancelGathering("interrupted");
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

  public equipCharacterItem(
    inventoryIndex: number,
    targetSlot?: WearableSlot,
  ): EquipResult {
    const result = this.#characterItems.equipFromInventory(
      inventoryIndex,
      targetSlot,
      this.#progression.level(),
    );
    if (result.accepted) this.synchronizeCharacterResources();
    return result;
  }

  public unequipCharacterItem(slot: WearableSlot): InventoryAddResult {
    const result = this.#characterItems.unequip(slot);
    if (result.accepted) this.synchronizeCharacterResources();
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

  public professions(): readonly ProfessionReadModel[] {
    return this.#professions.readModel();
  }

  public worldInteractables(): readonly WorldInteractableReadModel[] {
    return this.interactableReadModels();
  }

  public gathering(): GatheringReadModel | null {
    return this.gatheringReadModel();
  }

  public forgeOpen(): boolean {
    return this.#forgeOpen;
  }

  public requestInteract(): InteractResult {
    if (this.#playerHealth.health.dead) {
      return { kind: "rejected", reason: "player-defeated" };
    }
    const loot = this.requestLootPickup();
    if (loot.pickedUp || loot.reason !== "no-drop-in-range") {
      return { kind: "loot", result: loot };
    }
    const interactable = this.nearestInteractable();
    if (interactable === null) {
      return { kind: "rejected", reason: "nothing-in-range" };
    }
    if (interactable.kind === "forge") {
      this.#forgeOpen = true;
      return { kind: "forge-opened" };
    }
    if (interactable.kind === "vendor") {
      this.#vendorOpen = true;
      return { kind: "vendor-opened" };
    }
    if (interactable.kind === "quest-giver") {
      return this.interactQuestGiver();
    }
    if (interactable.kind === "portal") {
      return this.usePortal(interactable.id);
    }
    return this.beginGather(interactable.id);
  }

  public craftRecipe(recipeId: ContentId): CraftResult {
    if (!this.#forgeOpen) {
      return { accepted: false, reason: "forge-closed" };
    }
    const recipe = recipeById(recipeId);
    if (recipe === undefined) {
      return { accepted: false, reason: "unknown-recipe" };
    }
    if (this.#professions.level("smithing") < recipe.requiredSmithingLevel) {
      return { accepted: false, reason: "skill-requirement" };
    }
    for (const ingredient of recipe.ingredients) {
      if (
        this.#characterItems.materialCount(ingredient.materialId) <
        ingredient.quantity
      ) {
        return { accepted: false, reason: "missing-ingredients" };
      }
    }
    for (const ingredient of recipe.ingredients) {
      this.#characterItems.consumeMaterial(
        ingredient.materialId,
        ingredient.quantity,
      );
    }
    const item = generateEquipmentItem({
      seed: 0x5e11_0000 + this.#nextCraftSerial,
      instanceId: persistentInstanceId(`item:crafted-${this.#nextCraftSerial}`),
      baseId: recipe.outputBaseId,
      rarity: recipe.outputRarity,
      origin: "crafted",
    });
    this.#nextCraftSerial += 1;
    const added = this.#characterItems.addItem(item);
    if (!added.accepted) {
      for (const ingredient of recipe.ingredients) {
        this.#characterItems.addItem(
          createMaterialStack(
            persistentInstanceId(`item:refund-${this.#nextMaterialSerial++}`),
            ingredient.materialId,
            ingredient.quantity,
          ),
        );
      }
      return { accepted: false, reason: "inventory-rejected" };
    }
    this.#professions.grantExperience("smithing", recipe.experience);
    return { accepted: true, item };
  }

  public closeForge(): void {
    this.#forgeOpen = false;
  }

  public vendorOpen(): boolean {
    return this.#vendorOpen;
  }

  public closeVendor(): void {
    this.#vendorOpen = false;
  }

  public currentZone(): ZoneDefinition {
    return zoneById(this.#zoneId) ?? ZONE_CATALOG[0]!;
  }

  public quest(): QuestReadModel {
    return {
      id: HOLLOWDEEP_CULLING_QUEST.id,
      displayName: HOLLOWDEEP_CULLING_QUEST.displayName,
      summary: HOLLOWDEEP_CULLING_QUEST.summary,
      stage: this.#questStage,
    };
  }

  public travelTo(
    zoneId: ZoneId,
    arrivalX?: number,
    arrivalY?: number,
  ): TravelResult {
    const zone = zoneById(zoneId);
    if (zone === undefined) {
      return { accepted: false, reason: "unknown-zone" };
    }
    this.applyZone(zone, arrivalX, arrivalY);
    return { accepted: true, zoneId: zone.id };
  }

  public tradeVendorOffer(offerId: ContentId): VendorTradeResult {
    if (!this.#vendorOpen) {
      return { accepted: false, reason: "vendor-closed" };
    }
    const offer = vendorOfferById(offerId);
    if (offer === undefined) {
      return { accepted: false, reason: "unknown-offer" };
    }
    if (
      this.#characterItems.materialCount(offer.materialId) <
      offer.materialQuantity
    ) {
      return { accepted: false, reason: "missing-ingredients" };
    }
    this.#characterItems.consumeMaterial(
      offer.materialId,
      offer.materialQuantity,
    );
    const item = generateEquipmentItem({
      seed: 0x7e11_0000 + this.#nextVendorSerial,
      instanceId: persistentInstanceId(`item:vendor-${this.#nextVendorSerial}`),
      baseId: offer.outputBaseId,
      rarity: "common",
    });
    this.#nextVendorSerial += 1;
    const added = this.#characterItems.addItem(item);
    if (!added.accepted) {
      this.#characterItems.addItem(
        createMaterialStack(
          persistentInstanceId(
            `item:vendor-refund-${this.#nextVendorSerial++}`,
          ),
          offer.materialId,
          offer.materialQuantity,
        ),
      );
      return { accepted: false, reason: "inventory-rejected" };
    }
    return { accepted: true, item };
  }

  public characterProgression(): CharacterProgressionReadModel {
    return this.#progression.readModel();
  }

  public grantExperience(amount: number): ExperienceGrantResult {
    return this.#progression.grantExperience(amount);
  }

  public allocateAttribute(attribute: AttributeId): ProgressionSpendResult {
    const result = this.#progression.allocateAttribute(attribute);
    if (result.accepted) this.synchronizeCharacterResources();
    return result;
  }

  public deallocateAttribute(attribute: AttributeId): ProgressionSpendResult {
    const result = this.#progression.deallocateAttribute(attribute);
    if (result.accepted) this.synchronizeCharacterResources();
    return result;
  }

  public allocatePassive(passiveId: ContentId): ProgressionSpendResult {
    const result = this.#progression.allocatePassive(passiveId);
    if (result.accepted) this.synchronizeCharacterResources();
    return result;
  }

  public respecProgression(): void {
    this.#progression.respec();
    this.synchronizeCharacterResources();
  }

  public characterItemLoadout(): CharacterItemLoadoutReadModel {
    return {
      inventory: this.#characterItems.inventorySlots(),
      equipment: this.#characterItems.equipment(),
      flasks: this.#characterItems.flasks(),
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
    this.cancelGathering("interrupted");
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
      this.cancelGathering("interrupted");
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
      this.#manaSubunits = Math.min(
        this.#manaMaximumSubunits,
        this.#manaSubunits + 1,
      );
    }
    this.advanceProfessionWorld();
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
    const moveMultiplier = this.characterStats().moveSpeedBasisPoints / 10_000;
    const speed = dodging
      ? this.config.dodgeSpeed
      : this.config.moveSpeed * moveMultiplier;
    const transformIndex = this.playerTransformIndex();
    if (!this.#playerHealth.health.dead) {
      this.#lifecycle.transforms.x[transformIndex] =
        (this.#lifecycle.transforms.x[transformIndex] ?? 0) +
        directionX * speed * step.deltaSeconds;
      this.#lifecycle.transforms.y[transformIndex] =
        (this.#lifecycle.transforms.y[transformIndex] ?? 0) +
        directionY * speed * step.deltaSeconds;
      if (this.#movementX !== 0 || this.#movementY !== 0) {
        this.#tutorial.notify("move");
      }
    }
    this.clampToArena();

    this.advanceAbilityExecutions();
    const player = this.playerPosition();
    this.advanceProjectiles(step);
    if (!this.currentZone().safe) {
      const target = {
        x: player.x,
        y: player.y,
        dead: this.#playerHealth.health.dead,
      };
      for (const enemy of this.#enemies) {
        enemy.step(step, target, (request) => this.applyPlayerDamage(request), {
          moveSpeedMultiplier: this.#statuses.multiplier(
            enemy.config.id,
            MOVE_SPEED_STAT_ID,
          ),
          outgoingDamageMultiplier: this.#statuses.multiplier(
            enemy.config.id,
            OUTGOING_DAMAGE_STAT_ID,
          ),
        });
      }
    }
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
    this.#zoneId = ASHTRAIL_EXPANSE_ID;
    this.#enemies = [new SimpleMeleeEnemy(this.config.enemy)];
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
    this.#manaMaximumSubunits = this.manaMaximumSubunits();
    this.#manaSubunits = this.#manaMaximumSubunits;
    this.#nextSettlementToken = 1;
    this.#nextCooldownToken = 1;
    this.#nextProjectileId = 1;
    this.#nextFeedbackId = 1;
    this.#lastAbilityResult = null;
    this.#pendingCleave = undefined;
    this.#gathering = undefined;
    this.#forgeOpen = false;
    this.#vendorOpen = false;
    this.#questStage = "inactive";
    this.#tutorial.reset();
    this.resetNodeCharges();
    this.#abilityEngine = this.createAbilityEngine();
  }

  public drainEvents(): readonly CombatArenaEvent[] {
    return this.#events.splice(0);
  }

  public diagnostics(): CombatArenaDiagnostics {
    const transformIndex = this.playerTransformIndex();
    const enemies = this.#enemies.map((enemy) => enemy.diagnostics());
    const enemy = enemies[0] ?? this.dormantEnemy().diagnostics();
    const progression = this.#progression.readModel();
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
      maxMana: this.#manaMaximumSubunits / 10,
      level: progression.level,
      experience: progression.experience,
      experienceToNextLevel: progression.experienceToNextLevel,
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
      enemies,
      targets: this.currentZone().safe
        ? []
        : enemies.map((target) => ({
            id: target.id,
            x: target.x,
            y: target.y,
            radius: target.radius,
            maxHealth: target.maxHealth,
            health: target.health,
            dead: target.dead,
            rank: target.rank,
          })),
      minimap: this.minimapReadModel(enemies),
      worldLoot: [...this.#worldLoot],
      enemyKillCount: this.#lootGenerator.killsGenerated(),
      lootDropCount: this.#nextLootDropId - 1,
      eventCount: this.#events.length,
      interactables: this.interactableReadModels(),
      gathering: this.gatheringReadModel(),
      forgeOpen: this.#forgeOpen,
      vendorOpen: this.#vendorOpen,
      professions: this.#professions.readModel(),
      zoneId: this.#zoneId,
      zoneName: this.currentZone().displayName,
      quest: this.quest(),
      tutorial: this.#tutorial.readModel(),
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

    for (const enemy of this.#enemies) {
      const target = enemy.diagnostics();
      if (target.dead || this.#attackHitTargets.has(target.id)) {
        continue;
      }
      const deltaX = target.x - playerX;
      const deltaY = target.y - playerY;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance > attack.range + target.radius) {
        continue;
      }
      const dot =
        distance === 0
          ? 1
          : (deltaX * attack.aimX + deltaY * attack.aimY) / distance;
      if (dot < minimumDot) {
        continue;
      }

      this.#attackHitTargets.add(target.id);
      if (this.damageEnemy(enemy, attack.damage).applied > 0) {
        this.#attackHitCount += 1;
      }
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
    const abilityDamageBonus =
      1 +
      (this.characterStats().abilityDamageBasisPoints[abilityId] ?? 0) / 10_000;
    const damageMultiplier =
      parameters.kind === "cone-damage" ||
      parameters.kind === "projectile" ||
      parameters.kind === "area-damage"
        ? readStat({
            subject: "source",
            statId: OUTGOING_DAMAGE_STAT_ID,
            policy: "snapshot",
          }) * abilityDamageBonus
        : 1;
    const durationTicks = (ticks: number): number => {
      const bonus =
        this.characterStats().statusDurationBasisPoints[abilityId] ?? 0;
      return Math.max(1, Math.floor((ticks * (10_000 + bonus)) / 10_000));
    };
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
      for (const enemy of this.#enemies) {
        const snapshot = enemy.diagnostics();
        if (
          !snapshot.dead &&
          pointInArea(
            center.x,
            center.y,
            parameters.radius,
            snapshot.x,
            snapshot.y,
            snapshot.radius,
          )
        ) {
          this.damageEnemy(
            enemy,
            damageAfterModifier(parameters.damage, damageMultiplier),
          );
        }
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
      for (const enemy of this.#enemies) {
        const snapshot = enemy.diagnostics();
        if (
          !snapshot.dead &&
          pointInArea(
            center.x,
            center.y,
            parameters.radius,
            snapshot.x,
            snapshot.y,
            snapshot.radius,
          )
        ) {
          this.#statuses.apply(
            snapshot.id,
            parameters.statusId,
            this.#tick,
            durationTicks(parameters.durationTicks),
            parameters.modifier,
          );
        }
      }
    } else if (parameters.kind === "self-status") {
      this.#statuses.apply(
        "player",
        parameters.statusId,
        this.#tick,
        durationTicks(parameters.durationTicks),
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
      let nearestHit: {
        readonly enemy: SimpleMeleeEnemy;
        readonly hit: number;
      } | null = null;
      for (const enemy of this.#enemies) {
        const snapshot = enemy.diagnostics();
        if (snapshot.dead) continue;
        const hit = sweptCircleHitFraction(
          projectile.x,
          projectile.y,
          endX,
          endY,
          projectile.radius,
          snapshot.x,
          snapshot.y,
          snapshot.radius,
        );
        if (hit !== null && (nearestHit === null || hit < nearestHit.hit)) {
          nearestHit = { enemy, hit };
        }
      }
      if (nearestHit !== null) {
        projectile.x += (endX - projectile.x) * nearestHit.hit;
        projectile.y += (endY - projectile.y) * nearestHit.hit;
        this.damageEnemy(nearestHit.enemy, projectile.damage);
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

  private damageEnemy(enemy: SimpleMeleeEnemy, amount: number): DamageResult {
    const target = enemy.diagnostics();
    const result = enemy.applyDamage({ amount, sourceId: "player" });
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
      this.handleEnemyDeath(enemy.diagnostics());
    }
    return result;
  }

  private handleEnemyDeath(target: SimpleMeleeEnemyDiagnostics): void {
    this.#statuses.clearTarget(target.id);
    this.#events.push({
      type: "entity-died",
      tick: this.#tick,
      entityId: target.id,
    });
    this.#progression.grantExperience(target.experience);
    if (
      target.id === HOLLOWDEEP_BRUISER_ID &&
      this.#questStage === "accepted"
    ) {
      this.#questStage = "ready";
    }
    if (target.id === WAKESHORE_SCUTTLER_ID) {
      this.#tutorial.notify("attack");
    }

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

  /**
   * Attempts to pick up the nearest world drop within the configured pickup
   * radius of the player. The inventory add is atomic: a rejected drop stays
   * in the world untouched.
   */
  public requestLootPickup(): LootPickupResult {
    if (this.#playerHealth.health.dead) {
      return { pickedUp: false, reason: "player-defeated" };
    }
    const player = this.playerPosition();
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.#worldLoot.length; index += 1) {
      const drop = this.#worldLoot[index];
      if (drop === undefined) continue;
      const distance = Math.hypot(drop.x - player.x, drop.y - player.y);
      if (
        distance <= this.config.loot.pickupRadius &&
        distance < nearestDistance
      ) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    }
    if (nearestIndex < 0) {
      return { pickedUp: false, reason: "no-drop-in-range" };
    }
    return this.pickUpDropAtIndex(nearestIndex);
  }

  /**
   * Picks up one specific world drop by identity with the same range and
   * inventory rules as {@link requestLootPickup}. Intended for pointer-driven
   * pickup such as clicking a ground-loot label.
   */
  public pickUpDropById(dropId: string): LootPickupResult {
    if (this.#playerHealth.health.dead) {
      return { pickedUp: false, reason: "player-defeated" };
    }
    const index = this.#worldLoot.findIndex((drop) => drop.dropId === dropId);
    if (index < 0) {
      return { pickedUp: false, reason: "unknown-drop" };
    }
    const drop = this.#worldLoot[index]!;
    const player = this.playerPosition();
    if (
      Math.hypot(drop.x - player.x, drop.y - player.y) >
      this.config.loot.pickupRadius
    ) {
      return { pickedUp: false, reason: "out-of-range" };
    }
    return this.pickUpDropAtIndex(index);
  }

  private pickUpDropAtIndex(index: number): LootPickupResult {
    const drop = this.#worldLoot[index]!;
    const result = this.#characterItems.addItem(drop.item);
    if (!result.accepted) {
      return { pickedUp: false, reason: "inventory-rejected" };
    }
    this.#worldLoot.splice(index, 1);
    this.#events.push({
      type: "loot-picked",
      tick: this.#tick,
      dropId: drop.dropId,
      item: drop.item,
    });
    this.#tutorial.notify("loot");
    return { pickedUp: true, dropId: drop.dropId, item: drop.item };
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
    this.#tutorial.notify("dodge");
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

  private resetNodeCharges(): void {
    this.#nodeCharges.clear();
    this.#nodeRespawnAt.clear();
    for (const zone of ZONE_CATALOG) {
      for (const node of zone.nodes) {
        this.#nodeCharges.set(node.id, node.charges);
      }
    }
  }

  private interactableReadModels(): readonly WorldInteractableReadModel[] {
    const zone = this.currentZone();
    const landmark = (
      id: ContentId,
      kind: WorldInteractableKind,
      displayName: string,
      x: number,
      y: number,
      radius: number,
    ): WorldInteractableReadModel => ({
      id,
      kind,
      displayName,
      x,
      y,
      radius,
      depleted: false,
      requiredLevel: 1,
      respawnTicksRemaining: 0,
    });
    return [
      ...zone.nodes.map((node) => ({
        id: node.id,
        kind: "ore-node" as const,
        displayName: node.displayName,
        x: node.x,
        y: node.y,
        radius: node.radius,
        depleted: (this.#nodeCharges.get(node.id) ?? 0) <= 0,
        requiredLevel: node.requiredMiningLevel,
        respawnTicksRemaining: Math.max(
          0,
          (this.#nodeRespawnAt.get(node.id) ?? this.#tick) - this.#tick,
        ),
      })),
      ...zone.forges.map((forge) =>
        landmark(
          forge.id,
          "forge",
          forge.displayName,
          forge.x,
          forge.y,
          forge.radius,
        ),
      ),
      ...zone.portals.map((portal) =>
        landmark(
          portal.id,
          "portal",
          portal.displayName,
          portal.x,
          portal.y,
          portal.radius,
        ),
      ),
      ...(zone.vendor === undefined
        ? []
        : [
            landmark(
              zone.vendor.id,
              "vendor",
              zone.vendor.displayName,
              zone.vendor.x,
              zone.vendor.y,
              zone.vendor.radius,
            ),
          ]),
      ...(zone.questGiver === undefined
        ? []
        : [
            landmark(
              zone.questGiver.id,
              "quest-giver",
              zone.questGiver.displayName,
              zone.questGiver.x,
              zone.questGiver.y,
              zone.questGiver.radius,
            ),
          ]),
    ];
  }

  /**
   * Resolves an ore node from the current zone's node list. Every zone owns
   * its nodes (Ashtrail consumes the shared catalog; Wakeshore Landing has a
   * tutorial-only node), so gather targets never leak across zones.
   */
  private zoneNodeById(nodeId: ContentId): OreNodeDefinition | undefined {
    return this.currentZone().nodes.find((node) => node.id === nodeId);
  }

  private gatheringReadModel(): GatheringReadModel | null {
    if (this.#gathering === undefined) return null;
    const node = this.zoneNodeById(this.#gathering.nodeId);
    return {
      nodeId: this.#gathering.nodeId,
      displayName: node?.displayName ?? "Ore",
      ticksRemaining: Math.max(0, this.#gathering.resolveAtTick - this.#tick),
      totalTicks: this.#gathering.totalTicks,
    };
  }

  private nearestInteractable(): WorldInteractableReadModel | null {
    const player = this.playerPosition();
    let nearest: WorldInteractableReadModel | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const interactable of this.interactableReadModels()) {
      const distance = Math.hypot(
        interactable.x - player.x,
        interactable.y - player.y,
      );
      if (distance <= INTERACT_RADIUS && distance < nearestDistance) {
        nearest = interactable;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  private beginGather(nodeId: ContentId): InteractResult {
    const node = this.zoneNodeById(nodeId);
    if (node === undefined) {
      return { kind: "rejected", reason: "nothing-in-range" };
    }
    if ((this.#nodeCharges.get(node.id) ?? 0) <= 0) {
      return { kind: "rejected", reason: "node-depleted" };
    }
    if (this.#professions.level("mining") < node.requiredMiningLevel) {
      return { kind: "rejected", reason: "skill-requirement" };
    }
    if (this.#gathering !== undefined) {
      return { kind: "rejected", reason: "already-gathering" };
    }
    const totalTicks = secondsToTicks(node.gatherSeconds);
    this.#gathering = {
      nodeId: node.id,
      resolveAtTick: this.#tick + totalTicks,
      totalTicks,
    };
    return { kind: "gather-started", nodeId: node.id };
  }

  private cancelGathering(reason: "interrupted" | "moved"): void {
    if (this.#gathering === undefined) return;
    this.#gathering = undefined;
    void reason;
  }

  private completeGather(nodeId: ContentId): void {
    const node = this.zoneNodeById(nodeId);
    if (node === undefined) return;
    const remaining = this.#nodeCharges.get(node.id) ?? 0;
    if (remaining <= 0) return;
    const item = createMaterialStack(
      persistentInstanceId(`item:ore-${this.#nextMaterialSerial++}`),
      node.materialId,
      node.yieldQuantity,
    );
    const added = this.#characterItems.addItem(item);
    if (!added.accepted) return;
    this.#professions.grantExperience("mining", node.experience);
    this.#tutorial.notify("gather");
    const nextCharges = remaining - 1;
    this.#nodeCharges.set(node.id, nextCharges);
    if (nextCharges <= 0) {
      this.#nodeRespawnAt.set(
        node.id,
        this.#tick + secondsToTicks(node.respawnSeconds),
      );
    }
  }

  private advanceProfessionWorld(): void {
    if (
      this.#gathering !== undefined &&
      (this.#movementX !== 0 ||
        this.#movementY !== 0 ||
        this.#dodgeTicksRemaining > 0 ||
        this.#playerHealth.health.dead)
    ) {
      this.cancelGathering("moved");
    }
    if (
      this.#gathering !== undefined &&
      this.#tick >= this.#gathering.resolveAtTick
    ) {
      const nodeId = this.#gathering.nodeId;
      this.#gathering = undefined;
      this.completeGather(nodeId);
    }
    for (const node of this.currentZone().nodes) {
      const respawnAt = this.#nodeRespawnAt.get(node.id);
      if (
        respawnAt !== undefined &&
        this.#tick >= respawnAt &&
        (this.#nodeCharges.get(node.id) ?? 0) <= 0
      ) {
        this.#nodeCharges.set(node.id, node.charges);
        this.#nodeRespawnAt.delete(node.id);
      }
    }
    if (this.#forgeOpen || this.#vendorOpen) {
      const player = this.playerPosition();
      const nearStation = this.interactableReadModels().some((interactable) => {
        if (interactable.kind !== "forge" && interactable.kind !== "vendor") {
          return false;
        }
        return (
          Math.hypot(interactable.x - player.x, interactable.y - player.y) <=
          INTERACT_RADIUS + 16
        );
      });
      if (!nearStation) {
        this.#forgeOpen = false;
        this.#vendorOpen = false;
      }
    }
  }

  private applyZone(
    zone: ZoneDefinition,
    arrivalX?: number,
    arrivalY?: number,
  ): void {
    this.cancelGathering("interrupted");
    this.#forgeOpen = false;
    this.#vendorOpen = false;
    this.#worldLoot.length = 0;
    this.#projectiles.length = 0;
    this.#areaFeedback.length = 0;
    this.#pendingCleave = undefined;
    this.#activeExecutions.clear();
    this.#statuses.clear();
    this.#zoneId = zone.id;
    this.#tutorial.setInZone(zone.id === WAKESHORE_LANDING_ID);
    this.spawnEncounter(zone.enemies);
    this.placePlayer(
      arrivalX ?? zone.playerSpawnX,
      arrivalY ?? zone.playerSpawnY,
    );
  }

  private placePlayer(x: number, y: number): void {
    const transformIndex = this.playerTransformIndex();
    this.#lifecycle.transforms.x[transformIndex] = x;
    this.#lifecycle.transforms.y[transformIndex] = y;
    this.#lifecycle.transforms.previousX[transformIndex] = x;
    this.#lifecycle.transforms.previousY[transformIndex] = y;
    this.clampToArena();
  }

  private usePortal(portalId: ContentId): InteractResult {
    const portal = this.currentZone().portals.find(
      (entry) => entry.id === portalId,
    );
    if (portal === undefined) {
      return { kind: "rejected", reason: "nothing-in-range" };
    }
    // The tutorial exit portal doubles as the final step AND the skip path:
    // it always works, and the tracker only advances when `travel` is the
    // current step. Notify before traveling so the tracker is still in-zone.
    this.#tutorial.notify("travel");
    const traveled = this.travelTo(
      portal.destinationZoneId,
      portal.arrivalX,
      portal.arrivalY,
    );
    if (!traveled.accepted || traveled.zoneId === undefined) {
      return { kind: "rejected", reason: "nothing-in-range" };
    }
    return { kind: "portal-used", zoneId: traveled.zoneId };
  }

  private interactQuestGiver(): InteractResult {
    if (this.#questStage === "inactive") {
      this.#questStage = "accepted";
      return { kind: "quest-accepted" };
    }
    if (this.#questStage === "accepted") {
      return { kind: "quest-progress" };
    }
    if (this.#questStage === "ready") {
      this.#progression.grantExperience(
        HOLLOWDEEP_CULLING_QUEST.rewardExperience,
      );
      this.#questStage = "completed";
      return { kind: "quest-completed" };
    }
    return { kind: "quest-already-complete" };
  }

  private characterStats(): CharacterCombatStats {
    const equipment = this.#characterItems.stats({
      maximumHealth: this.config.playerMaxHealth,
      outgoingAbilityDamageBasisPoints: 10_000,
    });
    const bonuses = this.#progression.bonuses();
    const outgoingAbilityDamageBasisPoints =
      equipment.outgoingAbilityDamageBasisPoints +
      bonuses.outgoingAbilityDamageBasisPoints;
    return {
      maximumHealth: equipment.maximumHealth + bonuses.maximumHealth,
      outgoingAbilityDamageBasisPoints,
      outgoingAbilityDamageMultiplier:
        outgoingAbilityDamageBasisPoints / 10_000,
      maximumMana: BASE_MAXIMUM_MANA + bonuses.maximumMana,
      moveSpeedBasisPoints:
        BASE_MOVE_SPEED_BASIS_POINTS + bonuses.moveSpeedBasisPoints,
      abilityDamageBasisPoints: bonuses.abilityDamageBasisPoints,
      statusDurationBasisPoints: bonuses.statusDurationBasisPoints,
    };
  }

  private manaMaximumSubunits(): number {
    return Math.max(1, Math.round(this.characterStats().maximumMana * 10));
  }

  private synchronizeCharacterResources(): void {
    const stats = this.characterStats();
    this.#playerHealth.updateMaximum(stats.maximumHealth);
    const nextMax = Math.max(1, Math.round(stats.maximumMana * 10));
    const missing = this.#manaMaximumSubunits - this.#manaSubunits;
    this.#manaMaximumSubunits = nextMax;
    this.#manaSubunits = Math.min(nextMax, Math.max(0, nextMax - missing));
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

  private spawnEncounter(configs: readonly SimpleMeleeEnemyConfig[]): void {
    if (configs.length === 0) {
      const dormant = this.dormantEnemy();
      dormant.applyDamage({ amount: 10_000, sourceId: "zone-safe" });
      this.#enemies = [dormant];
      return;
    }
    const ids = new Set(configs.map((entry) => entry.id));
    if (ids.size !== configs.length) {
      throw new RangeError("Zone encounter IDs must be unique.");
    }
    this.#enemies = configs.map((entry) => new SimpleMeleeEnemy(entry));
  }

  private dormantEnemy(): SimpleMeleeEnemy {
    return new SimpleMeleeEnemy(DORMANT_ENEMY);
  }

  private minimapReadModel(
    enemies: readonly SimpleMeleeEnemyDiagnostics[],
  ): MinimapReadModel {
    const zone = this.currentZone();
    const player = this.playerPosition();
    const markers: MinimapMarkerReadModel[] = [
      {
        id: "player",
        kind: "player",
        x: player.x,
        y: player.y,
      },
    ];
    if (!zone.safe) {
      for (const enemy of enemies) {
        if (enemy.id === DORMANT_ENEMY.id || enemy.dead) continue;
        markers.push({
          id: enemy.id,
          kind: "enemy",
          x: enemy.x,
          y: enemy.y,
          rank: enemy.rank,
        });
      }
    }
    for (const portal of zone.portals) {
      markers.push({
        id: portal.id,
        kind: "portal",
        x: portal.x,
        y: portal.y,
      });
    }
    for (const node of zone.nodes) {
      markers.push({
        id: node.id,
        kind: "node",
        x: node.x,
        y: node.y,
      });
    }
    for (const forge of zone.forges) {
      markers.push({
        id: forge.id,
        kind: "forge",
        x: forge.x,
        y: forge.y,
      });
    }
    if (zone.vendor !== undefined) {
      markers.push({
        id: zone.vendor.id,
        kind: "vendor",
        x: zone.vendor.x,
        y: zone.vendor.y,
      });
    }
    if (zone.questGiver !== undefined) {
      markers.push({
        id: zone.questGiver.id,
        kind: "quest",
        x: zone.questGiver.x,
        y: zone.questGiver.y,
      });
    }
    const radius = this.config.playerRadius;
    return {
      width: this.config.width,
      height: this.config.height,
      floorColor: zone.floorColor,
      edgeColor: zone.edgeColor,
      walkable: {
        x: radius,
        y: radius,
        width: this.config.width - radius * 2,
        height: this.config.height - radius * 2,
      },
      markers,
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

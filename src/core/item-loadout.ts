import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  WINTER_PULSE_ID,
  type CombatAbilityId,
} from "./combat-abilities";
import {
  EQUIPMENT_SLOTS,
  FLASK_SLOTS,
  IMPLEMENTED_ABILITY_CATALOG,
  isFlaskSlot,
  slotAcceptsKind,
  slotsForKind,
  type EquipmentSlot,
  type FlaskSlot,
  type WearableSlot,
} from "./item-catalog";
import {
  equipmentSlotKindOf,
  modifiersForEquipment,
  type EquipmentItemInstance,
  type ItemInstance,
} from "./item-generation";
import { Inventory, type InventoryAddResult } from "./inventory";
import type { ContentId } from "./ids";

export type LoadoutSlot = "lmb" | "q" | "e" | "r";

export interface EquipmentStats {
  readonly maximumHealth: number;
  readonly outgoingAbilityDamageBasisPoints: number;
  readonly outgoingAbilityDamageMultiplier: number;
}

export interface BaseCharacterStats {
  readonly maximumHealth: number;
  readonly outgoingAbilityDamageBasisPoints: number;
}

export const DEFAULT_BASE_CHARACTER_STATS: BaseCharacterStats = {
  maximumHealth: 100,
  outgoingAbilityDamageBasisPoints: 10_000,
};

export type EquipFailure =
  "not-equipment" | "empty-slot" | "incompatible-slot" | "level-requirement";

export interface EquipResult {
  readonly accepted: boolean;
  readonly reason?: EquipFailure;
}

export type LoadoutAssignmentFailure =
  "ability-not-owned" | "basic-cleave-required";

export interface LoadoutAssignmentResult {
  readonly accepted: boolean;
  readonly reason?: LoadoutAssignmentFailure;
}

export type StoneConsumptionFailure =
  "not-ability-stone" | "ability-not-selectable";

export interface StoneConsumptionResult {
  readonly accepted: boolean;
  readonly reason?: StoneConsumptionFailure;
}

export const LOADOUT_SLOTS: readonly LoadoutSlot[] = ["lmb", "q", "e", "r"];

/**
 * Serializable item/ability state for the character save DTO (TASK-705).
 * Equipment and flask records carry only occupied slots; inventory keeps
 * its full 48-slot layout including empty positions.
 */
export interface CharacterItemsSnapshot {
  readonly inventory: readonly (ItemInstance | null)[];
  readonly equipment: Readonly<
    Partial<Record<EquipmentSlot, EquipmentItemInstance>>
  >;
  readonly flasks: Readonly<Partial<Record<FlaskSlot, EquipmentItemInstance>>>;
  readonly ownedAbilities: readonly CombatAbilityId[];
  readonly loadout: Readonly<Record<LoadoutSlot, CombatAbilityId | null>>;
}

function emptyEquipment(): Record<EquipmentSlot, EquipmentItemInstance | null> {
  const equipment = {} as Record<EquipmentSlot, EquipmentItemInstance | null>;
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = null;
  return equipment;
}

function emptyFlasks(): Record<FlaskSlot, EquipmentItemInstance | null> {
  const flasks = {} as Record<FlaskSlot, EquipmentItemInstance | null>;
  for (const slot of FLASK_SLOTS) flasks[slot] = null;
  return flasks;
}

function initialLoadout(): Record<LoadoutSlot, CombatAbilityId | null> {
  return {
    lmb: BASIC_CLEAVE_ID,
    q: CINDER_DART_ID,
    e: WINTER_PULSE_ID,
    r: DEFIANT_SIGNAL_ID,
  };
}

export function aggregateEquipmentStats(
  equipment: Readonly<Record<EquipmentSlot, EquipmentItemInstance | null>>,
  base: BaseCharacterStats = DEFAULT_BASE_CHARACTER_STATS,
): EquipmentStats {
  let maximumHealth = base.maximumHealth;
  let outgoingBasisPoints = base.outgoingAbilityDamageBasisPoints;

  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipment[slot];
    if (item === null) continue;
    for (const modifier of modifiersForEquipment(item)) {
      if (modifier.operation === "flat") maximumHealth += modifier.value;
      else outgoingBasisPoints += modifier.value;
    }
  }

  return {
    maximumHealth,
    outgoingAbilityDamageBasisPoints: outgoingBasisPoints,
    outgoingAbilityDamageMultiplier: outgoingBasisPoints / 10_000,
  };
}

export function applyOutgoingAbilityDamage(
  baseDamage: number,
  stats: EquipmentStats,
): number {
  if (!Number.isFinite(baseDamage) || baseDamage < 0) {
    throw new RangeError(
      "Base ability damage must be a finite nonnegative value.",
    );
  }
  return Math.floor(
    (baseDamage * stats.outgoingAbilityDamageBasisPoints) / 10_000,
  );
}

/**
 * Owns the prototype character's item locations, learned abilities, equipment,
 * and combat-slot assignments. Presentation layers should issue commands here
 * rather than retaining parallel mutable state.
 */
export class CharacterItemLoadout {
  readonly #inventory = new Inventory();
  readonly #equipment = emptyEquipment();
  readonly #flasks = emptyFlasks();
  readonly #ownedAbilities = new Set<CombatAbilityId>([BASIC_CLEAVE_ID]);
  readonly #loadout = initialLoadout();

  public inventorySlots(): readonly (ItemInstance | null)[] {
    return this.#inventory.slots();
  }

  public equipment(): Readonly<
    Record<EquipmentSlot, EquipmentItemInstance | null>
  > {
    return { ...this.#equipment };
  }

  public flasks(): Readonly<Record<FlaskSlot, EquipmentItemInstance | null>> {
    return { ...this.#flasks };
  }

  public loadout(): Readonly<Record<LoadoutSlot, CombatAbilityId | null>> {
    return { ...this.#loadout };
  }

  public ownedAbilities(): readonly CombatAbilityId[] {
    return IMPLEMENTED_ABILITY_CATALOG.filter((id) =>
      this.#ownedAbilities.has(id),
    );
  }

  public snapshot(): CharacterItemsSnapshot {
    const equipment: Partial<Record<EquipmentSlot, EquipmentItemInstance>> = {};
    for (const slot of EQUIPMENT_SLOTS) {
      const item = this.#equipment[slot];
      if (item !== null) equipment[slot] = item;
    }
    const flasks: Partial<Record<FlaskSlot, EquipmentItemInstance>> = {};
    for (const slot of FLASK_SLOTS) {
      const item = this.#flasks[slot];
      if (item !== null) flasks[slot] = item;
    }
    return {
      inventory: this.#inventory.slots(),
      equipment,
      flasks,
      ownedAbilities: this.ownedAbilities(),
      loadout: { ...this.#loadout },
    };
  }

  /**
   * Replaces all item locations, learned abilities, and slot assignments
   * from a snapshot. Callers validate the snapshot first (see
   * `parseCharacterSave`); item instances are immutable data and are
   * adopted by reference.
   */
  public restore(snapshot: CharacterItemsSnapshot): void {
    this.#inventory.restoreSlots(snapshot.inventory);
    for (const slot of EQUIPMENT_SLOTS) {
      this.#equipment[slot] = snapshot.equipment[slot] ?? null;
    }
    for (const slot of FLASK_SLOTS) {
      this.#flasks[slot] = snapshot.flasks[slot] ?? null;
    }
    this.#ownedAbilities.clear();
    for (const abilityId of snapshot.ownedAbilities) {
      this.#ownedAbilities.add(abilityId);
    }
    for (const slot of LOADOUT_SLOTS) {
      this.#loadout[slot] = snapshot.loadout[slot];
    }
  }

  public materialCount(materialId: ContentId): number {
    return this.#inventory.materialCount(materialId);
  }

  public consumeMaterial(materialId: ContentId, quantity: number): boolean {
    return this.#inventory.consumeMaterial(materialId, quantity);
  }

  public addItem(item: ItemInstance): InventoryAddResult {
    if (
      EQUIPMENT_SLOTS.some(
        (slot) => this.#equipment[slot]?.instanceId === item.instanceId,
      ) ||
      FLASK_SLOTS.some(
        (slot) => this.#flasks[slot]?.instanceId === item.instanceId,
      )
    ) {
      return { accepted: false, reason: "duplicate-instance" };
    }
    return this.#inventory.add(item);
  }

  /**
   * Equips the item at the given inventory index. When `targetSlot` is
   * omitted, the slot is derived from the item's base: kinds with one
   * concrete slot use it, rings and flasks prefer the first empty matching
   * slot, and otherwise swap into the first candidate. A provided
   * `targetSlot` must accept the item's slot kind or the command is rejected.
   */
  public equipFromInventory(
    inventoryIndex: number,
    targetSlot?: WearableSlot,
    characterLevel = 1,
  ): EquipResult {
    const item = this.#inventory.itemAt(inventoryIndex);
    if (item === null) return { accepted: false, reason: "empty-slot" };
    if (item.kind !== "equipment") {
      return { accepted: false, reason: "not-equipment" };
    }
    if (item.requiredLevel > characterLevel) {
      return { accepted: false, reason: "level-requirement" };
    }

    const kind = equipmentSlotKindOf(item);
    let slot: WearableSlot;
    if (targetSlot !== undefined) {
      if (!slotAcceptsKind(targetSlot, kind)) {
        return { accepted: false, reason: "incompatible-slot" };
      }
      slot = targetSlot;
    } else {
      const candidates = slotsForKind(kind);
      slot =
        candidates.find((candidate) => this.occupied(candidate) === null) ??
        candidates[0]!;
    }

    const previous = this.occupied(slot);
    this.#inventory.take(inventoryIndex);
    this.place(slot, item);
    if (previous !== null) this.#inventory.putAt(inventoryIndex, previous);
    return { accepted: true };
  }

  public unequip(slot: WearableSlot): InventoryAddResult {
    const item = this.occupied(slot);
    if (item === null) return { accepted: true };
    const result = this.#inventory.add(item);
    if (result.accepted) this.place(slot, null);
    return result;
  }

  public stats(
    base: BaseCharacterStats = DEFAULT_BASE_CHARACTER_STATS,
  ): EquipmentStats {
    return aggregateEquipmentStats(this.#equipment, base);
  }

  public abilityStoneChoices(
    inventoryIndex: number,
  ): readonly CombatAbilityId[] {
    if (this.#inventory.itemAt(inventoryIndex)?.kind !== "ability-stone") {
      return [];
    }
    return IMPLEMENTED_ABILITY_CATALOG.filter(
      (id) => !this.#ownedAbilities.has(id),
    );
  }

  public consumeAbilityStone(
    inventoryIndex: number,
    selectedAbilityId: CombatAbilityId,
  ): StoneConsumptionResult {
    const item = this.#inventory.itemAt(inventoryIndex);
    if (item?.kind !== "ability-stone") {
      return { accepted: false, reason: "not-ability-stone" };
    }
    if (!this.abilityStoneChoices(inventoryIndex).includes(selectedAbilityId)) {
      return { accepted: false, reason: "ability-not-selectable" };
    }

    this.#inventory.consumeAbilityStone(inventoryIndex);
    this.#ownedAbilities.add(selectedAbilityId);
    return { accepted: true };
  }

  public assignAbility(
    slot: LoadoutSlot,
    abilityId: CombatAbilityId | null,
  ): LoadoutAssignmentResult {
    if (abilityId !== null && !this.#ownedAbilities.has(abilityId)) {
      return { accepted: false, reason: "ability-not-owned" };
    }

    const candidate = { ...this.#loadout, [slot]: abilityId };
    if (
      !LOADOUT_SLOTS.some(
        (candidateSlot) => candidate[candidateSlot] === BASIC_CLEAVE_ID,
      )
    ) {
      return { accepted: false, reason: "basic-cleave-required" };
    }

    this.#loadout[slot] = abilityId;
    return { accepted: true };
  }

  private occupied(slot: WearableSlot): EquipmentItemInstance | null {
    return isFlaskSlot(slot) ? this.#flasks[slot] : this.#equipment[slot];
  }

  private place(slot: WearableSlot, item: EquipmentItemInstance | null): void {
    if (isFlaskSlot(slot)) this.#flasks[slot] = item;
    else this.#equipment[slot] = item;
  }
}

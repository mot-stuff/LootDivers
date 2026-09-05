import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  WINTER_PULSE_ID,
  type CombatAbilityId,
} from "./combat-abilities";
import {
  EQUIPMENT_SLOTS,
  IMPLEMENTED_ABILITY_CATALOG,
  slotAcceptsKind,
  slotsForKind,
  type EquipmentSlot,
} from "./item-catalog";
import {
  equipmentSlotKindOf,
  modifiersForEquipment,
  type EquipmentItemInstance,
  type ItemInstance,
} from "./item-generation";
import { Inventory, type InventoryAddResult } from "./inventory";

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

export type EquipFailure = "not-equipment" | "empty-slot" | "incompatible-slot";

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

const LOADOUT_SLOTS: readonly LoadoutSlot[] = ["lmb", "q", "e", "r"];

function emptyEquipment(): Record<EquipmentSlot, EquipmentItemInstance | null> {
  const equipment = {} as Record<EquipmentSlot, EquipmentItemInstance | null>;
  for (const slot of EQUIPMENT_SLOTS) equipment[slot] = null;
  return equipment;
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

  public loadout(): Readonly<Record<LoadoutSlot, CombatAbilityId | null>> {
    return { ...this.#loadout };
  }

  public ownedAbilities(): readonly CombatAbilityId[] {
    return IMPLEMENTED_ABILITY_CATALOG.filter((id) =>
      this.#ownedAbilities.has(id),
    );
  }

  public addItem(item: ItemInstance): InventoryAddResult {
    if (
      EQUIPMENT_SLOTS.some(
        (slot) => this.#equipment[slot]?.instanceId === item.instanceId,
      )
    ) {
      return { accepted: false, reason: "duplicate-instance" };
    }
    return this.#inventory.add(item);
  }

  /**
   * Equips the item at the given inventory index. When `targetSlot` is
   * omitted, the slot is derived from the item's base: kinds with one
   * concrete slot use it, and rings prefer the first empty ring slot,
   * falling back to ring-1 (swapping its occupant). A provided `targetSlot`
   * must accept the item's slot kind or the command is rejected.
   */
  public equipFromInventory(
    inventoryIndex: number,
    targetSlot?: EquipmentSlot,
  ): EquipResult {
    const item = this.#inventory.itemAt(inventoryIndex);
    if (item === null) return { accepted: false, reason: "empty-slot" };
    if (item.kind !== "equipment") {
      return { accepted: false, reason: "not-equipment" };
    }

    const kind = equipmentSlotKindOf(item);
    let slot: EquipmentSlot;
    if (targetSlot !== undefined) {
      if (!slotAcceptsKind(targetSlot, kind)) {
        return { accepted: false, reason: "incompatible-slot" };
      }
      slot = targetSlot;
    } else {
      const candidates = slotsForKind(kind);
      slot =
        candidates.find((candidate) => this.#equipment[candidate] === null) ??
        candidates[0]!;
    }

    const previous = this.#equipment[slot];
    this.#inventory.take(inventoryIndex);
    this.#equipment[slot] = item;
    if (previous !== null) this.#inventory.putAt(inventoryIndex, previous);
    return { accepted: true };
  }

  public unequip(slot: EquipmentSlot): InventoryAddResult {
    const item = this.#equipment[slot];
    if (item === null) return { accepted: true };
    const result = this.#inventory.add(item);
    if (result.accepted) this.#equipment[slot] = null;
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
}

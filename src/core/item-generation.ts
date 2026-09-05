import {
  AFFIX_CATALOG,
  AFFIX_TIER_COUNT,
  type AffixDefinition,
  type EquipmentSlotKind,
  type GeneratableItemRarity,
  type ItemRarity,
  type ItemStatModifier,
  affixById,
  equipmentBaseById,
  isAffixLegalForBase,
} from "./item-catalog";
import { type ContentId, type PersistentInstanceId } from "./ids";
import { Mulberry32, type RandomSource } from "./random";

export interface RolledAffix {
  readonly affixId: ContentId;
  /** Tier 1 is the best (highest value range); tier 5 is the lowest. */
  readonly tier: number;
  readonly modifier: ItemStatModifier;
}

export interface EquipmentItemInstance {
  readonly kind: "equipment";
  readonly instanceId: PersistentInstanceId;
  readonly baseId: ContentId;
  readonly rarity: ItemRarity;
  readonly affixes: readonly RolledAffix[];
}

export interface AbilityStoneStack {
  readonly kind: "ability-stone";
  readonly instanceId: PersistentInstanceId;
  readonly quantity: number;
}

export type ItemInstance = EquipmentItemInstance | AbilityStoneStack;

export interface AffixCountRange {
  readonly minimum: number;
  readonly maximum: number;
}

/**
 * Inclusive affix-count ranges per generatable rarity. Unique is reserved in
 * the rarity model and intentionally has no generation rule.
 */
export const AFFIX_COUNTS_BY_RARITY: Readonly<
  Record<GeneratableItemRarity, AffixCountRange>
> = {
  common: { minimum: 0, maximum: 0 },
  magic: { minimum: 1, maximum: 2 },
  rare: { minimum: 3, maximum: 4 },
};

/**
 * Relative roll weights for tiers 1 through 5. Lower tiers are more common:
 * tier N has weight N, so tier 1 rolls at 1/15 and tier 5 at 5/15.
 */
export const AFFIX_TIER_WEIGHTS: readonly number[] = [1, 2, 3, 4, 5] as const;

function isGeneratableRarity(
  rarity: ItemRarity,
): rarity is GeneratableItemRarity {
  return rarity !== "unique";
}

function rollAffixTier(random: RandomSource): number {
  const totalWeight = AFFIX_TIER_WEIGHTS.reduce(
    (total, weight) => total + weight,
    0,
  );
  const roll = random.nextInteger(totalWeight);
  let cumulative = 0;
  for (let tier = 1; tier <= AFFIX_TIER_COUNT; tier += 1) {
    cumulative += AFFIX_TIER_WEIGHTS[tier - 1] ?? 0;
    if (roll < cumulative) return tier;
  }
  return AFFIX_TIER_COUNT;
}

function rollAffix(
  random: RandomSource,
  definition: AffixDefinition,
): RolledAffix {
  const tier = rollAffixTier(random);
  const range = definition.tiers[tier - 1];
  if (range === undefined) {
    throw new RangeError(
      `Affix "${definition.id}" is missing tier ${tier} data.`,
    );
  }
  const value =
    range.minimumValue +
    random.nextInteger(range.maximumValue - range.minimumValue + 1);

  if (definition.modifier.operation === "flat") {
    return {
      affixId: definition.id,
      tier,
      modifier: {
        statId: definition.modifier.statId,
        operation: "flat",
        value,
      },
    };
  }

  return {
    affixId: definition.id,
    tier,
    modifier: {
      statId: definition.modifier.statId,
      operation: "additive-basis-points",
      value,
    },
  };
}

export interface GenerateEquipmentItemOptions {
  readonly seed: number;
  readonly instanceId: PersistentInstanceId;
  readonly baseId: ContentId;
  readonly rarity: ItemRarity;
}

/**
 * Deterministic per seed. Draw order: affix count (only when the rarity's
 * range spans more than one value), then per affix a candidate index, a tier,
 * and a value within that tier's range.
 */
export function generateEquipmentItem(
  options: GenerateEquipmentItemOptions,
): EquipmentItemInstance {
  const base = equipmentBaseById(options.baseId);
  if (base === undefined) {
    throw new RangeError(`Unknown equipment base "${options.baseId}".`);
  }
  if (!isGeneratableRarity(options.rarity)) {
    throw new RangeError(
      `Rarity "${options.rarity}" is reserved and cannot be generated.`,
    );
  }

  const random = new Mulberry32(options.seed);
  const candidates = AFFIX_CATALOG.filter((affix) =>
    isAffixLegalForBase(affix, base),
  );
  const countRange = AFFIX_COUNTS_BY_RARITY[options.rarity];
  const count =
    countRange.minimum +
    (countRange.maximum > countRange.minimum
      ? random.nextInteger(countRange.maximum - countRange.minimum + 1)
      : 0);
  if (candidates.length < count) {
    throw new RangeError(
      `Equipment base "${base.id}" does not have ${count} legal affixes.`,
    );
  }

  const affixes: RolledAffix[] = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = random.nextInteger(candidates.length);
    const [selected] = candidates.splice(selectedIndex, 1);
    if (selected === undefined) throw new Error("Affix selection failed.");
    affixes.push(rollAffix(random, selected));
  }

  return {
    kind: "equipment",
    instanceId: options.instanceId,
    baseId: base.id,
    rarity: options.rarity,
    affixes,
  };
}

export function createAbilityStoneStack(
  instanceId: PersistentInstanceId,
  quantity = 1,
): AbilityStoneStack {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 9) {
    throw new RangeError("Ability Stone quantity must be from 1 through 9.");
  }
  return { kind: "ability-stone", instanceId, quantity };
}

export function modifiersForEquipment(
  item: EquipmentItemInstance,
): readonly ItemStatModifier[] {
  const base = equipmentBaseById(item.baseId);
  if (base === undefined) {
    throw new RangeError(`Unknown equipment base "${item.baseId}".`);
  }
  if (!isGeneratableRarity(item.rarity)) {
    throw new RangeError(
      `Rarity "${item.rarity}" is reserved and has no legal instances.`,
    );
  }
  const countRange = AFFIX_COUNTS_BY_RARITY[item.rarity];
  if (
    item.affixes.length < countRange.minimum ||
    item.affixes.length > countRange.maximum
  ) {
    throw new RangeError(`Invalid affix count for ${item.rarity} item.`);
  }
  const affixIds = new Set(item.affixes.map(({ affixId }) => affixId));
  if (affixIds.size !== item.affixes.length) {
    throw new RangeError("An equipment item cannot repeat an affix.");
  }
  for (const rolled of item.affixes) {
    const definition = affixById(rolled.affixId);
    const tierRange =
      Number.isSafeInteger(rolled.tier) &&
      rolled.tier >= 1 &&
      rolled.tier <= AFFIX_TIER_COUNT
        ? definition?.tiers[rolled.tier - 1]
        : undefined;
    if (
      definition === undefined ||
      tierRange === undefined ||
      !isAffixLegalForBase(definition, base) ||
      definition.modifier.statId !== rolled.modifier.statId ||
      definition.modifier.operation !== rolled.modifier.operation ||
      rolled.modifier.value < tierRange.minimumValue ||
      rolled.modifier.value > tierRange.maximumValue
    ) {
      throw new RangeError(`Invalid affix "${rolled.affixId}" on item.`);
    }
  }
  return [
    ...base.baseModifiers,
    ...item.affixes.map(({ modifier }) => modifier),
  ];
}

export function equipmentSlotKindOf(
  item: EquipmentItemInstance,
): EquipmentSlotKind {
  const base = equipmentBaseById(item.baseId);
  if (base === undefined) {
    throw new RangeError(`Unknown equipment base "${item.baseId}".`);
  }
  return base.slot;
}

import {
  AFFIX_CATALOG,
  type EquipmentBaseDefinition,
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

const AFFIX_COUNT_BY_RARITY: Readonly<Record<ItemRarity, number>> = {
  common: 0,
  magic: 1,
  rare: 2,
};

function rollAffixValue(
  random: RandomSource,
  minimum: number,
  maximum: number,
): number {
  return minimum + random.nextInteger(maximum - minimum + 1);
}

function rollAffix(
  random: RandomSource,
  definition: (typeof AFFIX_CATALOG)[number],
): RolledAffix {
  const value = rollAffixValue(
    random,
    definition.modifier.minimumValue,
    definition.modifier.maximumValue,
  );

  if (definition.modifier.operation === "flat") {
    return {
      affixId: definition.id,
      modifier: {
        statId: definition.modifier.statId,
        operation: "flat",
        value,
      },
    };
  }

  return {
    affixId: definition.id,
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

export function generateEquipmentItem(
  options: GenerateEquipmentItemOptions,
): EquipmentItemInstance {
  const base = equipmentBaseById(options.baseId);
  if (base === undefined) {
    throw new RangeError(`Unknown equipment base "${options.baseId}".`);
  }

  const random = new Mulberry32(options.seed);
  const candidates = AFFIX_CATALOG.filter((affix) =>
    isAffixLegalForBase(affix, base),
  );
  const count = AFFIX_COUNT_BY_RARITY[options.rarity];
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
  if (item.affixes.length !== AFFIX_COUNT_BY_RARITY[item.rarity]) {
    throw new RangeError(`Invalid affix count for ${item.rarity} item.`);
  }
  const affixIds = new Set(item.affixes.map(({ affixId }) => affixId));
  if (affixIds.size !== item.affixes.length) {
    throw new RangeError("An equipment item cannot repeat an affix.");
  }
  for (const rolled of item.affixes) {
    const definition = affixById(rolled.affixId);
    if (
      definition === undefined ||
      !isAffixLegalForBase(definition, base) ||
      definition.modifier.statId !== rolled.modifier.statId ||
      definition.modifier.operation !== rolled.modifier.operation ||
      rolled.modifier.value < definition.modifier.minimumValue ||
      rolled.modifier.value > definition.modifier.maximumValue
    ) {
      throw new RangeError(`Invalid affix "${rolled.affixId}" on item.`);
    }
  }
  return [
    ...base.baseModifiers,
    ...item.affixes.map(({ modifier }) => modifier),
  ];
}

export function equipmentSlotOf(
  item: EquipmentItemInstance,
): EquipmentBaseDefinition["slot"] {
  const base = equipmentBaseById(item.baseId);
  if (base === undefined) {
    throw new RangeError(`Unknown equipment base "${item.baseId}".`);
  }
  return base.slot;
}

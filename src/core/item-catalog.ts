import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  OUTGOING_DAMAGE_STAT_ID,
  WINTER_PULSE_ID,
  type CombatAbilityId,
} from "./combat-abilities";
import { contentId, type ContentId } from "./ids";

export const MAXIMUM_HEALTH_STAT_ID = contentId("stat:maximum-health");
export const ABILITY_STONE_BASE_ID = contentId("item:ability-stone");

export type EquipmentSlot = "main-hand" | "chest" | "amulet";
export type ItemRarity = "common" | "magic" | "rare";

export interface MaximumHealthModifier {
  readonly statId: typeof MAXIMUM_HEALTH_STAT_ID;
  readonly operation: "flat";
  readonly value: number;
}

export interface OutgoingAbilityDamageModifier {
  readonly statId: typeof OUTGOING_DAMAGE_STAT_ID;
  readonly operation: "additive-basis-points";
  readonly value: number;
}

export type ItemStatModifier =
  MaximumHealthModifier | OutgoingAbilityDamageModifier;

export interface EquipmentBaseDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly slot: EquipmentSlot;
  readonly tags: readonly ContentId[];
  readonly baseModifiers: readonly ItemStatModifier[];
}

export type AffixModifierDefinition =
  | (Omit<MaximumHealthModifier, "value"> & {
      readonly minimumValue: number;
      readonly maximumValue: number;
    })
  | (Omit<OutgoingAbilityDamageModifier, "value"> & {
      readonly minimumValue: number;
      readonly maximumValue: number;
    });

export interface AffixDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly allowedSlots: readonly EquipmentSlot[];
  readonly requiredTags: readonly ContentId[];
  readonly modifier: AffixModifierDefinition;
}

const tag = (name: string): ContentId => contentId(`tag:${name}`);

export const EQUIPMENT_BASE_CATALOG: readonly EquipmentBaseDefinition[] = [
  {
    id: contentId("item:worn-cleaver"),
    displayName: "Worn Cleaver",
    slot: "main-hand",
    tags: [tag("equipment"), tag("weapon"), tag("melee")],
    baseModifiers: [
      {
        statId: OUTGOING_DAMAGE_STAT_ID,
        operation: "additive-basis-points",
        value: 500,
      },
    ],
  },
  {
    id: contentId("item:trailguard-vest"),
    displayName: "Trailguard Vest",
    slot: "chest",
    tags: [tag("equipment"), tag("armor")],
    baseModifiers: [
      { statId: MAXIMUM_HEALTH_STAT_ID, operation: "flat", value: 10 },
    ],
  },
  {
    id: contentId("item:wayfinder-amulet"),
    displayName: "Wayfinder Amulet",
    slot: "amulet",
    tags: [tag("equipment"), tag("jewelry")],
    baseModifiers: [],
  },
] as const;

export const AFFIX_CATALOG: readonly AffixDefinition[] = [
  {
    id: contentId("affix:tempered"),
    displayName: "Tempered",
    allowedSlots: ["main-hand"],
    requiredTags: [tag("weapon")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
      minimumValue: 400,
      maximumValue: 800,
    },
  },
  {
    id: contentId("affix:steadfast-grip"),
    displayName: "Steadfast Grip",
    allowedSlots: ["main-hand"],
    requiredTags: [tag("melee")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
      minimumValue: 3,
      maximumValue: 7,
    },
  },
  {
    id: contentId("affix:reinforced"),
    displayName: "Reinforced",
    allowedSlots: ["chest"],
    requiredTags: [tag("armor")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
      minimumValue: 8,
      maximumValue: 16,
    },
  },
  {
    id: contentId("affix:battlewoven"),
    displayName: "Battlewoven",
    allowedSlots: ["chest"],
    requiredTags: [tag("armor")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
      minimumValue: 200,
      maximumValue: 500,
    },
  },
  {
    id: contentId("affix:hearty"),
    displayName: "Hearty",
    allowedSlots: ["amulet"],
    requiredTags: [tag("jewelry")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
      minimumValue: 5,
      maximumValue: 12,
    },
  },
  {
    id: contentId("affix:focused"),
    displayName: "Focused",
    allowedSlots: ["amulet"],
    requiredTags: [tag("jewelry")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
      minimumValue: 300,
      maximumValue: 700,
    },
  },
] as const;

export const IMPLEMENTED_ABILITY_CATALOG: readonly CombatAbilityId[] = [
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  WINTER_PULSE_ID,
  DEFIANT_SIGNAL_ID,
] as const;

export function equipmentBaseById(
  id: ContentId,
): EquipmentBaseDefinition | undefined {
  return EQUIPMENT_BASE_CATALOG.find((definition) => definition.id === id);
}

export function affixById(id: ContentId): AffixDefinition | undefined {
  return AFFIX_CATALOG.find((definition) => definition.id === id);
}

export function isAffixLegalForBase(
  affix: AffixDefinition,
  base: EquipmentBaseDefinition,
): boolean {
  return (
    affix.allowedSlots.includes(base.slot) &&
    affix.requiredTags.every((required) => base.tags.includes(required))
  );
}

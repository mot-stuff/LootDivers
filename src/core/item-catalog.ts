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
export const FLASK_RECOVERY_STAT_ID = contentId("stat:flask-recovery");
export const FLASK_DURATION_DECISECONDS_STAT_ID = contentId(
  "stat:flask-duration-deciseconds",
);
export const FLASK_CHARGES_STAT_ID = contentId("stat:flask-charges");
export const FLASK_CHARGES_USED_STAT_ID = contentId("stat:flask-charges-used");
export const FLASK_CHARGES_USED_REDUCTION_STAT_ID = contentId(
  "stat:flask-charges-used-reduction",
);
export const FLASK_INSTANT_RECOVERY_STAT_ID = contentId(
  "stat:flask-instant-recovery",
);
export const FLASK_RECOVERY_RATE_STAT_ID = contentId(
  "stat:flask-recovery-rate",
);
export const FLASK_CHARGES_ON_KILL_STAT_ID = contentId(
  "stat:flask-charges-on-kill",
);
export const ABILITY_STONE_BASE_ID = contentId("item:ability-stone");

/**
 * The slot category a base item is forged for. Most kinds map to exactly one
 * character equipment slot; the "ring" kind may be equipped into either
 * concrete ring slot.
 */
export type EquipmentSlotKind =
  | "helmet"
  | "chest"
  | "amulet"
  | "belt"
  | "boots"
  | "main-hand"
  | "offhand"
  | "ring"
  | "flask";

export type FlaskSlot = "flask-1" | "flask-2" | "flask-3" | "flask-4";

export const FLASK_SLOTS: readonly FlaskSlot[] = [
  "flask-1",
  "flask-2",
  "flask-3",
  "flask-4",
] as const;

export function isFlaskSlot(slot: string): slot is FlaskSlot {
  return (FLASK_SLOTS as readonly string[]).includes(slot);
}

/** A concrete equipment slot on the character. */
export type EquipmentSlot =
  | "helmet"
  | "chest"
  | "amulet"
  | "belt"
  | "boots"
  | "main-hand"
  | "offhand"
  | "ring-1"
  | "ring-2";

/** The nine character equipment slots in presentation order. */
export const EQUIPMENT_SLOTS: readonly EquipmentSlot[] = [
  "helmet",
  "chest",
  "amulet",
  "belt",
  "boots",
  "main-hand",
  "offhand",
  "ring-1",
  "ring-2",
] as const;

export type WearableSlot = EquipmentSlot | FlaskSlot;

const SLOTS_BY_KIND: Readonly<
  Record<EquipmentSlotKind, readonly WearableSlot[]>
> = {
  helmet: ["helmet"],
  chest: ["chest"],
  amulet: ["amulet"],
  belt: ["belt"],
  boots: ["boots"],
  "main-hand": ["main-hand"],
  offhand: ["offhand"],
  ring: ["ring-1", "ring-2"],
  flask: FLASK_SLOTS,
};

/**
 * Concrete character slots that can hold a base of the given kind, in default
 * placement preference order.
 */
export function slotsForKind(kind: EquipmentSlotKind): readonly WearableSlot[] {
  return SLOTS_BY_KIND[kind];
}

export function slotAcceptsKind(
  slot: WearableSlot,
  kind: EquipmentSlotKind,
): boolean {
  return SLOTS_BY_KIND[kind].includes(slot);
}

/**
 * Unique exists in the model but is reserved: Phase 3 generation and enemy
 * loot never produce it.
 */
export type ItemRarity = "common" | "magic" | "rare" | "unique";
export type GeneratableItemRarity = Exclude<ItemRarity, "unique">;

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

export interface FlaskModifier {
  readonly statId: ContentId;
  readonly operation: "flat" | "additive-basis-points";
  readonly value: number;
}

export type ItemStatModifier =
  MaximumHealthModifier | OutgoingAbilityDamageModifier | FlaskModifier;

export interface EquipmentBaseDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly slot: EquipmentSlotKind;
  readonly tags: readonly ContentId[];
  readonly baseModifiers: readonly ItemStatModifier[];
}

export type AffixModifierDefinition =
  | Omit<MaximumHealthModifier, "value">
  | Omit<OutgoingAbilityDamageModifier, "value">
  | Omit<FlaskModifier, "value">;

/** Inclusive integer value range for one affix tier. */
export interface AffixTierRange {
  readonly minimumValue: number;
  readonly maximumValue: number;
}

export const AFFIX_TIER_COUNT = 5;

/**
 * Exactly five tier ranges. Index 0 is tier 1 (the best, highest values);
 * index 4 is tier 5 (the lowest values).
 */
export type AffixTierRanges = readonly [
  AffixTierRange,
  AffixTierRange,
  AffixTierRange,
  AffixTierRange,
  AffixTierRange,
];

export interface AffixDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly allowedSlots: readonly EquipmentSlotKind[];
  readonly requiredTags: readonly ContentId[];
  readonly modifier: AffixModifierDefinition;
  readonly tiers: AffixTierRanges;
}

const tag = (name: string): ContentId => contentId(`tag:${name}`);

const ALL_SLOT_KINDS: readonly EquipmentSlotKind[] = [
  "helmet",
  "chest",
  "amulet",
  "belt",
  "boots",
  "main-hand",
  "offhand",
  "ring",
] as const;

const ARMOR_SLOT_KINDS: readonly EquipmentSlotKind[] = [
  "helmet",
  "chest",
  "belt",
  "boots",
  "offhand",
] as const;

const JEWELRY_SLOT_KINDS: readonly EquipmentSlotKind[] = [
  "amulet",
  "ring",
] as const;

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
  {
    id: contentId("item:lookout-casque"),
    displayName: "Lookout Casque",
    slot: "helmet",
    tags: [tag("equipment"), tag("armor")],
    baseModifiers: [
      { statId: MAXIMUM_HEALTH_STAT_ID, operation: "flat", value: 5 },
    ],
  },
  {
    id: contentId("item:cinchweave-belt"),
    displayName: "Cinchweave Belt",
    slot: "belt",
    tags: [tag("equipment"), tag("armor")],
    baseModifiers: [
      { statId: MAXIMUM_HEALTH_STAT_ID, operation: "flat", value: 4 },
    ],
  },
  {
    id: contentId("item:drifter-treads"),
    displayName: "Drifter Treads",
    slot: "boots",
    tags: [tag("equipment"), tag("armor")],
    baseModifiers: [
      { statId: MAXIMUM_HEALTH_STAT_ID, operation: "flat", value: 3 },
    ],
  },
  {
    id: contentId("item:splintered-buckler"),
    displayName: "Splintered Buckler",
    slot: "offhand",
    tags: [tag("equipment"), tag("armor")],
    baseModifiers: [
      { statId: MAXIMUM_HEALTH_STAT_ID, operation: "flat", value: 6 },
    ],
  },
  {
    id: contentId("item:plain-loopband"),
    displayName: "Plain Loopband",
    slot: "ring",
    tags: [tag("equipment"), tag("jewelry")],
    baseModifiers: [],
  },
] as const;

export const FLASK_BASE_CATALOG: readonly EquipmentBaseDefinition[] = [
  {
    id: contentId("item:heartwell-flask"),
    displayName: "Heartwell Flask",
    slot: "flask",
    tags: [tag("flask"), tag("life-flask")],
    baseModifiers: [
      { statId: FLASK_RECOVERY_STAT_ID, operation: "flat", value: 70 },
      {
        statId: FLASK_DURATION_DECISECONDS_STAT_ID,
        operation: "flat",
        value: 50,
      },
      { statId: FLASK_CHARGES_STAT_ID, operation: "flat", value: 30 },
      { statId: FLASK_CHARGES_USED_STAT_ID, operation: "flat", value: 20 },
    ],
  },
  {
    id: contentId("item:mindwell-flask"),
    displayName: "Mindwell Flask",
    slot: "flask",
    tags: [tag("flask"), tag("mana-flask")],
    baseModifiers: [
      { statId: FLASK_RECOVERY_STAT_ID, operation: "flat", value: 50 },
      {
        statId: FLASK_DURATION_DECISECONDS_STAT_ID,
        operation: "flat",
        value: 40,
      },
      { statId: FLASK_CHARGES_STAT_ID, operation: "flat", value: 30 },
      { statId: FLASK_CHARGES_USED_STAT_ID, operation: "flat", value: 20 },
    ],
  },
] as const;

export const ITEM_BASE_CATALOG: readonly EquipmentBaseDefinition[] = [
  ...EQUIPMENT_BASE_CATALOG,
  ...FLASK_BASE_CATALOG,
];

export const AFFIX_CATALOG: readonly AffixDefinition[] = [
  {
    id: contentId("affix:tempered"),
    displayName: "Tempered",
    allowedSlots: ["main-hand"],
    requiredTags: [tag("weapon")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
    },
    tiers: [
      { minimumValue: 701, maximumValue: 800 },
      { minimumValue: 601, maximumValue: 700 },
      { minimumValue: 501, maximumValue: 600 },
      { minimumValue: 401, maximumValue: 500 },
      { minimumValue: 300, maximumValue: 400 },
    ],
  },
  {
    id: contentId("affix:steadfast-grip"),
    displayName: "Steadfast Grip",
    allowedSlots: ["main-hand"],
    requiredTags: [tag("melee")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 11, maximumValue: 13 },
      { minimumValue: 9, maximumValue: 10 },
      { minimumValue: 7, maximumValue: 8 },
      { minimumValue: 5, maximumValue: 6 },
      { minimumValue: 3, maximumValue: 4 },
    ],
  },
  {
    id: contentId("affix:reinforced"),
    displayName: "Reinforced",
    allowedSlots: ARMOR_SLOT_KINDS,
    requiredTags: [tag("armor")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 17, maximumValue: 20 },
      { minimumValue: 14, maximumValue: 16 },
      { minimumValue: 11, maximumValue: 13 },
      { minimumValue: 8, maximumValue: 10 },
      { minimumValue: 5, maximumValue: 7 },
    ],
  },
  {
    id: contentId("affix:battlewoven"),
    displayName: "Battlewoven",
    allowedSlots: ARMOR_SLOT_KINDS,
    requiredTags: [tag("armor")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
    },
    tiers: [
      { minimumValue: 501, maximumValue: 600 },
      { minimumValue: 401, maximumValue: 500 },
      { minimumValue: 301, maximumValue: 400 },
      { minimumValue: 201, maximumValue: 300 },
      { minimumValue: 100, maximumValue: 200 },
    ],
  },
  {
    id: contentId("affix:hearty"),
    displayName: "Hearty",
    allowedSlots: JEWELRY_SLOT_KINDS,
    requiredTags: [tag("jewelry")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 13, maximumValue: 15 },
      { minimumValue: 11, maximumValue: 12 },
      { minimumValue: 9, maximumValue: 10 },
      { minimumValue: 7, maximumValue: 8 },
      { minimumValue: 5, maximumValue: 6 },
    ],
  },
  {
    id: contentId("affix:focused"),
    displayName: "Focused",
    allowedSlots: JEWELRY_SLOT_KINDS,
    requiredTags: [tag("jewelry")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
    },
    tiers: [
      { minimumValue: 601, maximumValue: 700 },
      { minimumValue: 501, maximumValue: 600 },
      { minimumValue: 401, maximumValue: 500 },
      { minimumValue: 301, maximumValue: 400 },
      { minimumValue: 200, maximumValue: 300 },
    ],
  },
  {
    id: contentId("affix:vigorous"),
    displayName: "Vigorous",
    allowedSlots: ALL_SLOT_KINDS,
    requiredTags: [tag("equipment")],
    modifier: {
      statId: MAXIMUM_HEALTH_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 9, maximumValue: 10 },
      { minimumValue: 7, maximumValue: 8 },
      { minimumValue: 5, maximumValue: 6 },
      { minimumValue: 3, maximumValue: 4 },
      { minimumValue: 1, maximumValue: 2 },
    ],
  },
  {
    id: contentId("affix:keen"),
    displayName: "Keen",
    allowedSlots: ALL_SLOT_KINDS,
    requiredTags: [tag("equipment")],
    modifier: {
      statId: OUTGOING_DAMAGE_STAT_ID,
      operation: "additive-basis-points",
    },
    tiers: [
      { minimumValue: 401, maximumValue: 450 },
      { minimumValue: 301, maximumValue: 400 },
      { minimumValue: 201, maximumValue: 300 },
      { minimumValue: 101, maximumValue: 200 },
      { minimumValue: 50, maximumValue: 100 },
    ],
  },
  {
    id: contentId("affix:brimming"),
    displayName: "Brimming",
    allowedSlots: ["flask"],
    requiredTags: [tag("flask")],
    modifier: {
      statId: FLASK_RECOVERY_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 28, maximumValue: 32 },
      { minimumValue: 23, maximumValue: 27 },
      { minimumValue: 18, maximumValue: 22 },
      { minimumValue: 13, maximumValue: 17 },
      { minimumValue: 8, maximumValue: 12 },
    ],
  },
  {
    id: contentId("affix:sudden"),
    displayName: "Sudden",
    allowedSlots: ["flask"],
    requiredTags: [tag("flask")],
    modifier: {
      statId: FLASK_INSTANT_RECOVERY_STAT_ID,
      operation: "additive-basis-points",
    },
    tiers: [
      { minimumValue: 2500, maximumValue: 3000 },
      { minimumValue: 2000, maximumValue: 2499 },
      { minimumValue: 1500, maximumValue: 1999 },
      { minimumValue: 1000, maximumValue: 1499 },
      { minimumValue: 500, maximumValue: 999 },
    ],
  },
  {
    id: contentId("affix:fleetpour"),
    displayName: "Fleetpour",
    allowedSlots: ["flask"],
    requiredTags: [tag("flask")],
    modifier: {
      statId: FLASK_RECOVERY_RATE_STAT_ID,
      operation: "additive-basis-points",
    },
    tiers: [
      { minimumValue: 4000, maximumValue: 5000 },
      { minimumValue: 3000, maximumValue: 3999 },
      { minimumValue: 2000, maximumValue: 2999 },
      { minimumValue: 1200, maximumValue: 1999 },
      { minimumValue: 500, maximumValue: 1199 },
    ],
  },
  {
    id: contentId("affix:deep-reserve"),
    displayName: "Deep Reserve",
    allowedSlots: ["flask"],
    requiredTags: [tag("flask")],
    modifier: {
      statId: FLASK_CHARGES_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 12, maximumValue: 14 },
      { minimumValue: 10, maximumValue: 11 },
      { minimumValue: 8, maximumValue: 9 },
      { minimumValue: 6, maximumValue: 7 },
      { minimumValue: 4, maximumValue: 5 },
    ],
  },
  {
    id: contentId("affix:thrifty"),
    displayName: "Thrifty",
    allowedSlots: ["flask"],
    requiredTags: [tag("flask")],
    modifier: {
      statId: FLASK_CHARGES_USED_REDUCTION_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 8, maximumValue: 9 },
      { minimumValue: 6, maximumValue: 7 },
      { minimumValue: 5, maximumValue: 5 },
      { minimumValue: 3, maximumValue: 4 },
      { minimumValue: 2, maximumValue: 2 },
    ],
  },
  {
    id: contentId("affix:reaping"),
    displayName: "Reaping",
    allowedSlots: ["flask"],
    requiredTags: [tag("flask")],
    modifier: {
      statId: FLASK_CHARGES_ON_KILL_STAT_ID,
      operation: "flat",
    },
    tiers: [
      { minimumValue: 5, maximumValue: 5 },
      { minimumValue: 4, maximumValue: 4 },
      { minimumValue: 3, maximumValue: 3 },
      { minimumValue: 2, maximumValue: 2 },
      { minimumValue: 1, maximumValue: 1 },
    ],
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
  return ITEM_BASE_CATALOG.find((definition) => definition.id === id);
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

export function formatItemModifierLabel(modifier: ItemStatModifier): string {
  if (modifier.statId === MAXIMUM_HEALTH_STAT_ID) {
    return `+${modifier.value} maximum health`;
  }
  if (modifier.statId === OUTGOING_DAMAGE_STAT_ID) {
    return `+${modifier.value / 100}% outgoing ability damage`;
  }
  if (modifier.statId === FLASK_RECOVERY_STAT_ID) {
    return `+${modifier.value} recovery`;
  }
  if (modifier.statId === FLASK_DURATION_DECISECONDS_STAT_ID) {
    return `${(modifier.value / 10).toFixed(1)}s recovery time`;
  }
  if (modifier.statId === FLASK_CHARGES_STAT_ID) {
    return `+${modifier.value} maximum charges`;
  }
  if (modifier.statId === FLASK_CHARGES_USED_STAT_ID) {
    return `Consumes ${modifier.value} charges`;
  }
  if (modifier.statId === FLASK_CHARGES_USED_REDUCTION_STAT_ID) {
    return `-${modifier.value} charges used`;
  }
  if (modifier.statId === FLASK_INSTANT_RECOVERY_STAT_ID) {
    return `${modifier.value / 100}% recovered instantly`;
  }
  if (modifier.statId === FLASK_RECOVERY_RATE_STAT_ID) {
    return `+${modifier.value / 100}% recovery rate`;
  }
  if (modifier.statId === FLASK_CHARGES_ON_KILL_STAT_ID) {
    return `+${modifier.value} charges gained on kill`;
  }
  return `${modifier.value} ${String(modifier.statId)}`;
}

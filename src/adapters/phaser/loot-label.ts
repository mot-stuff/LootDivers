import {
  equipmentBaseById,
  materialById,
  type ItemInstance,
  type ItemRarity,
} from "../../core";

/**
 * Ground-label text colors per equipment rarity, classic-ARPG style. Unique
 * cannot drop yet (the rarity is reserved), but its color is part of the
 * presentation contract and resolves through the same lookup.
 */
export const LOOT_LABEL_RARITY_COLORS: Readonly<Record<ItemRarity, string>> = {
  common: "#ffffff",
  magic: "#60a5fa",
  rare: "#ffd166",
  unique: "#ff8000",
};

/**
 * Ability Stones are common rarity in the HUD model, but their ground label
 * keeps the purple accent already used by their world marker so they stay
 * distinguishable from common equipment at a glance.
 */
export const ABILITY_STONE_LABEL_COLOR = "#c084fc";
export const MATERIAL_LABEL_COLOR = "#d97706";

export interface WorldLootLabel {
  /** Compact base display name; affix-decorated names are menu-only. */
  readonly text: string;
  /** CSS hex color string. */
  readonly color: string;
}

/** Derives the floating ground-label content for one world drop's item. */
export function worldLootLabel(item: ItemInstance): WorldLootLabel {
  if (item.kind === "ability-stone") {
    return { text: "Ability Stone", color: ABILITY_STONE_LABEL_COLOR };
  }
  if (item.kind === "material") {
    return {
      text: materialById(item.materialId)?.displayName ?? "Ore",
      color: MATERIAL_LABEL_COLOR,
    };
  }
  return {
    text: equipmentBaseById(item.baseId)?.displayName ?? String(item.baseId),
    color: LOOT_LABEL_RARITY_COLORS[item.rarity],
  };
}

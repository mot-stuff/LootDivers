import { describe, expect, it } from "vitest";

import {
  ABILITY_STONE_LABEL_COLOR,
  LOOT_LABEL_RARITY_COLORS,
  worldLootLabel,
} from "../../src/adapters/phaser/loot-label";
import {
  EQUIPMENT_BASE_CATALOG,
  FLASK_BASE_CATALOG,
  createAbilityStoneStack,
  persistentInstanceId,
  type EquipmentItemInstance,
  type ItemRarity,
} from "../../src/core";

const ALL_RARITIES: readonly ItemRarity[] = [
  "common",
  "magic",
  "rare",
  "unique",
];

function equipment(rarity: ItemRarity): EquipmentItemInstance {
  return {
    kind: "equipment",
    instanceId: persistentInstanceId(`test:loot-label-${rarity}`),
    baseId: EQUIPMENT_BASE_CATALOG[0]!.id,
    rarity,
    affixes: [],
  };
}

describe("worldLootLabel", () => {
  it("uses the base display name, never an affix-decorated name", () => {
    for (const [index, base] of [
      ...EQUIPMENT_BASE_CATALOG,
      ...FLASK_BASE_CATALOG,
    ].entries()) {
      const label = worldLootLabel({
        kind: "equipment",
        instanceId: persistentInstanceId(`test:loot-label-base-${index}`),
        baseId: base.id,
        rarity: "rare",
        affixes: [],
      });
      expect(label.text).toBe(base.displayName);
    }
  });

  it("colors every rarity, including the reserved unique orange", () => {
    expect(
      ALL_RARITIES.map((rarity) => worldLootLabel(equipment(rarity))),
    ).toEqual([
      expect.objectContaining({ color: "#ffffff" }),
      expect.objectContaining({ color: "#60a5fa" }),
      expect.objectContaining({ color: "#ffd166" }),
      expect.objectContaining({ color: "#ff8000" }),
    ]);
    for (const rarity of ALL_RARITIES) {
      expect(LOOT_LABEL_RARITY_COLORS[rarity]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("labels Ability Stones by name with the purple marker accent", () => {
    const label = worldLootLabel(
      createAbilityStoneStack(persistentInstanceId("test:loot-label-stone")),
    );
    expect(label).toEqual({
      text: "Ability Stone",
      color: ABILITY_STONE_LABEL_COLOR,
    });
    expect(ABILITY_STONE_LABEL_COLOR).toBe("#c084fc");
  });
});

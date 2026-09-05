import { describe, expect, it } from "vitest";

import {
  AFFIX_CATALOG,
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  EQUIPMENT_BASE_CATALOG,
  INVENTORY_SLOT_COUNT,
  CharacterItemLoadout,
  Inventory,
  affixById,
  applyOutgoingAbilityDamage,
  createAbilityStoneStack,
  generateEquipmentItem,
  isAffixLegalForBase,
  modifiersForEquipment,
  persistentInstanceId,
  type ItemRarity,
} from "../../src/core";

const MAIN_HAND_ID = EQUIPMENT_BASE_CATALOG[0]!.id;
const CHEST_ID = EQUIPMENT_BASE_CATALOG[1]!.id;
const AMULET_ID = EQUIPMENT_BASE_CATALOG[2]!.id;

function equipment(
  serial: number,
  baseId = MAIN_HAND_ID,
  rarity: ItemRarity = "common",
  seed = serial,
) {
  return generateEquipmentItem({
    seed,
    instanceId: persistentInstanceId(`item:test-${serial}`),
    baseId,
    rarity,
  });
}

describe("Phase 3 item generation", () => {
  it("repeats the complete generated result for a seed", () => {
    const options = {
      seed: 0x1234_5678,
      instanceId: persistentInstanceId("item:repeatable"),
      baseId: AMULET_ID,
      rarity: "rare" as const,
    };

    expect(generateEquipmentItem(options)).toEqual(
      generateEquipmentItem(options),
    );
    expect(generateEquipmentItem({ ...options, seed: 7 })).not.toEqual(
      generateEquipmentItem(options),
    );
  });

  it("enforces rarity counts, legal affixes, values, and no duplicates", () => {
    const counts: Readonly<Record<ItemRarity, number>> = {
      common: 0,
      magic: 1,
      rare: 2,
    };

    for (const base of EQUIPMENT_BASE_CATALOG) {
      for (const rarity of ["common", "magic", "rare"] as const) {
        for (let seed = 0; seed < 25; seed += 1) {
          const item = equipment(seed, base.id, rarity, seed);
          expect(item.affixes).toHaveLength(counts[rarity]);
          expect(new Set(item.affixes.map(({ affixId }) => affixId)).size).toBe(
            item.affixes.length,
          );
          for (const rolled of item.affixes) {
            const definition = affixById(rolled.affixId);
            expect(definition).toBeDefined();
            expect(isAffixLegalForBase(definition!, base)).toBe(true);
            expect(rolled.modifier.value).toBeGreaterThanOrEqual(
              definition!.modifier.minimumValue,
            );
            expect(rolled.modifier.value).toBeLessThanOrEqual(
              definition!.modifier.maximumValue,
            );
          }
        }
      }
    }
    expect(AFFIX_CATALOG.length).toBeGreaterThanOrEqual(6);
  });
});

describe("Phase 3 inventory and equipment", () => {
  it("bounds inventory, keeps equipment non-stackable, and stacks stones to nine", () => {
    const inventory = new Inventory();
    expect(
      inventory.add(
        createAbilityStoneStack(persistentInstanceId("item:stones-a"), 8),
      ),
    ).toEqual({ accepted: true });
    expect(
      inventory.add(
        createAbilityStoneStack(persistentInstanceId("item:stones-b"), 3),
      ),
    ).toEqual({ accepted: true });
    expect(inventory.slots().slice(0, 2)).toEqual([
      expect.objectContaining({ kind: "ability-stone", quantity: 9 }),
      expect.objectContaining({ kind: "ability-stone", quantity: 2 }),
    ]);

    for (let index = 0; index < INVENTORY_SLOT_COUNT - 2; index += 1) {
      expect(inventory.add(equipment(index))).toEqual({ accepted: true });
    }
    expect(inventory.add(equipment(99))).toEqual({
      accepted: false,
      reason: "inventory-full",
    });
    expect(
      inventory.slots().filter((item) => item?.kind === "equipment"),
    ).toHaveLength(10);
  });

  it("swaps equipped items and additively aggregates only the two prototype stats", () => {
    const character = new CharacterItemLoadout();
    const commonWeapon = equipment(1, MAIN_HAND_ID);
    const rareWeapon = equipment(2, MAIN_HAND_ID, "rare", 22);
    const chest = equipment(3, CHEST_ID);
    character.addItem(commonWeapon);
    character.addItem(rareWeapon);
    character.addItem(chest);

    expect(character.equipFromInventory(0)).toEqual({ accepted: true });
    expect(character.equipFromInventory(2)).toEqual({ accepted: true });
    expect(character.stats()).toEqual({
      maximumHealth: 110,
      outgoingAbilityDamageBasisPoints: 10_500,
      outgoingAbilityDamageMultiplier: 1.05,
    });

    expect(character.equipFromInventory(1)).toEqual({ accepted: true });
    expect(character.inventorySlots()[1]).toEqual(commonWeapon);
    expect(character.equipment()["main-hand"]).toEqual(rareWeapon);

    const expected = modifiersForEquipment(rareWeapon).reduce(
      (stats, modifier) => {
        if (modifier.operation === "flat") stats.health += modifier.value;
        else stats.damage += modifier.value;
        return stats;
      },
      { health: 110, damage: 10_000 },
    );
    expect(character.stats()).toMatchObject({
      maximumHealth: expected.health,
      outgoingAbilityDamageBasisPoints: expected.damage,
    });
    expect(applyOutgoingAbilityDamage(25, character.stats())).toBe(
      Math.floor((25 * expected.damage) / 10_000),
    );
  });
});

describe("Phase 3 Ability Stone and loadout ownership", () => {
  it("offers implemented choices, consumes one stone, and preserves Basic Cleave", () => {
    const character = new CharacterItemLoadout();
    character.addItem(
      createAbilityStoneStack(
        persistentInstanceId("item:selectable-stones"),
        2,
      ),
    );

    expect(character.abilityStoneChoices(0)).toContain(CINDER_DART_ID);
    expect(character.abilityStoneChoices(0)).not.toContain(BASIC_CLEAVE_ID);
    expect(character.consumeAbilityStone(0, CINDER_DART_ID)).toEqual({
      accepted: true,
    });
    expect(character.inventorySlots()[0]).toMatchObject({ quantity: 1 });
    expect(character.ownedAbilities()).toEqual([
      BASIC_CLEAVE_ID,
      CINDER_DART_ID,
    ]);

    expect(character.assignAbility("lmb", CINDER_DART_ID)).toEqual({
      accepted: false,
      reason: "basic-cleave-required",
    });
    expect(character.assignAbility("q", BASIC_CLEAVE_ID)).toEqual({
      accepted: true,
    });
    expect(character.assignAbility("lmb", CINDER_DART_ID)).toEqual({
      accepted: true,
    });
    expect(character.loadout()).toMatchObject({
      lmb: CINDER_DART_ID,
      q: BASIC_CLEAVE_ID,
    });
  });
});

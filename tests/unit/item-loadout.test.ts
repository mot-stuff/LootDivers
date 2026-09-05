import { describe, expect, it } from "vitest";

import {
  AFFIX_CATALOG,
  AFFIX_COUNTS_BY_RARITY,
  AFFIX_TIER_COUNT,
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  EQUIPMENT_BASE_CATALOG,
  FLASK_BASE_CATALOG,
  EQUIPMENT_SLOTS,
  INVENTORY_SLOT_COUNT,
  CharacterItemLoadout,
  Inventory,
  WINTER_PULSE_ID,
  affixById,
  applyOutgoingAbilityDamage,
  createAbilityStoneStack,
  generateEquipmentItem,
  isAffixLegalForBase,
  modifiersForEquipment,
  persistentInstanceId,
  slotsForKind,
  type ItemRarity,
} from "../../src/core";

const MAIN_HAND_ID = EQUIPMENT_BASE_CATALOG[0]!.id;
const CHEST_ID = EQUIPMENT_BASE_CATALOG[1]!.id;
const AMULET_ID = EQUIPMENT_BASE_CATALOG[2]!.id;
const RING_ID = EQUIPMENT_BASE_CATALOG.find((base) => base.slot === "ring")!.id;
const GENERATABLE_RARITIES = ["common", "magic", "rare"] as const;

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

function expectedEquipmentStats(
  ...items: ReturnType<typeof generateEquipmentItem>[]
) {
  return items.reduce(
    (stats, item) => {
      for (const modifier of modifiersForEquipment(item)) {
        if (modifier.operation === "flat") stats.health += modifier.value;
        else stats.damage += modifier.value;
      }
      return stats;
    },
    { health: 100, damage: 10_000 },
  );
}

describe("Phase 3 item generation", () => {
  it("repeats the complete generated result, including tiers, for a seed", () => {
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

  it("enforces rarity counts, legal affixes, tier value ranges, and no duplicates", () => {
    for (const base of EQUIPMENT_BASE_CATALOG) {
      for (const rarity of GENERATABLE_RARITIES) {
        const seenCounts = new Set<number>();
        for (let seed = 0; seed < 40; seed += 1) {
          const item = equipment(seed, base.id, rarity, seed);
          const countRange = AFFIX_COUNTS_BY_RARITY[rarity];
          expect(item.affixes.length).toBeGreaterThanOrEqual(
            countRange.minimum,
          );
          expect(item.affixes.length).toBeLessThanOrEqual(countRange.maximum);
          seenCounts.add(item.affixes.length);
          expect(new Set(item.affixes.map(({ affixId }) => affixId)).size).toBe(
            item.affixes.length,
          );
          for (const rolled of item.affixes) {
            const definition = affixById(rolled.affixId);
            expect(definition).toBeDefined();
            expect(isAffixLegalForBase(definition!, base)).toBe(true);
            expect(rolled.tier).toBeGreaterThanOrEqual(1);
            expect(rolled.tier).toBeLessThanOrEqual(AFFIX_TIER_COUNT);
            const range = definition!.tiers[rolled.tier - 1]!;
            expect(rolled.modifier.value).toBeGreaterThanOrEqual(
              range.minimumValue,
            );
            expect(rolled.modifier.value).toBeLessThanOrEqual(
              range.maximumValue,
            );
          }
          expect(modifiersForEquipment(item).length).toBe(
            (EQUIPMENT_BASE_CATALOG.find(({ id }) => id === base.id)
              ?.baseModifiers.length ?? 0) + item.affixes.length,
          );
        }
        // Variable-count rarities exercise the whole documented range.
        for (
          let count = AFFIX_COUNTS_BY_RARITY[rarity].minimum;
          count <= AFFIX_COUNTS_BY_RARITY[rarity].maximum;
          count += 1
        ) {
          expect(seenCounts).toContain(count);
        }
      }
    }
    expect(AFFIX_CATALOG.length).toBeGreaterThanOrEqual(8);
  });

  it("guarantees every base can legally roll the rare maximum with distinct affixes", () => {
    for (const base of EQUIPMENT_BASE_CATALOG) {
      const legal = AFFIX_CATALOG.filter((affix) =>
        isAffixLegalForBase(affix, base),
      );
      expect(legal.length).toBeGreaterThanOrEqual(
        AFFIX_COUNTS_BY_RARITY.rare.maximum,
      );
    }
  });

  it("declares every affix with five descending tier ranges", () => {
    for (const affix of AFFIX_CATALOG) {
      expect(affix.tiers).toHaveLength(AFFIX_TIER_COUNT);
      for (let index = 0; index < AFFIX_TIER_COUNT; index += 1) {
        const range = affix.tiers[index]!;
        expect(range.minimumValue).toBeLessThanOrEqual(range.maximumValue);
        if (index > 0) {
          // Tier 1 is best: each later tier's ceiling sits below the
          // previous tier's floor.
          expect(range.maximumValue).toBeLessThan(
            affix.tiers[index - 1]!.minimumValue,
          );
        }
      }
    }
  });

  it("gives common equipment exactly one rolled affix", () => {
    for (const base of EQUIPMENT_BASE_CATALOG) {
      const item = equipment(7, base.id, "common", 7);
      expect(item.affixes).toHaveLength(1);
      expect(modifiersForEquipment(item).length).toBe(
        base.baseModifiers.length + 1,
      );
    }
  });

  it("rolls Heartwell and Mindwell flasks with flask-only affixes", () => {
    expect(FLASK_BASE_CATALOG.map(({ displayName }) => displayName)).toEqual([
      "Heartwell Flask",
      "Mindwell Flask",
    ]);
    for (const base of FLASK_BASE_CATALOG) {
      const legal = AFFIX_CATALOG.filter((affix) =>
        isAffixLegalForBase(affix, base),
      );
      expect(legal.length).toBeGreaterThanOrEqual(
        AFFIX_COUNTS_BY_RARITY.rare.maximum,
      );
      expect(legal.every((affix) => affix.allowedSlots.includes("flask"))).toBe(
        true,
      );
      const common = equipment(9, base.id, "common", 9);
      expect(common.affixes).toHaveLength(1);
      expect(modifiersForEquipment(common).length).toBe(
        base.baseModifiers.length + 1,
      );
    }
  });

  it("rejects reserved unique rarity in generation and validation", () => {
    expect(() =>
      generateEquipmentItem({
        seed: 1,
        instanceId: persistentInstanceId("item:unique-attempt"),
        baseId: MAIN_HAND_ID,
        rarity: "unique",
      }),
    ).toThrow(/reserved/);
    expect(() =>
      modifiersForEquipment({
        ...equipment(500, MAIN_HAND_ID, "common"),
        rarity: "unique",
      }),
    ).toThrow(/reserved/);
  });

  it("rejects tampered tiers and values outside the rolled tier's range", () => {
    const item = equipment(3, MAIN_HAND_ID, "magic", 3);
    const rolled = item.affixes[0]!;
    const definition = affixById(rolled.affixId)!;
    const tierRange = definition.tiers[rolled.tier - 1]!;

    expect(() =>
      modifiersForEquipment({
        ...item,
        affixes: [
          {
            ...rolled,
            modifier: {
              ...rolled.modifier,
              value: tierRange.maximumValue + 1,
            },
          },
        ],
      }),
    ).toThrow(/Invalid affix/);
    expect(() =>
      modifiersForEquipment({
        ...item,
        affixes: [{ ...rolled, tier: AFFIX_TIER_COUNT + 1 }],
      }),
    ).toThrow(/Invalid affix/);
    expect(() =>
      modifiersForEquipment({
        ...item,
        affixes: [{ ...rolled, tier: 0 }],
      }),
    ).toThrow(/Invalid affix/);
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
    ).toHaveLength(INVENTORY_SLOT_COUNT - 2);
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
    const commonLoadout = expectedEquipmentStats(commonWeapon, chest);
    expect(character.stats()).toEqual({
      maximumHealth: commonLoadout.health,
      outgoingAbilityDamageBasisPoints: commonLoadout.damage,
      outgoingAbilityDamageMultiplier: commonLoadout.damage / 10_000,
    });

    expect(character.equipFromInventory(1)).toEqual({ accepted: true });
    expect(character.inventorySlots()[1]).toEqual(commonWeapon);
    expect(character.equipment()["main-hand"]).toEqual(rareWeapon);

    const expected = expectedEquipmentStats(rareWeapon, chest);
    expect(character.stats()).toMatchObject({
      maximumHealth: expected.health,
      outgoingAbilityDamageBasisPoints: expected.damage,
    });
    expect(applyOutgoingAbilityDamage(25, character.stats())).toBe(
      Math.floor((25 * expected.damage) / 10_000),
    );
  });

  it("fills ring-1 then ring-2 by default and swaps into explicit targets", () => {
    const character = new CharacterItemLoadout();
    const firstRing = equipment(11, RING_ID);
    const secondRing = equipment(12, RING_ID);
    const thirdRing = equipment(13, RING_ID);
    character.addItem(firstRing);
    character.addItem(secondRing);
    character.addItem(thirdRing);

    expect(slotsForKind("ring")).toEqual(["ring-1", "ring-2"]);
    expect(character.equipFromInventory(0)).toEqual({ accepted: true });
    expect(character.equipFromInventory(1)).toEqual({ accepted: true });
    expect(character.equipment()["ring-1"]).toEqual(firstRing);
    expect(character.equipment()["ring-2"]).toEqual(secondRing);

    // Both ring slots are full: the default target falls back to ring-1 and
    // the displaced ring returns to the vacated inventory index.
    expect(character.equipFromInventory(2)).toEqual({ accepted: true });
    expect(character.equipment()["ring-1"]).toEqual(thirdRing);
    expect(character.inventorySlots()[2]).toEqual(firstRing);

    // Explicit targeting can replace ring-2 directly.
    expect(character.equipFromInventory(2, "ring-2")).toEqual({
      accepted: true,
    });
    expect(character.equipment()["ring-2"]).toEqual(firstRing);
    expect(character.inventorySlots()[2]).toEqual(secondRing);

    expect(character.unequip("ring-2")).toEqual({ accepted: true });
    expect(character.equipment()["ring-2"]).toBeNull();
  });

  it("rejects equipping into a slot that does not accept the item's kind", () => {
    const character = new CharacterItemLoadout();
    character.addItem(equipment(21, RING_ID));
    character.addItem(equipment(22, MAIN_HAND_ID));

    expect(character.equipFromInventory(0, "amulet")).toEqual({
      accepted: false,
      reason: "incompatible-slot",
    });
    expect(character.equipFromInventory(1, "ring-1")).toEqual({
      accepted: false,
      reason: "incompatible-slot",
    });
    expect(character.equipment()["amulet"]).toBeNull();
    expect(character.inventorySlots()[0]).not.toBeNull();

    expect(character.equipFromInventory(1, "main-hand")).toEqual({
      accepted: true,
    });
  });

  it("equips flasks into flask slots without changing character combat stats", () => {
    const character = new CharacterItemLoadout();
    const flask = equipment(41, FLASK_BASE_CATALOG[0]!.id);
    const weapon = equipment(42, MAIN_HAND_ID);
    character.addItem(flask);
    character.addItem(weapon);

    expect(character.equipFromInventory(0, "helmet")).toEqual({
      accepted: false,
      reason: "incompatible-slot",
    });
    expect(character.equipFromInventory(0)).toEqual({ accepted: true });
    expect(character.flasks()["flask-1"]).toEqual(flask);
    expect(character.stats()).toEqual({
      maximumHealth: 100,
      outgoingAbilityDamageBasisPoints: 10_000,
      outgoingAbilityDamageMultiplier: 1,
    });

    expect(character.equipFromInventory(1)).toEqual({ accepted: true });
    const armed = expectedEquipmentStats(weapon);
    expect(character.stats()).toEqual({
      maximumHealth: armed.health,
      outgoingAbilityDamageBasisPoints: armed.damage,
      outgoingAbilityDamageMultiplier: armed.damage / 10_000,
    });
    expect(character.unequip("flask-1")).toEqual({ accepted: true });
    expect(character.flasks()["flask-1"]).toBeNull();
  });

  it("aggregates stats across all nine equipment slots", () => {
    const character = new CharacterItemLoadout();
    expect(EQUIPMENT_SLOTS).toHaveLength(9);

    let serial = 30;
    for (const base of EQUIPMENT_BASE_CATALOG) {
      for (const slot of slotsForKind(base.slot)) {
        const item = equipment(serial, base.id);
        serial += 1;
        expect(character.addItem(item)).toEqual({ accepted: true });
        const emptyIndex = character
          .inventorySlots()
          .findIndex((candidate) => candidate?.instanceId === item.instanceId);
        expect(character.equipFromInventory(emptyIndex, slot)).toEqual({
          accepted: true,
        });
      }
    }

    const equipped = character.equipment();
    for (const slot of EQUIPMENT_SLOTS) {
      expect(equipped[slot]).not.toBeNull();
    }

    let expectedHealth = 100;
    let expectedDamage = 10_000;
    for (const slot of EQUIPMENT_SLOTS) {
      for (const modifier of modifiersForEquipment(equipped[slot]!)) {
        if (modifier.operation === "flat") expectedHealth += modifier.value;
        else expectedDamage += modifier.value;
      }
    }
    expect(character.stats()).toEqual({
      maximumHealth: expectedHealth,
      outgoingAbilityDamageBasisPoints: expectedDamage,
      outgoingAbilityDamageMultiplier: expectedDamage / 10_000,
    });
  });
});

describe("Phase 3 Ability Stone and loadout ownership", () => {
  it("borrows Phase 2 defaults without treating them as owned abilities", () => {
    const character = new CharacterItemLoadout();

    expect(character.loadout()).toEqual({
      lmb: BASIC_CLEAVE_ID,
      q: CINDER_DART_ID,
      e: WINTER_PULSE_ID,
      r: DEFIANT_SIGNAL_ID,
    });
    expect(character.ownedAbilities()).toEqual([BASIC_CLEAVE_ID]);

    expect(character.assignAbility("e", null)).toEqual({ accepted: true });
    expect(character.assignAbility("e", WINTER_PULSE_ID)).toEqual({
      accepted: false,
      reason: "ability-not-owned",
    });
  });

  it("offers three choices, consumes one stone, and preserves Basic Cleave", () => {
    const character = new CharacterItemLoadout();
    character.addItem(
      createAbilityStoneStack(
        persistentInstanceId("item:selectable-stones"),
        2,
      ),
    );

    expect(character.abilityStoneChoices(0)).toEqual([
      CINDER_DART_ID,
      WINTER_PULSE_ID,
      DEFIANT_SIGNAL_ID,
    ]);
    expect(character.consumeAbilityStone(0, CINDER_DART_ID)).toEqual({
      accepted: true,
    });
    expect(character.inventorySlots()[0]).toMatchObject({ quantity: 1 });
    expect(character.ownedAbilities()).toEqual([
      BASIC_CLEAVE_ID,
      CINDER_DART_ID,
    ]);
    expect(character.assignAbility("e", CINDER_DART_ID)).toEqual({
      accepted: true,
    });

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

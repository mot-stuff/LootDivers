import { BASIC_CLEAVE_ID, type CombatAbilityId } from "./combat-abilities";
import {
  EQUIPMENT_SLOTS,
  FLASK_SLOTS,
  IMPLEMENTED_ABILITY_CATALOG,
  slotAcceptsKind,
  type EquipmentSlot,
  type FlaskSlot,
} from "./item-catalog";
import {
  equipmentSlotKindOf,
  modifiersForEquipment,
  requiredLevelForRarity,
  type EquipmentItemInstance,
  type ItemInstance,
  type RolledAffix,
} from "./item-generation";
import {
  LOADOUT_SLOTS,
  type CharacterItemsSnapshot,
  type LoadoutSlot,
} from "./item-loadout";
import { ABILITY_STONE_STACK_LIMIT, INVENTORY_SLOT_COUNT } from "./inventory";
import { contentId, persistentInstanceId, type ContentId } from "./ids";
import type { EnemyLootGeneratorSnapshot } from "./enemy-loot";
import {
  ATTRIBUTE_IDS,
  experienceToNextLevel,
  passiveById,
  type CharacterProgressionSnapshot,
} from "./progression";
import {
  PROFESSION_IDS,
  materialById,
  professionExperienceToNextLevel,
  type ProfessionProgressionSnapshot,
} from "./professions";
import { MULBERRY32_ALGORITHM } from "./random";
import { TUTORIAL_STEP_IDS, type TutorialStepId } from "./tutorial";
import { isZoneId, type QuestStage, type ZoneId } from "./world-zones";

/**
 * TASK-705 character save DTO (schema version 1, DEC-034).
 *
 * This is the complete persistent character: everything a fresh
 * `CombatArenaSimulation` needs to resume a run. It is pure JSON-safe data
 * defined entirely in core — no storage, browser, or backend types may leak
 * in here (DEC-032 §2.1: the envelope wrapping this DTO is the contract a
 * future backend stores verbatim). Versioning lives on the persistence
 * envelope (`formatVersion`), not inside the DTO; older payloads are
 * migrated to this shape before `parseCharacterSave` runs.
 *
 * Deliberately not persisted (documented in DEC-034): player position
 * (restore re-enters the zone at its spawn point), vitals and mana
 * (refilled to their recomputed maximums), enemies, ground loot, ability
 * cooldowns/executions, statuses, node charges, and open forge/vendor UI —
 * all transient combat state that zone entry already reconstructs.
 */
export interface CharacterSave {
  readonly zoneId: ZoneId;
  readonly questStage: QuestStage;
  /** Banked tutorial steps in canonical order (DEC-030 amendment). */
  readonly tutorialBankedSteps: readonly TutorialStepId[];
  /**
   * Carried gold (TASK-705B, TASK-713 memo §2): integer from 0 through
   * `GOLD_MAX_TOTAL`. In v1 nothing drops or spends gold yet (TASK-712);
   * the field ships in save v1 so gold needs no v2 migration.
   */
  readonly gold: number;
  readonly progression: CharacterProgressionSnapshot;
  readonly professions: ProfessionProgressionSnapshot;
  readonly items: CharacterItemsSnapshot;
  readonly generators: CharacterSaveGenerators;
}

/** New characters and pre-gold saves start broke (TASK-713 memo §2.1). */
export const STARTING_GOLD = 0;

/**
 * Gold cap (TASK-713 memo §2.1): collection clamps here; the parser
 * rejects values above it.
 */
export const GOLD_MAX_TOTAL = 1_000_000_000;

/**
 * Instance-ID generator positions. Persisting these is what makes restored
 * sessions collision-free: crafted, vendor, ore, and loot instance IDs
 * continue after the highest saved serial instead of restarting at 1 and
 * colliding with items already in the saved inventory.
 */
export interface CharacterSaveGenerators {
  /** Next `item:crafted-N` serial. */
  readonly craftSerial: number;
  /** Next `item:vendor-N` (and vendor-refund) serial. */
  readonly vendorSerial: number;
  /** Next `item:ore-N` (and craft-refund) serial. */
  readonly materialSerial: number;
  /** Deterministic enemy-loot sequence position (seed, counts, RNG state). */
  readonly loot: EnemyLootGeneratorSnapshot;
}

const QUEST_STAGES: readonly QuestStage[] = [
  "inactive",
  "accepted",
  "ready",
  "completed",
];

const GENERATABLE_RARITIES = ["common", "magic", "rare"] as const;

const UINT32_MAX = 0xffff_ffff;

function fail(message: string): never {
  throw new RangeError(`Character save: ${message}`);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeysAt(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
): void {
  const expected = new Set(expectedKeys);
  const unknownKey = Object.keys(value).find((key) => !expected.has(key));
  if (unknownKey !== undefined) {
    fail(`${path} contains unknown field "${unknownKey}".`);
  }
  const missingKey = expectedKeys.find(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );
  if (missingKey !== undefined) {
    fail(`${path} is missing required field "${missingKey}".`);
  }
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") fail(`${path} must be a string.`);
  return value;
}

function integerAt(
  value: unknown,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail(`${path} must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return value as number;
}

function finiteAt(value: unknown, path: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    fail(`${path} must be a finite number >= ${minimum}.`);
  }
  return value;
}

function contentIdAt(value: unknown, path: string): ContentId {
  try {
    return contentId(stringAt(value, path));
  } catch {
    fail(`${path} must be a lowercase namespaced content ID.`);
  }
}

function memberAt<T extends string>(
  value: unknown,
  candidates: readonly T[],
  path: string,
): T {
  const candidate = stringAt(value, path);
  if (!(candidates as readonly string[]).includes(candidate)) {
    fail(`${path} must be one of: ${candidates.join(", ")}.`);
  }
  return candidate as T;
}

function rolledAffixAt(value: unknown, path: string): RolledAffix {
  const affix = objectAt(value, path);
  exactKeysAt(affix, ["affixId", "tier", "modifier"], path);
  const modifier = objectAt(affix.modifier, `${path}.modifier`);
  exactKeysAt(modifier, ["statId", "operation", "value"], `${path}.modifier`);
  const operation = memberAt(
    modifier.operation,
    ["flat", "additive-basis-points"] as const,
    `${path}.modifier.operation`,
  );
  const statId = contentIdAt(modifier.statId, `${path}.modifier.statId`);
  const shared = {
    affixId: contentIdAt(affix.affixId, `${path}.affixId`),
    tier: integerAt(affix.tier, `${path}.tier`, 1, 5),
  };
  const valueChecked = integerAt(
    modifier.value,
    `${path}.modifier.value`,
    0,
    1_000_000,
  );
  return operation === "flat"
    ? {
        ...shared,
        modifier: { statId, operation: "flat", value: valueChecked },
      }
    : {
        ...shared,
        modifier: {
          statId,
          operation: "additive-basis-points",
          value: valueChecked,
        },
      };
}

function equipmentItemAt(
  value: Record<string, unknown>,
  path: string,
): EquipmentItemInstance {
  exactKeysAt(
    value,
    [
      "kind",
      "instanceId",
      "baseId",
      "rarity",
      "requiredLevel",
      "origin",
      "affixes",
    ],
    path,
  );
  const rarity = memberAt(value.rarity, GENERATABLE_RARITIES, `${path}.rarity`);
  if (!Array.isArray(value.affixes) || value.affixes.length > 4) {
    fail(`${path}.affixes must be an array of at most 4 rolled affixes.`);
  }
  const item: EquipmentItemInstance = {
    kind: "equipment",
    instanceId: instanceIdAt(value.instanceId, `${path}.instanceId`),
    baseId: contentIdAt(value.baseId, `${path}.baseId`),
    rarity,
    requiredLevel: integerAt(value.requiredLevel, `${path}.requiredLevel`, 1),
    origin: memberAt(
      value.origin,
      ["loot", "crafted"] as const,
      `${path}.origin`,
    ),
    affixes: value.affixes.map((affix, index) =>
      rolledAffixAt(affix, `${path}.affixes[${index}]`),
    ),
  };
  if (item.requiredLevel !== requiredLevelForRarity(item.rarity)) {
    fail(`${path}.requiredLevel does not match the item's rarity.`);
  }
  // Full catalog legality: known base, legal unique affixes, tier ranges,
  // and per-rarity affix counts all re-checked by the item system itself.
  try {
    modifiersForEquipment(item);
  } catch (error) {
    fail(
      `${path} is not a legal generated item: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return item;
}

function instanceIdAt(value: unknown, path: string) {
  try {
    return persistentInstanceId(stringAt(value, path));
  } catch {
    fail(`${path} must be a lowercase namespaced instance ID.`);
  }
}

function itemInstanceAt(value: unknown, path: string): ItemInstance {
  const item = objectAt(value, path);
  const kind = stringAt(item.kind, `${path}.kind`);
  if (kind === "equipment") return equipmentItemAt(item, path);
  if (kind === "ability-stone") {
    exactKeysAt(item, ["kind", "instanceId", "quantity"], path);
    return {
      kind: "ability-stone",
      instanceId: instanceIdAt(item.instanceId, `${path}.instanceId`),
      quantity: integerAt(
        item.quantity,
        `${path}.quantity`,
        1,
        ABILITY_STONE_STACK_LIMIT,
      ),
    };
  }
  if (kind === "material") {
    exactKeysAt(item, ["kind", "instanceId", "materialId", "quantity"], path);
    const materialId = contentIdAt(item.materialId, `${path}.materialId`);
    const material = materialById(materialId);
    if (material === undefined) {
      fail(`${path}.materialId "${materialId}" is not in the catalog.`);
    }
    return {
      kind: "material",
      instanceId: instanceIdAt(item.instanceId, `${path}.instanceId`),
      materialId,
      quantity: integerAt(
        item.quantity,
        `${path}.quantity`,
        1,
        material.stackLimit,
      ),
    };
  }
  fail(`${path}.kind must be "equipment", "ability-stone", or "material".`);
}

function abilityIdAt(value: unknown, path: string): CombatAbilityId {
  const id = contentIdAt(value, path);
  if (!IMPLEMENTED_ABILITY_CATALOG.includes(id)) {
    fail(`${path} "${id}" is not an implemented ability.`);
  }
  return id;
}

function progressionAt(value: unknown): CharacterProgressionSnapshot {
  const progression = objectAt(value, "progression");
  exactKeysAt(
    progression,
    [
      "level",
      "experience",
      "unspentAttributePoints",
      "unspentPassivePoints",
      "attributes",
      "passiveRanks",
    ],
    "progression",
  );
  const level = integerAt(progression.level, "progression.level", 1, 10_000);
  const experience = finiteAt(
    progression.experience,
    "progression.experience",
    0,
  );
  if (experience >= experienceToNextLevel(level)) {
    fail("progression.experience must be below the next level requirement.");
  }
  const attributesRaw = objectAt(
    progression.attributes,
    "progression.attributes",
  );
  exactKeysAt(attributesRaw, ATTRIBUTE_IDS, "progression.attributes");
  const attributes = {
    strength: integerAt(
      attributesRaw.strength,
      "progression.attributes.strength",
      0,
      100_000,
    ),
    dexterity: integerAt(
      attributesRaw.dexterity,
      "progression.attributes.dexterity",
      0,
      100_000,
    ),
    vitality: integerAt(
      attributesRaw.vitality,
      "progression.attributes.vitality",
      0,
      100_000,
    ),
    intelligence: integerAt(
      attributesRaw.intelligence,
      "progression.attributes.intelligence",
      0,
      100_000,
    ),
  };
  if (!Array.isArray(progression.passiveRanks)) {
    fail("progression.passiveRanks must be an array.");
  }
  const seenPassives = new Set<string>();
  const passiveRanks = progression.passiveRanks.map((entry, index) => {
    const path = `progression.passiveRanks[${index}]`;
    const record = objectAt(entry, path);
    exactKeysAt(record, ["id", "rank"], path);
    const id = contentIdAt(record.id, `${path}.id`);
    const definition = passiveById(id);
    if (definition === undefined) {
      fail(`${path}.id "${id}" is not in the passive catalog.`);
    }
    if (seenPassives.has(id)) fail(`${path}.id "${id}" is repeated.`);
    seenPassives.add(id);
    return {
      id,
      rank: integerAt(record.rank, `${path}.rank`, 1, definition.maximumRank),
    };
  });
  return {
    level,
    experience,
    unspentAttributePoints: integerAt(
      progression.unspentAttributePoints,
      "progression.unspentAttributePoints",
      0,
    ),
    unspentPassivePoints: integerAt(
      progression.unspentPassivePoints,
      "progression.unspentPassivePoints",
      0,
    ),
    attributes,
    passiveRanks,
  };
}

function professionsAt(value: unknown): ProfessionProgressionSnapshot {
  const professions = objectAt(value, "professions");
  exactKeysAt(professions, PROFESSION_IDS, "professions");
  const parseOne = (id: (typeof PROFESSION_IDS)[number]) => {
    const path = `professions.${id}`;
    const record = objectAt(professions[id], path);
    exactKeysAt(record, ["level", "experience"], path);
    const level = integerAt(record.level, `${path}.level`, 1, 10_000);
    const experience = finiteAt(record.experience, `${path}.experience`, 0);
    if (experience >= professionExperienceToNextLevel(level)) {
      fail(`${path}.experience must be below the next level requirement.`);
    }
    return { level, experience };
  };
  return { mining: parseOne("mining"), smithing: parseOne("smithing") };
}

function itemsAt(
  value: unknown,
  characterLevel: number,
): CharacterItemsSnapshot {
  const items = objectAt(value, "items");
  exactKeysAt(
    items,
    ["inventory", "equipment", "flasks", "ownedAbilities", "loadout"],
    "items",
  );

  if (
    !Array.isArray(items.inventory) ||
    items.inventory.length !== INVENTORY_SLOT_COUNT
  ) {
    fail(`items.inventory must be an array of ${INVENTORY_SLOT_COUNT} slots.`);
  }
  const seenInstances = new Set<string>();
  const claimInstance = (instanceId: string, path: string): void => {
    if (seenInstances.has(instanceId)) {
      fail(`${path} repeats instance ID "${instanceId}".`);
    }
    seenInstances.add(instanceId);
  };
  const inventory = items.inventory.map((slot, index) => {
    if (slot === null) return null;
    const item = itemInstanceAt(slot, `items.inventory[${index}]`);
    claimInstance(item.instanceId, `items.inventory[${index}]`);
    return item;
  });

  const wornEquipmentAt = (
    value: unknown,
    slot: EquipmentSlot | FlaskSlot,
    path: string,
  ): EquipmentItemInstance => {
    const item = itemInstanceAt(value, path);
    if (item.kind !== "equipment") {
      fail(`${path} must be an equipment item.`);
    }
    claimInstance(item.instanceId, path);
    if (!slotAcceptsKind(slot, equipmentSlotKindOf(item))) {
      fail(`${path} does not fit the "${slot}" slot.`);
    }
    if (item.requiredLevel > characterLevel) {
      fail(`${path} requires a higher character level than the save's.`);
    }
    return item;
  };

  const equipmentRaw = objectAt(items.equipment, "items.equipment");
  const equipment: Partial<Record<EquipmentSlot, EquipmentItemInstance>> = {};
  for (const key of Object.keys(equipmentRaw)) {
    const slot = memberAt(key, EQUIPMENT_SLOTS, "items.equipment slot");
    equipment[slot] = wornEquipmentAt(
      equipmentRaw[key],
      slot,
      `items.equipment.${slot}`,
    );
  }

  const flasksRaw = objectAt(items.flasks, "items.flasks");
  const flasks: Partial<Record<FlaskSlot, EquipmentItemInstance>> = {};
  for (const key of Object.keys(flasksRaw)) {
    const slot = memberAt(key, FLASK_SLOTS, "items.flasks slot");
    flasks[slot] = wornEquipmentAt(
      flasksRaw[key],
      slot,
      `items.flasks.${slot}`,
    );
  }

  if (!Array.isArray(items.ownedAbilities)) {
    fail("items.ownedAbilities must be an array.");
  }
  const ownedAbilities = items.ownedAbilities.map((entry, index) =>
    abilityIdAt(entry, `items.ownedAbilities[${index}]`),
  );
  if (new Set(ownedAbilities).size !== ownedAbilities.length) {
    fail("items.ownedAbilities must not repeat abilities.");
  }
  if (!ownedAbilities.includes(BASIC_CLEAVE_ID)) {
    fail("items.ownedAbilities must include Basic Cleave.");
  }

  const loadoutRaw = objectAt(items.loadout, "items.loadout");
  exactKeysAt(loadoutRaw, LOADOUT_SLOTS, "items.loadout");
  const loadout = {} as Record<LoadoutSlot, CombatAbilityId | null>;
  for (const slot of LOADOUT_SLOTS) {
    const assigned = loadoutRaw[slot];
    if (assigned === null) {
      loadout[slot] = null;
      continue;
    }
    // Slots may reference abilities that are not owned yet: the fresh
    // character's Q/E/R assignments act as locked previews until the
    // matching ability stone is consumed, and activation checks ownership
    // at runtime.
    loadout[slot] = abilityIdAt(assigned, `items.loadout.${slot}`);
  }
  if (!LOADOUT_SLOTS.some((slot) => loadout[slot] === BASIC_CLEAVE_ID)) {
    fail("items.loadout must keep Basic Cleave assigned somewhere.");
  }

  return { inventory, equipment, flasks, ownedAbilities, loadout };
}

function generatorsAt(value: unknown): CharacterSaveGenerators {
  const generators = objectAt(value, "generators");
  exactKeysAt(
    generators,
    ["craftSerial", "vendorSerial", "materialSerial", "loot"],
    "generators",
  );
  const loot = objectAt(generators.loot, "generators.loot");
  exactKeysAt(
    loot,
    ["seed", "killSequence", "itemSequence", "random"],
    "generators.loot",
  );
  const random = objectAt(loot.random, "generators.loot.random");
  exactKeysAt(random, ["algorithm", "state"], "generators.loot.random");
  if (random.algorithm !== MULBERRY32_ALGORITHM) {
    fail(`generators.loot.random.algorithm must be "${MULBERRY32_ALGORITHM}".`);
  }
  return {
    craftSerial: integerAt(generators.craftSerial, "generators.craftSerial", 1),
    vendorSerial: integerAt(
      generators.vendorSerial,
      "generators.vendorSerial",
      1,
    ),
    materialSerial: integerAt(
      generators.materialSerial,
      "generators.materialSerial",
      1,
    ),
    loot: {
      seed: integerAt(loot.seed, "generators.loot.seed", 0, UINT32_MAX),
      killSequence: integerAt(
        loot.killSequence,
        "generators.loot.killSequence",
        0,
      ),
      itemSequence: integerAt(
        loot.itemSequence,
        "generators.loot.itemSequence",
        0,
      ),
      random: {
        algorithm: MULBERRY32_ALGORITHM,
        state: integerAt(
          random.state,
          "generators.loot.random.state",
          0,
          UINT32_MAX,
        ),
      },
    },
  };
}

/**
 * Validates an untrusted value into a `CharacterSave`, rebuilding it field
 * by field (unknown fields, malformed types, catalog-illegal items,
 * duplicate instance IDs, and broken invariants such as a missing Basic
 * Cleave all throw `RangeError`). Persistence wraps failures as corrupt
 * saves; `CombatArenaSimulation.restoreCharacterSave` runs it again as its
 * own precondition, so a value that parses is guaranteed restorable.
 */
export function parseCharacterSave(value: unknown): CharacterSave {
  const save = objectAt(value, "character save");
  exactKeysAt(
    save,
    [
      "zoneId",
      "questStage",
      "tutorialBankedSteps",
      "gold",
      "progression",
      "professions",
      "items",
      "generators",
    ],
    "character save",
  );

  const zoneCandidate = stringAt(save.zoneId, "zoneId");
  if (!isZoneId(zoneCandidate)) {
    fail(`zoneId "${zoneCandidate}" is not a known zone.`);
  }

  if (!Array.isArray(save.tutorialBankedSteps)) {
    fail("tutorialBankedSteps must be an array.");
  }
  const bankedSteps = save.tutorialBankedSteps.map((entry, index) =>
    memberAt(entry, TUTORIAL_STEP_IDS, `tutorialBankedSteps[${index}]`),
  );
  if (new Set(bankedSteps).size !== bankedSteps.length) {
    fail("tutorialBankedSteps must not repeat steps.");
  }

  const progression = progressionAt(save.progression);

  return {
    zoneId: zoneCandidate,
    questStage: memberAt(save.questStage, QUEST_STAGES, "questStage"),
    tutorialBankedSteps: TUTORIAL_STEP_IDS.filter((step) =>
      bankedSteps.includes(step),
    ),
    gold: integerAt(save.gold, "gold", 0, GOLD_MAX_TOTAL),
    progression,
    professions: professionsAt(save.professions),
    items: itemsAt(save.items, progression.level),
    generators: generatorsAt(save.generators),
  };
}

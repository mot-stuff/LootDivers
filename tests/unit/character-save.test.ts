import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  DEFIANT_SIGNAL_ID,
  DeterministicEnemyLootGenerator,
  EQUIPMENT_BASE_CATALOG,
  FIXED_STEP_SECONDS,
  GOLD_MAX_TOTAL,
  HOLLOWDEEP_ID,
  STARTING_GOLD,
  WINTER_PULSE_ID,
  createAbilityStoneStack,
  definitionById,
  experienceToNextLevel,
  generateEquipmentItem,
  parseCharacterSave,
  persistentInstanceId,
  type CharacterSave,
} from "../../src/core";
import {
  CHARACTER_SAVE_CODEC,
  CHARACTER_SAVE_FORMAT,
  CharacterSaveService,
  PersistenceError,
  canonicalJson,
  createCharacterSaveCodec,
  signEnvelope,
  type CharacterSaveEnvelope,
  type ChecksumProvider,
  type SaveClock,
  type SaveLoadResult,
  type SaveRepository,
} from "../../src/persistence";

const checksumProvider: ChecksumProvider = {
  digest(value) {
    return Promise.resolve(createHash("sha256").update(value).digest("hex"));
  },
};

const clock: SaveClock = {
  nowIso: () => "2026-09-05T12:00:00.000Z",
};

const metadata = {
  saveId: "character:slot-1",
  revision: 1,
  createdAt: "2026-09-05T10:00:00.000Z",
  updatedAt: "2026-09-05T11:00:00.000Z",
  build: "unit-test",
  contentSchemaVersion: 1,
};

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

function playedSimulation(): CombatArenaSimulation {
  const simulation = new CombatArenaSimulation({
    ...DEFAULT_COMBAT_ARENA_CONFIG,
    enemy: {
      ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
      spawnX: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 90,
      spawnY: DEFAULT_COMBAT_ARENA_CONFIG.height / 2,
      maxHealth: 1,
    },
  });

  // Kill an enemy so experience and the loot-generator sequence advance.
  expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
  step(
    simulation,
    (definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0) + 1,
  );
  expect(simulation.diagnostics().enemy.dead).toBe(true);

  // Level up and spend a point so progression state is non-default.
  simulation.grantExperience(experienceToNextLevel(1));
  expect(simulation.allocateAttribute("strength").accepted).toBe(true);

  // Nonzero gold (TASK-705B): no drops exist yet, so grant directly.
  expect(simulation.grantGold(137)).toBe(137);

  // Own gear (crafted-origin) and abilities beyond the defaults.
  simulation.addCharacterItem(
    generateEquipmentItem({
      seed: 7,
      instanceId: persistentInstanceId("item:save-test-weapon"),
      baseId: EQUIPMENT_BASE_CATALOG[0]!.id,
      rarity: "common",
      origin: "crafted",
    }),
  );
  expect(simulation.equipCharacterItem(0)).toEqual({ accepted: true });
  simulation.addCharacterItem(
    createAbilityStoneStack(persistentInstanceId("item:save-test-stones"), 3),
  );
  for (const abilityId of [
    CINDER_DART_ID,
    WINTER_PULSE_ID,
    DEFIANT_SIGNAL_ID,
  ]) {
    expect(simulation.consumeCharacterAbilityStone(0, abilityId)).toMatchObject(
      { accepted: true },
    );
  }
  expect(simulation.assignAbilitySlot("q", CINDER_DART_ID).accepted).toBe(true);

  // Leave the boot zone so the saved zone is non-default too.
  expect(simulation.travelTo(HOLLOWDEEP_ID).accepted).toBe(true);
  return simulation;
}

describe("character save DTO", () => {
  it("round trips capture → JSON → parse → restore → capture", () => {
    const original = playedSimulation();
    const save = original.captureCharacterSave();

    const parsed = parseCharacterSave(
      JSON.parse(JSON.stringify(save)) as unknown,
    );
    expect(parsed).toEqual(save);

    const restored = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    restored.restoreCharacterSave(parsed);
    expect(restored.captureCharacterSave()).toEqual(save);

    expect(save.gold).toBe(137);
    expect(restored.gold()).toBe(137);

    const diagnostics = restored.diagnostics();
    expect(diagnostics.zoneId).toBe(HOLLOWDEEP_ID);
    expect(diagnostics.level).toBe(save.progression.level);
    expect(diagnostics.playerHealth).toBe(diagnostics.playerMaxHealth);
    expect(diagnostics.mana).toBe(diagnostics.maxMana);
  });

  it("starts broke and clamps gold grants at the cap", () => {
    const simulation = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    expect(simulation.gold()).toBe(STARTING_GOLD);
    expect(simulation.captureCharacterSave().gold).toBe(0);

    expect(simulation.grantGold(GOLD_MAX_TOTAL - 5)).toBe(GOLD_MAX_TOTAL - 5);
    expect(simulation.grantGold(10)).toBe(GOLD_MAX_TOTAL);
    expect(simulation.captureCharacterSave().gold).toBe(GOLD_MAX_TOTAL);

    expect(() => simulation.grantGold(-1)).toThrow(RangeError);
    expect(() => simulation.grantGold(2.5)).toThrow(RangeError);
    expect(simulation.gold()).toBe(GOLD_MAX_TOTAL);
  });

  it("continues the deterministic loot sequence from a snapshot", () => {
    const generator = new DeterministicEnemyLootGenerator({
      seed: 77,
      rarityWeights: DEFAULT_COMBAT_ARENA_CONFIG.loot.rarityWeights,
    });
    for (let kill = 0; kill < 3; kill += 1) generator.generateForKill();
    const snapshot = generator.snapshot();

    const expected = Array.from({ length: 5 }, () =>
      generator.generateForKill(),
    );
    const resumed = DeterministicEnemyLootGenerator.fromSnapshot(
      snapshot,
      DEFAULT_COMBAT_ARENA_CONFIG.loot.rarityWeights,
    );
    const actual = Array.from({ length: 5 }, () => resumed.generateForKill());

    expect(actual).toEqual(expected);
  });

  it("rejects tampered or structurally broken saves", () => {
    const save = playedSimulation().captureCharacterSave();
    const clone = () =>
      JSON.parse(JSON.stringify(save)) as Record<string, unknown>;

    const unknownField = clone();
    unknownField.zone = "zone:hearthmere";
    expect(() => parseCharacterSave(unknownField)).toThrow(RangeError);

    const badZone = clone();
    badZone.zoneId = "zone:does-not-exist";
    expect(() => parseCharacterSave(badZone)).toThrow(/not a known zone/);

    // Gold (TASK-705B): non-negative integer, capped at GOLD_MAX_TOTAL.
    const negativeGold = clone();
    negativeGold.gold = -1;
    expect(() => parseCharacterSave(negativeGold)).toThrow(/gold/);

    const fractionalGold = clone();
    fractionalGold.gold = 12.5;
    expect(() => parseCharacterSave(fractionalGold)).toThrow(/gold/);

    const overCapGold = clone();
    overCapGold.gold = GOLD_MAX_TOTAL + 1;
    expect(() => parseCharacterSave(overCapGold)).toThrow(/gold/);

    const missingGold = clone();
    delete missingGold.gold;
    expect(() => parseCharacterSave(missingGold)).toThrow(
      /missing required field "gold"/,
    );

    const duplicated = clone() as unknown as {
      items: {
        inventory: unknown[];
        equipment: Record<string, unknown>;
      };
    };
    const wornSlot = Object.keys(duplicated.items.equipment)[0];
    expect(wornSlot).toBeDefined();
    duplicated.items.inventory[0] = JSON.parse(
      JSON.stringify(duplicated.items.equipment[wornSlot!]),
    );
    expect(() => parseCharacterSave(duplicated)).toThrow(/repeats instance ID/);

    const noCleave = clone() as unknown as {
      items: { loadout: Record<string, string | null> };
    };
    for (const slot of Object.keys(noCleave.items.loadout)) {
      if (noCleave.items.loadout[slot] === BASIC_CLEAVE_ID) {
        noCleave.items.loadout[slot] = null;
      }
    }
    expect(() => parseCharacterSave(noCleave)).toThrow(/Basic Cleave assigned/);
  });
});

describe("character save envelope codec", () => {
  it("round trips the envelope through serialize and decode", async () => {
    const save = playedSimulation().captureCharacterSave();
    const envelope = await CHARACTER_SAVE_CODEC.create(
      save,
      metadata,
      checksumProvider,
    );
    expect(envelope.format).toBe(CHARACTER_SAVE_FORMAT);
    expect(envelope.formatVersion).toBe(1);

    const decoded = await CHARACTER_SAVE_CODEC.decode(
      JSON.parse(CHARACTER_SAVE_CODEC.serialize(envelope)) as unknown,
      checksumProvider,
      clock,
    );
    expect(decoded.migratedFromVersion).toBeNull();
    expect(decoded.state).toEqual(save);
    expect(decoded.envelope.checksum.value).toMatch(/^[a-f0-9]{64}$/);
  });

  it("applies an ordered version 1 to version 2 migration", async () => {
    // Synthetic future format: version 2 renames nothing in the real DTO;
    // the v1 payload lacks questStage and the migration backfills it. This
    // exercises the ordered chain, provenance, and re-signing without
    // inventing a real schema change.
    const save = playedSimulation().captureCharacterSave();
    const legacyCharacter: Record<string, unknown> = {
      ...(JSON.parse(JSON.stringify(save)) as Record<string, unknown>),
    };
    delete legacyCharacter.questStage;

    const unsigned = {
      format: CHARACTER_SAVE_FORMAT,
      formatVersion: 1,
      saveId: metadata.saveId,
      revision: 4,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      compatibility: {
        build: "legacy-build",
        contentSchemaVersion: 1,
      },
      migrationProvenance: [],
      payload: { character: legacyCharacter },
    };
    const legacyEnvelope = await signEnvelope(unsigned, checksumProvider);

    const codecV2 = createCharacterSaveCodec({
      currentVersion: 2,
      migrations: [
        {
          fromVersion: 1,
          migrate: (character) => ({
            ...(character as Record<string, unknown>),
            questStage: "inactive",
          }),
        },
      ],
    });

    const decoded = await codecV2.decode(
      legacyEnvelope,
      checksumProvider,
      clock,
    );
    expect(decoded.migratedFromVersion).toBe(1);
    expect(decoded.envelope.formatVersion).toBe(2);
    expect(decoded.state.questStage).toBe("inactive");
    expect(decoded.state.zoneId).toBe(save.zoneId);
    expect(decoded.envelope.migrationProvenance).toEqual([
      {
        fromVersion: 1,
        toVersion: 2,
        migratedAt: "2026-09-05T12:00:00.000Z",
      },
    ]);

    // The migrated envelope is re-signed, so a second decode verifies clean.
    const again = await codecV2.decode(
      decoded.envelope,
      checksumProvider,
      clock,
    );
    expect(again.migratedFromVersion).toBeNull();
  });

  it("rejects checksum tampering, corrupt payloads, and newer versions", async () => {
    const save = playedSimulation().captureCharacterSave();
    const envelope = await CHARACTER_SAVE_CODEC.create(
      save,
      metadata,
      checksumProvider,
    );

    const tampered = JSON.parse(CHARACTER_SAVE_CODEC.serialize(envelope)) as {
      payload: { character: { progression: { level: number } } };
    };
    tampered.payload.character.progression.level += 1;
    await expect(
      CHARACTER_SAVE_CODEC.decode(tampered, checksumProvider, clock),
    ).rejects.toMatchObject({ code: "checksum" });

    await expect(
      CHARACTER_SAVE_CODEC.decode(
        { ...envelope, unrecognizedField: true },
        checksumProvider,
        clock,
      ),
    ).rejects.toMatchObject({ code: "checksum" });

    // Valid checksum over a structurally invalid character → corrupt.
    const brokenCharacter = {
      ...(JSON.parse(JSON.stringify(save)) as Record<string, unknown>),
      zoneId: "zone:does-not-exist",
    };
    const brokenEnvelope = await signEnvelope(
      {
        format: CHARACTER_SAVE_FORMAT,
        formatVersion: 1,
        saveId: metadata.saveId,
        revision: 2,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        compatibility: { build: "unit-test", contentSchemaVersion: 1 },
        migrationProvenance: [],
        payload: { character: brokenCharacter },
      },
      checksumProvider,
    );
    await expect(
      CHARACTER_SAVE_CODEC.decode(brokenEnvelope, checksumProvider, clock),
    ).rejects.toMatchObject({ code: "corrupt" });

    // A future version this build cannot read → unsupported-version.
    const future = await signEnvelope(
      {
        format: CHARACTER_SAVE_FORMAT,
        formatVersion: 9,
        saveId: metadata.saveId,
        revision: 3,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        compatibility: { build: "unit-test", contentSchemaVersion: 1 },
        migrationProvenance: [],
        payload: { character: JSON.parse(JSON.stringify(save)) as unknown },
      },
      checksumProvider,
    );
    await expect(
      CHARACTER_SAVE_CODEC.decode(future, checksumProvider, clock),
    ).rejects.toMatchObject({ code: "unsupported-version" });
  });

  it("emits canonical serialization independent of construction order", async () => {
    const save = playedSimulation().captureCharacterSave();
    const envelope = await CHARACTER_SAVE_CODEC.create(
      save,
      metadata,
      checksumProvider,
    );
    const reordered = JSON.parse(
      CHARACTER_SAVE_CODEC.serialize(envelope),
    ) as Record<string, unknown>;
    expect(canonicalJson(reordered)).toBe(canonicalJson(envelope));
  });
});

type CharacterRepository = SaveRepository<CharacterSave, CharacterSaveEnvelope>;

function fakeRepository(
  behavior: Pick<CharacterRepository, "load"> &
    Partial<Pick<CharacterRepository, "save">>,
): CharacterRepository {
  return {
    load: behavior.load,
    save:
      behavior.save ??
      (() => Promise.reject(new Error("save not expected in this test"))),
    exportJson: () => Promise.reject(new Error("not used")),
    importJson: () => Promise.reject(new Error("not used")),
  };
}

describe("CharacterSaveService boot read model", () => {
  it("reports a restorable save from the active generation", async () => {
    const save = playedSimulation().captureCharacterSave();
    const envelope = await CHARACTER_SAVE_CODEC.create(
      save,
      metadata,
      checksumProvider,
    );
    const service = new CharacterSaveService(
      fakeRepository({
        load: () =>
          Promise.resolve({
            state: save,
            envelope,
            source: "active",
            recoveredFromInvalidGeneration: false,
          } satisfies SaveLoadResult<CharacterSave, CharacterSaveEnvelope>),
      }),
    );

    await expect(service.loadForBoot()).resolves.toEqual({
      save,
      recovered: false,
      failure: null,
    });
  });

  it("flags backup recovery so the menu can surface it", async () => {
    const save = playedSimulation().captureCharacterSave();
    const envelope = await CHARACTER_SAVE_CODEC.create(
      save,
      metadata,
      checksumProvider,
    );
    const service = new CharacterSaveService(
      fakeRepository({
        load: () =>
          Promise.resolve({
            state: save,
            envelope,
            source: "backup",
            recoveredFromInvalidGeneration: true,
          } satisfies SaveLoadResult<CharacterSave, CharacterSaveEnvelope>),
      }),
    );

    const result = await service.loadForBoot();
    expect(result.save).toEqual(save);
    expect(result.recovered).toBe(true);
  });

  it("treats a missing save as Continue-disabled without failure noise", async () => {
    const service = new CharacterSaveService(
      fakeRepository({
        load: () =>
          Promise.reject(
            new PersistenceError("not-found", "No saved data exists."),
          ),
      }),
    );

    await expect(service.loadForBoot()).resolves.toEqual({
      save: null,
      recovered: false,
      failure: null,
    });
  });

  it("treats corruption as absent while preserving the diagnostic", async () => {
    const service = new CharacterSaveService(
      fakeRepository({
        load: () =>
          Promise.reject(
            new PersistenceError("checksum", "Checksum mismatch."),
          ),
      }),
    );

    const result = await service.loadForBoot();
    expect(result.save).toBeNull();
    expect(result.recovered).toBe(false);
    expect(result.failure).toBe("Checksum mismatch.");
  });

  it("passes writes through to the repository", async () => {
    const save = playedSimulation().captureCharacterSave();
    const envelope = await CHARACTER_SAVE_CODEC.create(
      save,
      metadata,
      checksumProvider,
    );
    const written: CharacterSave[] = [];
    const service = new CharacterSaveService(
      fakeRepository({
        load: () =>
          Promise.reject(new PersistenceError("not-found", "No save.")),
        save: (state) => {
          written.push(state);
          return Promise.resolve(envelope);
        },
      }),
    );

    await service.save(save);
    expect(written).toEqual([save]);
  });
});

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ASHTRAIL_EXPANSE_ID,
  BASIC_CLEAVE_ID,
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  FIXED_STEP_SECONDS,
  HEARTHMERE_ID,
  HOLLOWDEEP_ID,
  WAKESHORE_LANDING_ID,
  ZONE_CATALOG,
  parseCharacterSave,
  zoneById,
} from "../../src/core";
import {
  CHARACTER_SAVE_CODEC,
  type ChecksumProvider,
} from "../../src/persistence";

const checksumProvider: ChecksumProvider = {
  digest(value) {
    return Promise.resolve(createHash("sha256").update(value).digest("hex"));
  },
};

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

function killPlayer(simulation: CombatArenaSimulation): void {
  const result = simulation.applyPlayerDamage({
    amount: 1_000_000,
    sourceId: "test",
  });
  expect(result.died).toBe(true);
  expect(simulation.diagnostics().playerDead).toBe(true);
}

describe("zone respawn targets (DEC-037)", () => {
  it("maps every zone to its respawn destination", () => {
    const targets = Object.fromEntries(
      ZONE_CATALOG.map((zone) => [zone.id, zone.respawnZoneId]),
    );
    expect(targets).toEqual({
      [ASHTRAIL_EXPANSE_ID]: HEARTHMERE_ID,
      [HEARTHMERE_ID]: HEARTHMERE_ID,
      [HOLLOWDEEP_ID]: HEARTHMERE_ID,
      [WAKESHORE_LANDING_ID]: WAKESHORE_LANDING_ID,
    });
  });

  it("exposes the current zone's respawn target through diagnostics", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.diagnostics()).toMatchObject({
      zoneId: ASHTRAIL_EXPANSE_ID,
      respawnZoneId: HEARTHMERE_ID,
      respawnZoneName: "Hearthmere",
    });
    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
    expect(simulation.diagnostics()).toMatchObject({
      respawnZoneId: WAKESHORE_LANDING_ID,
      respawnZoneName: "Wakeshore Landing",
    });
  });
});

describe("death and respawn state machine (TASK-710)", () => {
  it("rejects respawn while the player is alive, without side effects", () => {
    const simulation = new CombatArenaSimulation();
    const before = simulation.diagnostics();
    expect(simulation.respawn()).toEqual({
      accepted: false,
      reason: "player-alive",
    });
    expect(simulation.diagnostics()).toMatchObject({
      zoneId: before.zoneId,
      playerHealth: before.playerHealth,
      x: before.x,
      y: before.y,
    });
  });

  it("respawns an Ashtrail death in Hearthmere with vitals refilled", () => {
    const simulation = new CombatArenaSimulation();
    // Spend mana so the refill is observable.
    expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
    step(simulation, 2);
    killPlayer(simulation);

    expect(simulation.respawn()).toEqual({
      accepted: true,
      zoneId: HEARTHMERE_ID,
    });
    const hearthmere = zoneById(HEARTHMERE_ID)!;
    expect(simulation.diagnostics()).toMatchObject({
      zoneId: HEARTHMERE_ID,
      playerDead: false,
      playerHealth: 100,
      playerMaxHealth: 100,
      mana: 100,
      x: hearthmere.playerSpawnX,
      y: hearthmere.playerSpawnY,
      targets: [],
      worldLoot: [],
      projectiles: [],
      areaFeedback: [],
      statuses: [],
      currentExecution: null,
    });
    // The respawned session is live again: stepping moves the player.
    simulation.setMovement(1, 0);
    step(simulation, 5);
    expect(simulation.diagnostics().x).toBeGreaterThan(hearthmere.playerSpawnX);
  });

  it("keeps every persistent system untouched across death and respawn (zero penalty)", () => {
    const simulation = new CombatArenaSimulation();
    simulation.grantExperience(25);
    simulation.grantGold(64);
    expect(simulation.travelTo(HOLLOWDEEP_ID).accepted).toBe(true);

    const before = {
      diagnostics: simulation.diagnostics(),
      loadout: simulation.characterItemLoadout(),
      professions: simulation.professions(),
      gold: simulation.gold(),
    };
    killPlayer(simulation);
    expect(simulation.respawn()).toEqual({
      accepted: true,
      zoneId: HEARTHMERE_ID,
    });

    const after = simulation.diagnostics();
    expect(after.experience).toBe(before.diagnostics.experience);
    expect(after.level).toBe(before.diagnostics.level);
    expect(after.quest).toEqual(before.diagnostics.quest);
    expect(simulation.gold()).toBe(before.gold);
    expect(simulation.characterItemLoadout()).toEqual(before.loadout);
    expect(simulation.professions()).toEqual(before.professions);
  });

  it("respawns a tutorial death in Wakeshore with banked steps intact", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);

    // Bank "move" and "dodge" through the real verbs.
    simulation.setMovement(0, 1);
    step(simulation, 3);
    simulation.setMovement(0, 0);
    simulation.requestDodge();
    step(simulation, 2);
    expect(simulation.diagnostics().tutorial).toMatchObject({
      active: true,
      stepsCompleted: 2,
    });
    // Let the dodge invulnerability window expire before the lethal hit.
    while (simulation.diagnostics().dodging) {
      step(simulation, 1);
    }

    killPlayer(simulation);
    expect(simulation.respawn()).toEqual({
      accepted: true,
      zoneId: WAKESHORE_LANDING_ID,
    });
    const wakeshore = zoneById(WAKESHORE_LANDING_ID)!;
    expect(simulation.diagnostics()).toMatchObject({
      zoneId: WAKESHORE_LANDING_ID,
      playerDead: false,
      playerHealth: 100,
      x: wakeshore.playerSpawnX,
      y: wakeshore.playerSpawnY,
      // Zone entry respawned the scuttler; banked progress survived and the
      // prompt shows the first incomplete step again.
      tutorial: {
        active: true,
        stepsCompleted: 2,
        stepId: "attack",
      },
    });
    expect(
      simulation
        .diagnostics()
        .targets.find((target) => target.id === "enemy:wakeshore-scuttler"),
    ).toMatchObject({ dead: false, health: 18 });
  });

  it("respawns a Hearthmere death in place", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.travelTo(HEARTHMERE_ID).accepted).toBe(true);
    killPlayer(simulation);
    expect(simulation.respawn()).toEqual({
      accepted: true,
      zoneId: HEARTHMERE_ID,
    });
    expect(simulation.diagnostics()).toMatchObject({
      zoneId: HEARTHMERE_ID,
      playerDead: false,
      playerHealth: 100,
    });
  });

  it("supports repeated death and respawn cycles plus a clean reset", () => {
    const simulation = new CombatArenaSimulation();
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(simulation.travelTo(ASHTRAIL_EXPANSE_ID).accepted).toBe(true);
      killPlayer(simulation);
      expect(simulation.respawn()).toEqual({
        accepted: true,
        zoneId: HEARTHMERE_ID,
      });
      // A second confirm after respawning is inert.
      expect(simulation.respawn()).toEqual({
        accepted: false,
        reason: "player-alive",
      });
    }
    simulation.reset();
    expect(simulation.diagnostics()).toMatchObject({
      tick: 0,
      zoneId: ASHTRAIL_EXPANSE_ID,
      playerDead: false,
      playerHealth: 100,
    });
  });
});

describe("death-committed save capture (DEC-037 closes the DEC-034 rewind)", () => {
  it("captures the respawn destination as the saved zone while dead", () => {
    const simulation = new CombatArenaSimulation();
    simulation.grantExperience(25);
    simulation.grantGold(64);
    expect(simulation.travelTo(HOLLOWDEEP_ID).accepted).toBe(true);

    const aliveSave = simulation.captureCharacterSave();
    expect(aliveSave.zoneId).toBe(HOLLOWDEEP_ID);

    killPlayer(simulation);
    const deadSave = simulation.captureCharacterSave();
    expect(deadSave.zoneId).toBe(HEARTHMERE_ID);
    // Zero penalty: everything except the committed zone matches the alive
    // capture exactly.
    expect(deadSave).toEqual({ ...aliveSave, zoneId: HEARTHMERE_ID });

    // The dead capture parses and restores into the respawn outcome.
    const restored = new CombatArenaSimulation(DEFAULT_COMBAT_ARENA_CONFIG);
    restored.restoreCharacterSave(parseCharacterSave(deadSave));
    expect(restored.diagnostics()).toMatchObject({
      zoneId: HEARTHMERE_ID,
      playerDead: false,
      playerHealth: 100,
    });
    expect(restored.gold()).toBe(64);
    expect(restored.diagnostics().experience).toBe(25);
  });

  it("captures a tutorial death as Wakeshore with banked steps preserved", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
    simulation.setMovement(1, 0);
    step(simulation, 3);
    simulation.setMovement(0, 0);
    killPlayer(simulation);

    const save = simulation.captureCharacterSave();
    expect(save.zoneId).toBe(WAKESHORE_LANDING_ID);
    expect(save.tutorialBankedSteps).toEqual(["move"]);
  });

  it("matches the capture after respawn: the save-at-respawn envelope equals the death envelope", async () => {
    const simulation = new CombatArenaSimulation();
    simulation.grantGold(12);
    killPlayer(simulation);

    const metadata = {
      saveId: "character:slot-1",
      revision: 1,
      createdAt: "2026-09-05T10:00:00.000Z",
      updatedAt: "2026-09-05T11:00:00.000Z",
      build: "unit-test",
      contentSchemaVersion: 1,
    };
    const deathEnvelope = await CHARACTER_SAVE_CODEC.create(
      simulation.captureCharacterSave(),
      metadata,
      checksumProvider,
    );
    expect(deathEnvelope.payload.character.zoneId).toBe(HEARTHMERE_ID);
    expect(deathEnvelope.payload.character.gold).toBe(12);

    expect(simulation.respawn()).toEqual({
      accepted: true,
      zoneId: HEARTHMERE_ID,
    });
    const respawnEnvelope = await CHARACTER_SAVE_CODEC.create(
      simulation.captureCharacterSave(),
      metadata,
      checksumProvider,
    );
    // Dying committed the identical persistent outcome the respawn writes:
    // reloading before or after the confirm restores the same character.
    expect(respawnEnvelope.payload).toEqual(deathEnvelope.payload);
    expect(respawnEnvelope.checksum).toEqual(deathEnvelope.checksum);
  });
});

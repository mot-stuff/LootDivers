import { describe, expect, it } from "vitest";

import {
  ASHTRAIL_BRUTE_ID,
  ASHTRAIL_EXPANSE_ID,
  BASIC_CLEAVE_ID,
  CombatArenaSimulation,
  EMBERCLEFT_ID,
  FIXED_STEP_SECONDS,
  HEARTHMERE_ID,
  HOLLOWDEEP_BRUISER_ID,
  HOLLOWDEEP_ID,
  VEINSHARD_ORE_ID,
  WICK_TRAIL_VEST_OFFER_ID,
  createMaterialStack,
  persistentInstanceId,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

describe("Phase 6 world session", () => {
  it("reset after a town visit still lets Ashtrail cleave connect", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.travelTo(HEARTHMERE_ID).accepted).toBe(true);
    simulation.reset();
    expect(simulation.currentZone().id).toBe(ASHTRAIL_EXPANSE_ID);
    step(simulation, 76);
    simulation.setAim(1, 0);
    expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
    step(simulation, 16);
    expect(simulation.diagnostics().enemy.health).toBeLessThan(50);
  });

  it("starts in Ashtrail and travels to Hearthmere without losing inventory", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.currentZone().id).toBe(ASHTRAIL_EXPANSE_ID);
    expect(
      simulation.addCharacterItem(
        createMaterialStack(
          persistentInstanceId("item:world-ore"),
          VEINSHARD_ORE_ID,
          5,
        ),
      ),
    ).toEqual({ accepted: true });

    expect(simulation.travelTo(HEARTHMERE_ID)).toEqual({
      accepted: true,
      zoneId: HEARTHMERE_ID,
    });
    expect(simulation.currentZone().safe).toBe(true);
    expect(simulation.diagnostics().targets).toEqual([]);
    expect(
      simulation
        .characterItemLoadout()
        .inventory.some(
          (item) =>
            item?.kind === "material" && item.materialId === VEINSHARD_ORE_ID,
        ),
    ).toBe(true);
  });

  it("accepts the Roadwarden quest, marks it ready after the Bruiser dies, and turns it in", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.travelTo(HEARTHMERE_ID).accepted).toBe(true);
    simulation.setMovement(-1, 0);
    for (let index = 0; index < 200; index += 1) {
      const questGiver = simulation
        .worldInteractables()
        .find((interactable) => interactable.kind === "quest-giver");
      if (questGiver !== undefined) {
        const position = simulation.diagnostics();
        if (
          Math.hypot(questGiver.x - position.x, questGiver.y - position.y) <= 36
        ) {
          simulation.setMovement(0, 0);
          break;
        }
        simulation.setMovement(
          questGiver.x - position.x,
          questGiver.y - position.y,
        );
      }
      simulation.step({
        tick: simulation.diagnostics().tick,
        deltaSeconds: 1 / 60,
      });
    }
    expect(simulation.requestInteract()).toEqual({ kind: "quest-accepted" });
    expect(simulation.quest().stage).toBe("accepted");

    expect(simulation.travelTo(HOLLOWDEEP_ID).accepted).toBe(true);
    expect(simulation.diagnostics().enemy.id).toBe(HOLLOWDEEP_BRUISER_ID);
    for (let index = 0; index < 2_400; index += 1) {
      const state = simulation.diagnostics();
      if (state.enemy.dead) break;
      const deltaX = state.enemy.x - state.x;
      const deltaY = state.enemy.y - state.y;
      if (Math.hypot(deltaX, deltaY) > 48) {
        simulation.setMovement(deltaX, deltaY);
      } else {
        simulation.setMovement(0, 0);
        simulation.setAim(deltaX, deltaY);
        simulation.requestAbilitySlot("lmb");
      }
      simulation.step({
        tick: state.tick,
        deltaSeconds: 1 / 60,
      });
    }
    expect(simulation.diagnostics().enemy.dead).toBe(true);
    expect(simulation.quest().stage).toBe("ready");

    expect(simulation.travelTo(HEARTHMERE_ID).accepted).toBe(true);
    const roadwarden = simulation
      .worldInteractables()
      .find((interactable) => interactable.kind === "quest-giver");
    if (roadwarden === undefined) throw new Error("Roadwarden missing.");
    const position = simulation.diagnostics();
    simulation.setMovement(
      roadwarden.x - position.x,
      roadwarden.y - position.y,
    );
    for (let index = 0; index < 200; index += 1) {
      const here = simulation.diagnostics();
      if (Math.hypot(roadwarden.x - here.x, roadwarden.y - here.y) <= 36) {
        simulation.setMovement(0, 0);
        break;
      }
      simulation.step({
        tick: simulation.diagnostics().tick,
        deltaSeconds: 1 / 60,
      });
    }
    const before = simulation.characterProgression();
    expect(simulation.requestInteract()).toEqual({ kind: "quest-completed" });
    expect(simulation.quest().stage).toBe("completed");
    expect(
      simulation.characterProgression().level > before.level ||
        simulation.characterProgression().experience > before.experience,
    ).toBe(true);
  });

  it("trades Veinshard at Wick Provisions", () => {
    const simulation = new CombatArenaSimulation();
    simulation.addCharacterItem(
      createMaterialStack(
        persistentInstanceId("item:wick-ore"),
        VEINSHARD_ORE_ID,
        5,
      ),
    );
    expect(simulation.travelTo(HEARTHMERE_ID).accepted).toBe(true);
    const vendor = simulation
      .worldInteractables()
      .find((interactable) => interactable.kind === "vendor");
    if (vendor === undefined) throw new Error("Vendor missing.");
    const position = simulation.diagnostics();
    simulation.setMovement(vendor.x - position.x, vendor.y - position.y);
    for (let index = 0; index < 200; index += 1) {
      const here = simulation.diagnostics();
      if (Math.hypot(vendor.x - here.x, vendor.y - here.y) <= 36) {
        simulation.setMovement(0, 0);
        break;
      }
      simulation.step({
        tick: simulation.diagnostics().tick,
        deltaSeconds: 1 / 60,
      });
    }
    expect(simulation.requestInteract()).toEqual({ kind: "vendor-opened" });
    const traded = simulation.tradeVendorOffer(WICK_TRAIL_VEST_OFFER_ID);
    expect(traded.accepted).toBe(true);
    expect(traded.item?.kind).toBe("equipment");
  });

  it("uses the Hearthmere gate to return to Ashtrail", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(HEARTHMERE_ID);
    const portal = simulation
      .worldInteractables()
      .find((interactable) => interactable.kind === "portal");
    if (portal === undefined) throw new Error("Town gate missing.");
    const position = simulation.diagnostics();
    simulation.setMovement(portal.x - position.x, portal.y - position.y);
    for (let index = 0; index < 200; index += 1) {
      const here = simulation.diagnostics();
      if (Math.hypot(portal.x - here.x, portal.y - here.y) <= 36) {
        simulation.setMovement(0, 0);
        break;
      }
      simulation.step({
        tick: simulation.diagnostics().tick,
        deltaSeconds: 1 / 60,
      });
    }
    expect(simulation.requestInteract()).toEqual({
      kind: "portal-used",
      zoneId: ASHTRAIL_EXPANSE_ID,
    });
    expect(simulation.currentZone().id).toBe(ASHTRAIL_EXPANSE_ID);
    expect(simulation.currentZone().safe).toBe(false);
    const living = simulation
      .diagnostics()
      .enemies.filter((enemy) => !enemy.dead);
    expect(living.map((enemy) => enemy.rank).sort()).toEqual([
      "elite",
      "normal",
      "normal",
      "normal",
    ]);
    expect(living.some((enemy) => enemy.id === ASHTRAIL_BRUTE_ID)).toBe(true);
  });

  it("keeps the Ashtrail pack leashed until the player steps into aggro", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(ASHTRAIL_EXPANSE_ID, 160, 400);
    step(simulation, 90);
    const pack = simulation
      .diagnostics()
      .enemies.filter((enemy) => enemy.id.startsWith("enemy:ashtrail-gnasher"));
    expect(pack).toHaveLength(3);
    expect(pack.every((enemy) => enemy.state === "idle")).toBe(true);
    expect(
      pack.every(
        (enemy) =>
          Math.hypot(enemy.x - enemy.previousX, enemy.y - enemy.previousY) < 1,
      ),
    ).toBe(true);
  });

  it("places Embercleft in Hollowdeep without replacing the Bruiser quest target", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.travelTo(HOLLOWDEEP_ID).accepted).toBe(true);
    const state = simulation.diagnostics();
    expect(state.enemy.id).toBe(HOLLOWDEEP_BRUISER_ID);
    expect(state.enemies.map((enemy) => enemy.id)).toEqual([
      HOLLOWDEEP_BRUISER_ID,
      EMBERCLEFT_ID,
    ]);
    expect(
      state.enemies.find((enemy) => enemy.id === EMBERCLEFT_ID)?.rank,
    ).toBe("boss");
  });

  it("lets the player slay Embercleft for boss experience", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(HOLLOWDEEP_ID);
    const before = simulation.characterProgression();
    for (let index = 0; index < 3_600; index += 1) {
      const state = simulation.diagnostics();
      const boss = state.enemies.find((enemy) => enemy.id === EMBERCLEFT_ID);
      if (boss === undefined || boss.dead) break;
      const deltaX = boss.x - state.x;
      const deltaY = boss.y - state.y;
      if (Math.hypot(deltaX, deltaY) > 52) {
        simulation.setMovement(deltaX, deltaY);
      } else {
        simulation.setMovement(0, 0);
        simulation.setAim(deltaX, deltaY);
        simulation.requestAbilitySlot("lmb");
        simulation.requestAbilitySlot("q");
      }
      simulation.step({
        tick: state.tick,
        deltaSeconds: 1 / 60,
      });
    }
    expect(
      simulation
        .diagnostics()
        .enemies.find((enemy) => enemy.id === EMBERCLEFT_ID)?.dead,
    ).toBe(true);
    expect(
      simulation.characterProgression().level > before.level ||
        simulation.characterProgression().experience > before.experience,
    ).toBe(true);
  });

  it("exposes a minimap with the player, landmarks, and living enemies", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(HEARTHMERE_ID);
    const town = simulation.diagnostics().minimap;
    expect(town.markers.some((marker) => marker.kind === "player")).toBe(true);
    expect(town.markers.some((marker) => marker.kind === "vendor")).toBe(true);
    expect(town.markers.some((marker) => marker.kind === "quest")).toBe(true);
    expect(town.markers.some((marker) => marker.kind === "enemy")).toBe(false);
    expect(town.floorColor).toBe(0x8a6a32);
    expect(town.edgeColor).toBe(0xe8b86d);
    expect(town.walkable).toEqual({
      x: 18,
      y: 18,
      width: 1_164,
      height: 764,
    });

    simulation.travelTo(ASHTRAIL_EXPANSE_ID);
    const wild = simulation.diagnostics().minimap;
    expect(wild.floorColor).toBe(0x1a4a52);
    expect(wild.edgeColor).toBe(0x5ab0a8);
    expect(
      wild.markers.filter((marker) => marker.kind === "enemy"),
    ).toHaveLength(4);
    expect(wild.markers.some((marker) => marker.rank === "elite")).toBe(true);
    expect(wild.markers.some((marker) => marker.kind === "portal")).toBe(true);
    expect(wild.markers.some((marker) => marker.kind === "node")).toBe(true);

    simulation.travelTo(HOLLOWDEEP_ID);
    const dungeon = simulation.diagnostics().minimap;
    expect(dungeon.floorColor).toBe(0x352060);
    expect(dungeon.edgeColor).toBe(0x9f7aea);
    expect(dungeon.markers.some((marker) => marker.rank === "boss")).toBe(true);
  });
});

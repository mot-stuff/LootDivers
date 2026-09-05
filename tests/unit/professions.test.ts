import { describe, expect, it } from "vitest";

import {
  ARENA_FORGE,
  CRAFTED_BASE_CATALOG,
  CombatArenaSimulation,
  DEEPVEIN_CLEAVER_RECIPE_ID,
  DEEPVEIN_ORE_ID,
  DEEPVEIN_SEAM_ID,
  DEFAULT_COMBAT_ARENA_CONFIG,
  FIXED_STEP_SECONDS,
  ITEM_BASE_CATALOG,
  MATERIAL_STACK_LIMIT,
  TEMPERING_CLEAVER_RECIPE_ID,
  VEINSHARD_ORE_ID,
  VEINSHARD_OUTCROP_ID,
  createMaterialStack,
  generateEquipmentItem,
  oreNodeById,
  persistentInstanceId,
  professionExperienceToNextLevel,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

function walkTo(simulation: CombatArenaSimulation, x: number, y: number): void {
  for (let index = 0; index < 400; index += 1) {
    const position = simulation.diagnostics();
    const deltaX = x - position.x;
    const deltaY = y - position.y;
    if (Math.hypot(deltaX, deltaY) <= 36) {
      simulation.setMovement(0, 0);
      return;
    }
    simulation.setMovement(deltaX, deltaY);
    step(simulation, 1);
  }
  simulation.setMovement(0, 0);
}

function professionArena(): CombatArenaSimulation {
  return new CombatArenaSimulation({
    ...DEFAULT_COMBAT_ARENA_CONFIG,
    enemy: {
      ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
      spawnX: 1_180,
      spawnY: 40,
      moveSpeed: 1,
    },
  });
}

describe("Phase 5 professions", () => {
  it("keeps crafted bases out of the enemy drop catalog", () => {
    const dropIds = new Set(ITEM_BASE_CATALOG.map((base) => base.id));
    expect(CRAFTED_BASE_CATALOG.length).toBe(3);
    for (const [index, base] of CRAFTED_BASE_CATALOG.entries()) {
      expect(dropIds.has(base.id)).toBe(false);
      expect(() =>
        generateEquipmentItem({
          seed: 1,
          instanceId: persistentInstanceId(`item:craft-check-${index + 1}`),
          baseId: base.id,
          rarity: "common",
          origin: "crafted",
        }),
      ).not.toThrow();
    }
  });

  it("stacks ore and spends it through Tempering crafts", () => {
    const simulation = professionArena();
    expect(
      simulation.addCharacterItem(
        createMaterialStack(
          persistentInstanceId("item:ore-a"),
          VEINSHARD_ORE_ID,
          9,
        ),
      ),
    ).toEqual({ accepted: true });
    expect(
      simulation.addCharacterItem(
        createMaterialStack(
          persistentInstanceId("item:ore-b"),
          VEINSHARD_ORE_ID,
          9,
        ),
      ),
    ).toEqual({ accepted: true });
    expect(simulation.characterItemLoadout().inventory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "material",
          materialId: VEINSHARD_ORE_ID,
          quantity: 18,
        }),
      ]),
    );
    expect(MATERIAL_STACK_LIMIT).toBe(20);
  });

  it("gathers Veinshard, levels Mining, and forges a Tempering Cleaver", () => {
    const simulation = professionArena();
    const outcrop = oreNodeById(VEINSHARD_OUTCROP_ID);
    if (outcrop === undefined) throw new Error("Veinshard outcrop missing.");
    walkTo(simulation, outcrop.x, outcrop.y);

    expect(simulation.requestInteract()).toMatchObject({
      kind: "gather-started",
      nodeId: VEINSHARD_OUTCROP_ID,
    });
    step(simulation, 80);
    expect(
      simulation
        .characterItemLoadout()
        .inventory.some((item) => item?.kind === "material"),
    ).toBe(true);
    expect(
      simulation.professions().find((profession) => profession.id === "mining"),
    ).toMatchObject({
      experience: 8,
      experienceToNextLevel: professionExperienceToNextLevel(1),
    });

    for (let gather = 0; gather < 2; gather += 1) {
      expect(simulation.requestInteract().kind).toBe("gather-started");
      step(simulation, 80);
    }
    expect(
      simulation
        .characterItemLoadout()
        .inventory.filter((item) => item?.kind === "material")
        .reduce((total, item) => total + (item?.quantity ?? 0), 0),
    ).toBeGreaterThanOrEqual(3);

    walkTo(simulation, ARENA_FORGE.x, ARENA_FORGE.y);
    expect(simulation.requestInteract()).toEqual({ kind: "forge-opened" });
    const crafted = simulation.craftRecipe(TEMPERING_CLEAVER_RECIPE_ID);
    expect(crafted.accepted).toBe(true);
    if (crafted.item?.kind !== "equipment") {
      throw new Error("Tempering Cleaver craft did not produce equipment.");
    }
    expect(crafted.item.origin).toBe("crafted");
    expect(
      simulation
        .professions()
        .find((profession) => profession.id === "smithing")?.experience,
    ).toBe(15);
  });

  it("cancels gathering on movement and rejects Deepvein work before skill 3", () => {
    const simulation = professionArena();
    const outcrop = oreNodeById(VEINSHARD_OUTCROP_ID);
    const seam = oreNodeById(DEEPVEIN_SEAM_ID);
    if (outcrop === undefined || seam === undefined) {
      throw new Error("Ore nodes missing.");
    }
    walkTo(simulation, outcrop.x, outcrop.y);
    expect(simulation.requestInteract().kind).toBe("gather-started");
    simulation.setMovement(1, 0);
    step(simulation, 1);
    expect(simulation.gathering()).toBeNull();
    simulation.setMovement(0, 0);

    walkTo(simulation, seam.x, seam.y);
    expect(simulation.requestInteract()).toEqual({
      kind: "rejected",
      reason: "skill-requirement",
    });
    expect(
      simulation
        .worldInteractables()
        .find((interactable) => interactable.id === DEEPVEIN_SEAM_ID),
    ).toMatchObject({ requiredLevel: 3, depleted: false });

    simulation.addCharacterItem(
      createMaterialStack(
        persistentInstanceId("item:deepvein-test"),
        DEEPVEIN_ORE_ID,
        3,
      ),
    );
    walkTo(simulation, ARENA_FORGE.x, ARENA_FORGE.y);
    expect(simulation.requestInteract()).toEqual({ kind: "forge-opened" });
    expect(simulation.craftRecipe(DEEPVEIN_CLEAVER_RECIPE_ID)).toEqual({
      accepted: false,
      reason: "skill-requirement",
    });
  });

  it("depletes a node and refills it after respawn", () => {
    const simulation = professionArena();
    const outcrop = oreNodeById(VEINSHARD_OUTCROP_ID);
    if (outcrop === undefined) throw new Error("Veinshard outcrop missing.");
    walkTo(simulation, outcrop.x, outcrop.y);
    for (let gather = 0; gather < 4; gather += 1) {
      expect(simulation.requestInteract().kind).toBe("gather-started");
      step(simulation, 80);
    }
    expect(simulation.requestInteract()).toEqual({
      kind: "rejected",
      reason: "node-depleted",
    });
    step(simulation, 480);
    expect(simulation.requestInteract().kind).toBe("gather-started");
  });
});

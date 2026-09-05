import { describe, expect, it } from "vitest";

import {
  ASHTRAIL_EXPANSE_ID,
  CombatArenaSimulation,
  FIXED_STEP_SECONDS,
  HEARTHMERE_ID,
  TUTORIAL_STEPS,
  VEINSHARD_ORE_ID,
  WAKESHORE_LANDING_ID,
  WAKESHORE_SCUTTLER_ID,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

function walkTo(
  simulation: CombatArenaSimulation,
  x: number,
  y: number,
  closeEnough = 30,
): void {
  for (let index = 0; index < 600; index += 1) {
    const here = simulation.diagnostics();
    const deltaX = x - here.x;
    const deltaY = y - here.y;
    if (Math.hypot(deltaX, deltaY) <= closeEnough) {
      simulation.setMovement(0, 0);
      return;
    }
    simulation.setMovement(deltaX, deltaY);
    step(simulation, 1);
  }
  simulation.setMovement(0, 0);
  throw new Error(`Walk target (${x}, ${y}) was not reached.`);
}

function killScuttler(simulation: CombatArenaSimulation): void {
  for (let index = 0; index < 2_400; index += 1) {
    const state = simulation.diagnostics();
    const scuttler = state.enemies.find(
      (enemy) => enemy.id === WAKESHORE_SCUTTLER_ID,
    );
    if (scuttler === undefined) throw new Error("Scuttler missing.");
    if (scuttler.dead) return;
    const deltaX = scuttler.x - state.x;
    const deltaY = scuttler.y - state.y;
    if (Math.hypot(deltaX, deltaY) > 44) {
      simulation.setMovement(deltaX, deltaY);
    } else {
      simulation.setMovement(0, 0);
      simulation.setAim(deltaX, deltaY);
      simulation.requestAbilitySlot("lmb");
    }
    step(simulation, 1);
  }
  throw new Error("The Wakeshore Scuttler survived the kill loop.");
}

function tutorial(simulation: CombatArenaSimulation) {
  return simulation.diagnostics().tutorial;
}

/** Plays every step in order and leaves the player in Hearthmere. */
function completeFullTutorial(simulation: CombatArenaSimulation): void {
  expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
  expect(tutorial(simulation).stepId).toBe("move");

  simulation.setMovement(1, 0);
  step(simulation, 1);
  simulation.setMovement(0, 0);
  expect(tutorial(simulation).stepId).toBe("attack");

  killScuttler(simulation);
  expect(tutorial(simulation).stepId).toBe("dodge");
  const drop = simulation.diagnostics().worldLoot[0];
  if (drop === undefined) throw new Error("Scuttler dropped no loot.");

  simulation.requestDodge();
  step(simulation, 2);
  expect(tutorial(simulation).stepId).toBe("loot");
  step(simulation, 60);

  walkTo(simulation, drop.x, drop.y);
  const picked = simulation.requestInteract();
  expect(picked.kind).toBe("loot");
  expect(tutorial(simulation).stepId).toBe("gather");

  const node = simulation
    .worldInteractables()
    .find((interactable) => interactable.kind === "ore-node");
  if (node === undefined) throw new Error("Tutorial ore node missing.");
  walkTo(simulation, node.x, node.y);
  expect(simulation.requestInteract().kind).toBe("gather-started");
  step(simulation, 90);
  expect(tutorial(simulation).stepId).toBe("travel");

  const portal = simulation
    .worldInteractables()
    .find((interactable) => interactable.kind === "portal");
  if (portal === undefined) throw new Error("Tutorial exit portal missing.");
  walkTo(simulation, portal.x, portal.y);
  expect(simulation.requestInteract()).toEqual({
    kind: "portal-used",
    zoneId: HEARTHMERE_ID,
  });
}

describe("TASK-702 tutorial tracker", () => {
  it("stays inactive until the player enters Wakeshore Landing", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.currentZone().id).toBe(ASHTRAIL_EXPANSE_ID);
    expect(tutorial(simulation)).toEqual({
      active: false,
      completed: false,
      stepId: null,
      prompt: null,
      stepsCompleted: 0,
      totalSteps: TUTORIAL_STEPS.length,
    });

    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
    const entered = tutorial(simulation);
    expect(entered.active).toBe(true);
    expect(entered.stepId).toBe("move");
    expect(entered.prompt).toBe(TUTORIAL_STEPS[0]?.prompt);
    expect(entered.stepsCompleted).toBe(0);
  });

  it("advances every step in order and completes through the exit portal", () => {
    const simulation = new CombatArenaSimulation();
    completeFullTutorial(simulation);

    expect(simulation.currentZone().id).toBe(HEARTHMERE_ID);
    const finished = tutorial(simulation);
    expect(finished.completed).toBe(true);
    expect(finished.active).toBe(false);
    expect(finished.prompt).toBeNull();
    expect(finished.stepsCompleted).toBe(TUTORIAL_STEPS.length);
    expect(
      simulation
        .characterItemLoadout()
        .inventory.some(
          (item) =>
            item?.kind === "material" && item.materialId === VEINSHARD_ORE_ID,
        ),
    ).toBe(true);
  });

  it("drops loot from the tutorial enemy through the deterministic loot path", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);
    simulation.setMovement(1, 0);
    step(simulation, 1);
    killScuttler(simulation);
    expect(simulation.diagnostics().worldLoot.length).toBeGreaterThan(0);
  });

  it("ignores out-of-order actions without advancing or breaking the order", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);

    simulation.requestDodge();
    step(simulation, 2);
    expect(tutorial(simulation).stepId).toBe("move");
    expect(tutorial(simulation).stepsCompleted).toBe(0);
    step(simulation, 60);

    simulation.setMovement(0, 1);
    step(simulation, 1);
    simulation.setMovement(0, 0);
    expect(tutorial(simulation).stepId).toBe("attack");

    simulation.requestDodge();
    step(simulation, 2);
    expect(tutorial(simulation).stepId).toBe("attack");
    expect(tutorial(simulation).stepsCompleted).toBe(1);
  });

  it("always honors the exit portal as the skip path and keeps progress", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);
    const portal = simulation
      .worldInteractables()
      .find((interactable) => interactable.kind === "portal");
    if (portal === undefined) throw new Error("Tutorial exit portal missing.");

    walkTo(simulation, portal.x, portal.y);
    expect(tutorial(simulation).stepId).toBe("attack");
    expect(simulation.requestInteract()).toEqual({
      kind: "portal-used",
      zoneId: HEARTHMERE_ID,
    });

    const skipped = tutorial(simulation);
    expect(skipped.completed).toBe(false);
    expect(skipped.active).toBe(false);
    expect(skipped.prompt).toBeNull();
    expect(skipped.stepsCompleted).toBe(1);

    simulation.travelTo(WAKESHORE_LANDING_ID);
    const resumed = tutorial(simulation);
    expect(resumed.active).toBe(true);
    expect(resumed.stepId).toBe("attack");
  });

  it("shows no prompts on re-entry after completion", () => {
    const simulation = new CombatArenaSimulation();
    completeFullTutorial(simulation);

    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
    const revisit = tutorial(simulation);
    expect(revisit.active).toBe(false);
    expect(revisit.completed).toBe(true);
    expect(revisit.stepId).toBeNull();
    expect(revisit.prompt).toBeNull();
  });

  it("keeps reset semantics: Ashtrail prototype spawn and cleared tutorial", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);
    simulation.setMovement(1, 0);
    step(simulation, 1);
    simulation.setMovement(0, 0);
    expect(tutorial(simulation).stepsCompleted).toBe(1);

    simulation.reset();
    expect(simulation.currentZone().id).toBe(ASHTRAIL_EXPANSE_ID);
    expect(simulation.diagnostics().enemy.id).toBe("enemy:melee-prototype");
    expect(tutorial(simulation)).toEqual({
      active: false,
      completed: false,
      stepId: null,
      prompt: null,
      stepsCompleted: 0,
      totalSteps: TUTORIAL_STEPS.length,
    });
  });
});

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

const PORTAL_X = 1_080;
const PORTAL_Y = 400;

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

/** Kills the scuttler WITHOUT ever calling setMovement (no `move` banking). */
function killScuttlerStandingStill(simulation: CombatArenaSimulation): void {
  for (let index = 0; index < 2_400; index += 1) {
    const state = simulation.diagnostics();
    const scuttler = state.enemies.find(
      (enemy) => enemy.id === WAKESHORE_SCUTTLER_ID,
    );
    if (scuttler === undefined) throw new Error("Scuttler missing.");
    if (scuttler.dead) return;
    simulation.setAim(scuttler.x - state.x, scuttler.y - state.y);
    simulation.requestAbilitySlot("lmb");
    step(simulation, 1);
  }
  throw new Error("The Wakeshore Scuttler survived the stationary kill loop.");
}

function tutorial(simulation: CombatArenaSimulation) {
  return simulation.diagnostics().tutorial;
}

function visiblePortalCount(simulation: CombatArenaSimulation): number {
  const state = simulation.diagnostics();
  const interactables = state.interactables.filter(
    (interactable) => interactable.kind === "portal",
  ).length;
  const markers = state.minimap.markers.filter(
    (marker) => marker.kind === "portal",
  ).length;
  expect(markers).toBe(interactables);
  return interactables;
}

/** Plays every step in canonical order and leaves the player in Hearthmere. */
function completeFullTutorial(simulation: CombatArenaSimulation): void {
  expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
  expect(tutorial(simulation).stepId).toBe("move");
  expect(visiblePortalCount(simulation)).toBe(0);

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
  expect(visiblePortalCount(simulation)).toBe(0);

  const node = simulation
    .worldInteractables()
    .find((interactable) => interactable.kind === "ore-node");
  if (node === undefined) throw new Error("Tutorial ore node missing.");
  walkTo(simulation, node.x, node.y);
  expect(simulation.requestInteract().kind).toBe("gather-started");
  step(simulation, 90);
  expect(tutorial(simulation).stepId).toBe("travel");
  expect(tutorial(simulation).exitUnlocked).toBe(true);
  expect(visiblePortalCount(simulation)).toBe(1);

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
      stepNumber: null,
      stepsCompleted: 0,
      totalSteps: TUTORIAL_STEPS.length,
      exitUnlocked: false,
    });

    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
    const entered = tutorial(simulation);
    expect(entered.active).toBe(true);
    expect(entered.stepId).toBe("move");
    expect(entered.prompt).toBe(TUTORIAL_STEPS[0]?.prompt);
    expect(entered.stepNumber).toBe(1);
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

  it("banks out-of-order actions and always prompts the first incomplete step", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);

    // Dodge during the move step: banked, but the prompt stays on move.
    simulation.requestDodge();
    step(simulation, 2);
    expect(tutorial(simulation).stepId).toBe("move");
    expect(tutorial(simulation).stepNumber).toBe(1);
    expect(tutorial(simulation).stepsCompleted).toBe(1);
    step(simulation, 60);

    // Moving banks move; dodge is already banked so the prompt skips it
    // straight to attack once attack is the first incomplete step.
    simulation.setMovement(0, 1);
    step(simulation, 1);
    simulation.setMovement(0, 0);
    expect(tutorial(simulation).stepId).toBe("attack");
    expect(tutorial(simulation).stepNumber).toBe(2);
    expect(tutorial(simulation).stepsCompleted).toBe(2);

    // A repeated dodge is a silent no-op.
    simulation.requestDodge();
    step(simulation, 2);
    expect(tutorial(simulation).stepsCompleted).toBe(2);

    killScuttler(simulation);
    expect(tutorial(simulation).stepId).toBe("loot");
    expect(tutorial(simulation).stepNumber).toBe(4);
    expect(tutorial(simulation).stepsCompleted).toBe(3);
  });

  it("hides the exit portal until the first five steps are banked", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);

    // Hidden everywhere: interactables, minimap, and F at the portal spot.
    expect(visiblePortalCount(simulation)).toBe(0);
    expect(tutorial(simulation).exitUnlocked).toBe(false);
    walkTo(simulation, PORTAL_X, PORTAL_Y, 10);
    expect(simulation.requestInteract()).toEqual({
      kind: "rejected",
      reason: "nothing-in-range",
    });
    expect(simulation.currentZone().id).toBe(WAKESHORE_LANDING_ID);

    // Other zones' portals stay unaffected by the gate.
    simulation.travelTo(HEARTHMERE_ID);
    expect(
      simulation
        .worldInteractables()
        .some((interactable) => interactable.kind === "portal"),
    ).toBe(true);
  });

  it("cannot strand any step: kill, loot, and dodge before ever moving", () => {
    const simulation = new CombatArenaSimulation();
    // Land next to the scuttler so it dies during the move step (the old
    // strict-order strand scenario, now the banked no-strand proof).
    expect(simulation.travelTo(WAKESHORE_LANDING_ID, 700, 400).accepted).toBe(
      true,
    );

    killScuttlerStandingStill(simulation);
    expect(tutorial(simulation).stepId).toBe("move");
    expect(tutorial(simulation).stepsCompleted).toBe(1);

    simulation.requestDodge();
    step(simulation, 2);
    expect(tutorial(simulation).stepId).toBe("move");
    expect(tutorial(simulation).stepsCompleted).toBe(2);
    step(simulation, 60);

    // Walking to the corpse loot banks move, then the pickup banks loot.
    const drop = simulation.diagnostics().worldLoot[0];
    if (drop === undefined) throw new Error("Scuttler dropped no loot.");
    walkTo(simulation, drop.x, drop.y);
    expect(simulation.requestInteract().kind).toBe("loot");
    expect(tutorial(simulation).stepId).toBe("gather");
    expect(tutorial(simulation).stepsCompleted).toBe(4);
    expect(visiblePortalCount(simulation)).toBe(0);

    const node = simulation
      .worldInteractables()
      .find((interactable) => interactable.kind === "ore-node");
    if (node === undefined) throw new Error("Tutorial ore node missing.");
    walkTo(simulation, node.x, node.y);
    expect(simulation.requestInteract().kind).toBe("gather-started");
    step(simulation, 90);

    // Exactly when travel becomes the active prompt, the portal appears.
    expect(tutorial(simulation).stepId).toBe("travel");
    expect(visiblePortalCount(simulation)).toBe(1);
    walkTo(simulation, PORTAL_X, PORTAL_Y);
    expect(simulation.requestInteract()).toEqual({
      kind: "portal-used",
      zoneId: HEARTHMERE_ID,
    });
    expect(tutorial(simulation).completed).toBe(true);
  });

  it("keeps progress and respawns the enemy when re-entering mid-tutorial", () => {
    const simulation = new CombatArenaSimulation();
    simulation.travelTo(WAKESHORE_LANDING_ID);
    simulation.setMovement(1, 0);
    step(simulation, 1);
    simulation.setMovement(0, 0);
    killScuttler(simulation);
    expect(tutorial(simulation).stepsCompleted).toBe(2);

    // Leave through the automation/travel hook (the portal is still hidden)
    // and come back: progress is kept, the scuttler is alive again, and any
    // uncollected loot can be re-earned, so no step can strand across visits.
    simulation.travelTo(HEARTHMERE_ID);
    expect(tutorial(simulation).active).toBe(false);
    simulation.travelTo(WAKESHORE_LANDING_ID);
    const resumed = tutorial(simulation);
    expect(resumed.active).toBe(true);
    expect(resumed.stepId).toBe("dodge");
    expect(resumed.stepsCompleted).toBe(2);
    expect(visiblePortalCount(simulation)).toBe(0);
    const scuttler = simulation
      .diagnostics()
      .enemies.find((enemy) => enemy.id === WAKESHORE_SCUTTLER_ID);
    expect(scuttler?.dead).toBe(false);
  });

  it("shows the portal immediately and no prompts on re-entry after completion", () => {
    const simulation = new CombatArenaSimulation();
    completeFullTutorial(simulation);

    expect(simulation.travelTo(WAKESHORE_LANDING_ID).accepted).toBe(true);
    const revisit = tutorial(simulation);
    expect(revisit.active).toBe(false);
    expect(revisit.completed).toBe(true);
    expect(revisit.stepId).toBeNull();
    expect(revisit.prompt).toBeNull();
    expect(revisit.exitUnlocked).toBe(true);
    expect(visiblePortalCount(simulation)).toBe(1);
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
      stepNumber: null,
      stepsCompleted: 0,
      totalSteps: TUTORIAL_STEPS.length,
      exitUnlocked: false,
    });
  });
});

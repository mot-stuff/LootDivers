import { describe, expect, it } from "vitest";

import {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  FIXED_STEP_SECONDS,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let tick = 0; tick < count; tick += 1) {
    simulation.step({ tick, deltaSeconds: FIXED_STEP_SECONDS });
  }
}

describe("CombatArenaSimulation", () => {
  it("normalizes diagonal movement to the cardinal movement speed", () => {
    const cardinal = new CombatArenaSimulation();
    const diagonal = new CombatArenaSimulation();

    cardinal.setMovement(1, 0);
    diagonal.setMovement(1, 1);
    step(cardinal, 30);
    step(diagonal, 30);

    const cardinalState = cardinal.diagnostics();
    const diagonalState = diagonal.diagnostics();
    const centerX = DEFAULT_COMBAT_ARENA_CONFIG.width / 2;
    const centerY = DEFAULT_COMBAT_ARENA_CONFIG.height / 2;
    expect(cardinalState.x - centerX).toBeCloseTo(
      Math.hypot(diagonalState.x - centerX, diagonalState.y - centerY),
      10,
    );
  });

  it("keeps movement independent from mouse-facing aim", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(0, -1);
    simulation.setAim(-1, 0);
    step(simulation, 12);

    const state = simulation.diagnostics();
    expect(state.x).toBe(DEFAULT_COMBAT_ARENA_CONFIG.width / 2);
    expect(state.y).toBeLessThan(DEFAULT_COMBAT_ARENA_CONFIG.height / 2);
    expect(state.facingX).toBe(-1);
    expect(state.facingY).toBe(0);
  });

  it("uses fixed-tick dodge duration and blocks cooldown spam", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(1, 0);
    simulation.requestDodge();
    step(simulation, 1);

    const first = simulation.diagnostics();
    expect(first.dodgeCount).toBe(1);
    expect(first.dodging).toBe(true);
    expect(first.dodgeReady).toBe(false);

    simulation.requestDodge();
    step(simulation, 1);
    expect(simulation.diagnostics().dodgeCount).toBe(1);

    step(simulation, 46);
    expect(simulation.diagnostics()).toMatchObject({
      dodgeCount: 1,
      dodging: false,
      dodgeReady: true,
      cooldownTicksRemaining: 0,
    });

    simulation.requestDodge();
    step(simulation, 1);
    expect(simulation.diagnostics().dodgeCount).toBe(2);
  });

  it("keeps movement and dodges inside the arena bounds", () => {
    const simulation = new CombatArenaSimulation();
    simulation.setMovement(-1, -1);
    simulation.requestDodge();
    step(simulation, 600);

    const state = simulation.diagnostics();
    expect(state.x).toBeGreaterThanOrEqual(
      DEFAULT_COMBAT_ARENA_CONFIG.playerRadius,
    );
    expect(state.y).toBeGreaterThanOrEqual(
      DEFAULT_COMBAT_ARENA_CONFIG.playerRadius,
    );
  });
});

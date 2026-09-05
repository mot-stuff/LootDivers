import { describe, expect, it } from "vitest";

import {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  FIXED_STEP_SECONDS,
  type CombatArenaConfig,
  type SimpleMeleeEnemyConfig,
} from "../../src/core";

function createSimulation(
  enemyOverrides: Partial<SimpleMeleeEnemyConfig> = {},
): CombatArenaSimulation {
  const centerX = DEFAULT_COMBAT_ARENA_CONFIG.width / 2;
  const centerY = DEFAULT_COMBAT_ARENA_CONFIG.height / 2;
  const config: CombatArenaConfig = {
    ...DEFAULT_COMBAT_ARENA_CONFIG,
    enemy: {
      ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
      spawnX: centerX + DEFAULT_COMBAT_ARENA_CONFIG.enemy.meleeRange,
      spawnY: centerY,
      ...enemyOverrides,
    },
  };
  return new CombatArenaSimulation(config);
}

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

describe("simple melee enemy integration", () => {
  it("approaches by direct steering and stops exactly at melee range", () => {
    const simulation = createSimulation({
      spawnX: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 200,
      moveSpeed: 120,
      meleeRange: 60,
    });

    step(simulation, 1);
    expect(simulation.diagnostics().enemy).toMatchObject({
      x: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 198,
      state: "approaching",
      damageAttemptCount: 0,
    });

    step(simulation, 70);
    const state = simulation.diagnostics();
    expect(
      Math.hypot(state.enemy.x - state.x, state.enemy.y - state.y),
    ).toBeCloseTo(60, 10);
    expect(state.enemy.state).toBe("windup");
  });

  it("uses a readable windup and exact fixed-tick strike cadence", () => {
    const simulation = createSimulation({
      attackWindupTicks: 3,
      attackIntervalTicks: 10,
      attackDamage: 10,
    });

    step(simulation, 1);
    expect(simulation.diagnostics().enemy).toMatchObject({
      state: "windup",
      windupTicksRemaining: 3,
      attackCount: 1,
      damageAttemptCount: 0,
    });
    step(simulation, 2);
    expect(simulation.diagnostics().playerHealth).toBe(100);
    step(simulation, 1);
    expect(simulation.diagnostics().enemy).toMatchObject({
      state: "recovering",
      damageAttemptCount: 1,
      damageAppliedCount: 1,
    });

    step(simulation, 7);
    expect(simulation.diagnostics().enemy).toMatchObject({
      state: "windup",
      windupTicksRemaining: 3,
      attackCount: 2,
      damageAttemptCount: 1,
    });
    step(simulation, 3);
    expect(simulation.diagnostics().enemy.damageAttemptCount).toBe(2);

    const damageTicks = simulation
      .drainEvents()
      .filter(
        (event) =>
          event.type === "damage-applied" && event.targetId === "player",
      )
      .map((event) => event.tick);
    expect(damageTicks).toEqual([4, 14]);
  });

  it("honors dodge invulnerability on the exact strike resolution tick", () => {
    const simulation = createSimulation({
      attackWindupTicks: 4,
      attackIntervalTicks: 12,
      attackDamage: 35,
    });

    step(simulation, 4);
    expect(simulation.diagnostics().enemy.windupTicksRemaining).toBe(1);
    simulation.requestDodge();
    step(simulation, 1);

    expect(simulation.diagnostics()).toMatchObject({
      playerHealth: 100,
      dodging: true,
      enemy: {
        damageAttemptCount: 1,
        damageAppliedCount: 0,
      },
    });
    expect(simulation.drainEvents()).toContainEqual({
      type: "damage-ignored",
      tick: 5,
      targetId: "player",
      reason: "invulnerable",
    });
  });

  it("kills the player once and never attacks a dead player", () => {
    const simulation = createSimulation({
      attackDamage: 100,
      attackWindupTicks: 2,
      attackIntervalTicks: 8,
    });

    step(simulation, 3);
    expect(simulation.diagnostics()).toMatchObject({
      playerHealth: 0,
      playerDead: true,
      enemy: {
        state: "idle",
        attackCount: 1,
        damageAttemptCount: 1,
      },
    });
    step(simulation, 40);
    expect(simulation.diagnostics().enemy.damageAttemptCount).toBe(1);
    expect(
      simulation.drainEvents().filter((event) => event.type === "entity-died"),
    ).toHaveLength(1);
  });

  it("dies once, stops its lifecycle, and fully restores on reset", () => {
    const simulation = createSimulation({
      attackWindupTicks: 20,
      attackIntervalTicks: 40,
    });
    const attack = simulation.config.primaryAttack;
    simulation.setAim(1, 0);

    for (let attackIndex = 0; attackIndex < 4; attackIndex += 1) {
      simulation.requestPrimaryAttack();
      step(
        simulation,
        attack.startupTicks + attack.activeTicks + attack.recoveryTicks,
      );
    }

    const dead = simulation.diagnostics();
    expect(dead.enemy).toMatchObject({ health: 0, dead: true, state: "dead" });
    const deadPosition = { x: dead.enemy.x, y: dead.enemy.y };
    step(simulation, 60);
    expect(simulation.diagnostics().enemy).toMatchObject({
      ...deadPosition,
      state: "dead",
      damageAttemptCount: dead.enemy.damageAttemptCount,
    });
    expect(
      simulation
        .drainEvents()
        .filter(
          (event) =>
            event.type === "entity-died" &&
            event.entityId === simulation.config.enemy.id,
        ),
    ).toHaveLength(1);

    simulation.reset();
    expect(simulation.diagnostics()).toMatchObject({
      tick: 0,
      playerHealth: DEFAULT_COMBAT_ARENA_CONFIG.playerMaxHealth,
      playerDead: false,
      attackCount: 0,
      attackPhaseTicksRemaining: 0,
      dodgeCount: 0,
      dodgeTicksRemaining: 0,
      cooldownTicksRemaining: 0,
      enemy: {
        x: simulation.config.enemy.spawnX,
        y: simulation.config.enemy.spawnY,
        health: simulation.config.enemy.maxHealth,
        dead: false,
        state: "approaching",
        windupTicksRemaining: 0,
        cadenceTicksRemaining: 0,
        attackCount: 0,
        damageAttemptCount: 0,
        damageAppliedCount: 0,
      },
      eventCount: 0,
    });
  });
});

import { describe, expect, it } from "vitest";

import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  COMBAT_ABILITY_DEFINITIONS,
  CombatArenaSimulation,
  DEFIANT_SIGNAL_ID,
  FIXED_STEP_SECONDS,
  RefreshingStatusStore,
  WINTER_PULSE_ID,
  damageAfterModifier,
  pointInArea,
  sweptCircleHitFraction,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

describe("Phase 2 combat abilities", () => {
  it("defines exactly the chosen abilities with stable timing, targeting, and tags", () => {
    expect(COMBAT_ABILITY_DEFINITIONS).toHaveLength(4);
    expect(COMBAT_ABILITY_DEFINITIONS).toEqual([
      expect.objectContaining({
        id: BASIC_CLEAVE_ID,
        tags: [
          "tag:attack",
          "tag:melee",
          "tag:aoe",
          "tag:physical",
          "tag:primary",
        ],
        targeting: { mode: "direction", range: 110 },
        timing: { startupTicks: 4, activeTicks: 3, recoveryTicks: 8 },
      }),
      expect.objectContaining({
        id: CINDER_DART_ID,
        tags: ["tag:spell", "tag:projectile", "tag:fire"],
        timing: { startupTicks: 7, activeTicks: 1, recoveryTicks: 8 },
      }),
      expect.objectContaining({
        id: WINTER_PULSE_ID,
        tags: ["tag:spell", "tag:aoe", "tag:cold", "tag:debuff"],
        timing: { startupTicks: 12, activeTicks: 1, recoveryTicks: 11 },
      }),
      expect.objectContaining({
        id: DEFIANT_SIGNAL_ID,
        tags: ["tag:spell", "tag:aoe", "tag:buff", "tag:debuff"],
        timing: { startupTicks: 6, activeTicks: 1, recoveryTicks: 8 },
      }),
    ]);
  });

  it("pays costs, rejects cooldown and insufficient mana, and regenerates exactly", () => {
    const simulation = new CombatArenaSimulation();
    expect(simulation.requestAbility(CINDER_DART_ID).accepted).toBe(true);
    expect(simulation.diagnostics().mana).toBe(85);
    expect(simulation.requestAbility(CINDER_DART_ID)).toMatchObject({
      accepted: false,
      reason: "cooldown-active",
    });
    expect(
      simulation.requestAbility(WINTER_PULSE_ID, {
        kind: "point",
        x: 600,
        y: 400,
      }).accepted,
    ).toBe(true);
    expect(simulation.requestAbility(DEFIANT_SIGNAL_ID).accepted).toBe(true);
    expect(simulation.diagnostics().mana).toBe(40);
    step(simulation, 30);
    expect(simulation.diagnostics().mana).toBe(43);

    simulation.reset();
    for (let cast = 0; cast < 8; cast += 1) {
      expect(simulation.requestAbility(CINDER_DART_ID).accepted).toBe(true);
      step(simulation, 30);
    }
    expect(simulation.requestAbility(CINDER_DART_ID)).toMatchObject({
      accepted: false,
      reason: "insufficient-resource",
    });
  });

  it("uses swept projectile and area geometry including target radii", () => {
    expect(sweptCircleHitFraction(0, 0, 100, 0, 6, 50, 0, 4)).toBeCloseTo(0.4);
    expect(sweptCircleHitFraction(0, 0, 100, 0, 2, 50, 10, 2)).toBeNull();
    expect(pointInArea(0, 0, 100, 110, 0, 10)).toBe(true);
    expect(pointInArea(0, 0, 100, 111, 0, 10)).toBe(false);
  });

  it("refreshes statuses without stacking and expires before the expiry tick effects", () => {
    const statuses = new RefreshingStatusStore();
    statuses.apply("enemy", "chilled", 10, 120);
    statuses.apply("enemy", "chilled", 20, 120);
    expect(statuses.values()).toHaveLength(1);
    expect(statuses.remaining("enemy", "chilled", 20)).toBe(120);
    statuses.expire(139);
    expect(statuses.has("enemy", "chilled")).toBe(true);
    statuses.expire(140);
    expect(statuses.has("enemy", "chilled")).toBe(false);
  });

  it("floors focused and weakened damage modifiers", () => {
    expect(damageAfterModifier(30, 1.2)).toBe(36);
    expect(damageAfterModifier(20, 1.2)).toBe(24);
    expect(damageAfterModifier(10, 0.8)).toBe(8);
    expect(damageAfterModifier(7, 0.8)).toBe(5);
  });

  it("runs projectile, point area, statuses, and clears transient state on reset/death", () => {
    const simulation = new CombatArenaSimulation({
      ...new CombatArenaSimulation().config,
      enemy: {
        ...new CombatArenaSimulation().config.enemy,
        spawnX: 750,
        spawnY: 400,
      },
    });
    simulation.setAim(1, 0);
    simulation.requestAbility(DEFIANT_SIGNAL_ID);
    step(simulation, 6);
    expect(simulation.diagnostics().statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetId: "player", statusId: "focused" }),
        expect.objectContaining({ statusId: "weakened" }),
      ]),
    );

    simulation.requestAbility(CINDER_DART_ID);
    step(simulation, 7);
    expect(simulation.diagnostics().projectiles).toHaveLength(1);
    step(simulation, 15);
    expect(simulation.diagnostics().enemy.health).toBe(14);

    simulation.reset();
    simulation.requestAbility(WINTER_PULSE_ID, {
      kind: "point",
      x: 750,
      y: 400,
    });
    step(simulation, 12);
    expect(simulation.diagnostics()).toMatchObject({
      enemy: { health: 30 },
      statuses: [
        expect.objectContaining({ statusId: "chilled", ticksRemaining: 120 }),
      ],
    });
    expect(simulation.diagnostics().areaFeedback).toHaveLength(1);

    simulation.applyPlayerDamage({ amount: 1_000, sourceId: "enemy" });
    expect(simulation.diagnostics()).toMatchObject({
      playerDead: true,
      statuses: [],
      projectiles: [],
    });
    simulation.reset();
    expect(simulation.diagnostics()).toMatchObject({
      mana: 100,
      statuses: [],
      projectiles: [],
      areaFeedback: [],
    });
  });

  it("applies focused pulse damage, chilled movement, and weakened strikes", () => {
    const base = new CombatArenaSimulation().config;
    const focused = new CombatArenaSimulation({
      ...base,
      enemy: { ...base.enemy, spawnX: 750, spawnY: 400 },
    });
    focused.requestAbility(DEFIANT_SIGNAL_ID);
    step(focused, 6);
    focused.requestAbility(WINTER_PULSE_ID, {
      kind: "point",
      x: 750,
      y: 400,
    });
    step(focused, 12);
    expect(focused.diagnostics().enemy.health).toBe(26);

    const normal = new CombatArenaSimulation({
      ...base,
      enemy: { ...base.enemy, spawnX: 900, spawnY: 400 },
    });
    const chilled = new CombatArenaSimulation({
      ...base,
      enemy: { ...base.enemy, spawnX: 900, spawnY: 400 },
    });
    chilled.requestAbility(WINTER_PULSE_ID, {
      kind: "point",
      x: 900,
      y: 400,
    });
    step(normal, 12);
    step(chilled, 12);
    step(normal, 1);
    step(chilled, 1);
    const normalTravel =
      normal.diagnostics().enemy.previousX - normal.diagnostics().enemy.x;
    const chilledTravel =
      chilled.diagnostics().enemy.previousX - chilled.diagnostics().enemy.x;
    expect(chilledTravel).toBeCloseTo(normalTravel * 0.7, 10);

    const weakened = new CombatArenaSimulation({
      ...base,
      enemy: {
        ...base.enemy,
        spawnX: 600 + base.enemy.meleeRange,
        spawnY: 400,
        attackWindupTicks: 10,
        attackIntervalTicks: 30,
      },
    });
    weakened.requestAbility(DEFIANT_SIGNAL_ID);
    step(weakened, 11);
    expect(weakened.diagnostics()).toMatchObject({
      playerHealth: 92,
      enemy: { damageAppliedCount: 1 },
    });
  });
});

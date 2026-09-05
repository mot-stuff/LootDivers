import { describe, expect, it } from "vitest";

import {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  DEFIANT_SIGNAL_ID,
  FIXED_STEP_SECONDS,
  FLASK_BASE_CHARGES_GAINED_ON_KILL,
  FLASK_DRINK_SHARED_COOLDOWN_TICKS,
  FLASK_MINIMUM_CHARGES_USED,
  BASIC_CLEAVE_ID,
  HEARTHMERE_ID,
  contentId,
  createAbilityStoneStack,
  definitionById,
  flaskEffectiveStats,
  flaskResourceOf,
  persistentInstanceId,
  type EquipmentItemInstance,
} from "../../src/core";

function step(simulation: CombatArenaSimulation, count: number): void {
  for (let index = 0; index < count; index += 1) {
    simulation.step({
      tick: simulation.diagnostics().tick,
      deltaSeconds: FIXED_STEP_SECONDS,
    });
  }
}

/**
 * Commons carry exactly one affix, so every legal flask instance includes
 * one. Tests pick the affix orthogonal to the dimension under assertion
 * (e.g. Reaping when asserting the recovery curve).
 */
interface TestAffix {
  readonly affixId: string;
  readonly tier: number;
  readonly statId: string;
  readonly operation: "flat" | "additive-basis-points";
  readonly value: number;
}

const REAPING_T5: TestAffix = {
  affixId: "affix:reaping",
  tier: 5,
  statId: "stat:flask-charges-on-kill",
  operation: "flat",
  value: 1,
};

let nextSerial = 1;
function flask(
  kind: "life" | "mana",
  affix: TestAffix = REAPING_T5,
): EquipmentItemInstance {
  return {
    kind: "equipment",
    instanceId: persistentInstanceId(`item:flask-test-${nextSerial++}`),
    baseId: contentId(
      kind === "life" ? "item:heartwell-flask" : "item:mindwell-flask",
    ),
    rarity: "common",
    requiredLevel: 1,
    origin: "loot",
    affixes: [
      {
        affixId: contentId(affix.affixId),
        tier: affix.tier,
        modifier: {
          statId: contentId(affix.statId),
          operation: affix.operation,
          value: affix.value,
        },
      },
    ],
  };
}

/** A simulation parked in safe Hearthmere with flasks equipped. */
function hearthmereArena(
  ...flasks: readonly EquipmentItemInstance[]
): CombatArenaSimulation {
  const simulation = new CombatArenaSimulation();
  for (const item of flasks) {
    expect(simulation.addCharacterItem(item)).toMatchObject({
      accepted: true,
    });
  }
  for (const [index] of flasks.entries()) {
    expect(
      simulation.equipCharacterItem(
        index,
        `flask-${index + 1}` as "flask-1" | "flask-2" | "flask-3" | "flask-4",
      ),
    ).toEqual({ accepted: true });
  }
  expect(simulation.travelTo(HEARTHMERE_ID)).toMatchObject({ accepted: true });
  return simulation;
}

function playerHealth(simulation: CombatArenaSimulation): number {
  return simulation.diagnostics().playerHealth;
}

describe("flaskEffectiveStats (memo §1.2/§1.3 per-drink algorithm)", () => {
  it("reads Heartwell catalog stats: 70 health over 300 ticks, 30/20 charges", () => {
    const stats = flaskEffectiveStats(flask("life"));
    expect(stats).toMatchObject({
      resource: "health",
      totalRecovery: 70,
      instantAmount: 0,
      overTimeAmount: 70,
      effectiveDurationTicks: 300,
      maximumCharges: 30,
      chargesUsedPerDrink: 20,
      chargesGainedOnKill: FLASK_BASE_CHARGES_GAINED_ON_KILL + 1,
    });
  });

  it("reads Mindwell catalog stats: 50 mana over 240 ticks", () => {
    const stats = flaskEffectiveStats(flask("mana"));
    expect(stats).toMatchObject({
      resource: "mana",
      totalRecovery: 50,
      instantAmount: 0,
      overTimeAmount: 50,
      effectiveDurationTicks: 240,
      maximumCharges: 30,
      chargesUsedPerDrink: 20,
    });
  });

  it("Brimming adds flat recovery", () => {
    const stats = flaskEffectiveStats(
      flask("life", {
        affixId: "affix:brimming",
        tier: 1,
        statId: "stat:flask-recovery",
        operation: "flat",
        value: 32,
      }),
    );
    expect(stats).toMatchObject({ totalRecovery: 102, overTimeAmount: 102 });
  });

  it("Sudden splits an instant floor portion out of total recovery", () => {
    const stats = flaskEffectiveStats(
      flask("life", {
        affixId: "affix:sudden",
        tier: 1,
        statId: "stat:flask-instant-recovery",
        operation: "additive-basis-points",
        value: 3000,
      }),
    );
    // floor(70 × 3000 / 10000) = 21 instant, 49 over time; total unchanged.
    expect(stats).toMatchObject({
      totalRecovery: 70,
      instantAmount: 21,
      overTimeAmount: 49,
      effectiveDurationTicks: 300,
    });
  });

  it("Fleetpour compresses duration, keeping the same total", () => {
    const stats = flaskEffectiveStats(
      flask("life", {
        affixId: "affix:fleetpour",
        tier: 1,
        statId: "stat:flask-recovery-rate",
        operation: "additive-basis-points",
        value: 5000,
      }),
    );
    // round(300 / 1.5) = 200 ticks.
    expect(stats).toMatchObject({
      totalRecovery: 70,
      overTimeAmount: 70,
      effectiveDurationTicks: 200,
    });
  });

  it("Deep Reserve raises maximum charges", () => {
    const stats = flaskEffectiveStats(
      flask("life", {
        affixId: "affix:deep-reserve",
        tier: 1,
        statId: "stat:flask-charges",
        operation: "flat",
        value: 14,
      }),
    );
    expect(stats).toMatchObject({ maximumCharges: 44 });
  });

  it("Thrifty lowers charges per drink, floored at the memo minimum", () => {
    const stats = flaskEffectiveStats(
      flask("life", {
        affixId: "affix:thrifty",
        tier: 1,
        statId: "stat:flask-charges-used-reduction",
        operation: "flat",
        value: 9,
      }),
    );
    expect(stats).toMatchObject({ chargesUsedPerDrink: 11 });
    expect(stats!.chargesUsedPerDrink).toBeGreaterThanOrEqual(
      FLASK_MINIMUM_CHARGES_USED,
    );
  });

  it("Reaping raises charges gained on kill above the memo base", () => {
    const stats = flaskEffectiveStats(
      flask("life", {
        affixId: "affix:reaping",
        tier: 1,
        statId: "stat:flask-charges-on-kill",
        operation: "flat",
        value: 5,
      }),
    );
    expect(stats).toMatchObject({
      chargesGainedOnKill: FLASK_BASE_CHARGES_GAINED_ON_KILL + 5,
    });
  });

  it("derives the restored resource from the base's catalog tags", () => {
    expect(flaskResourceOf(flask("life"))).toBe("health");
    expect(flaskResourceOf(flask("mana"))).toBe("mana");
  });
});

describe("useFlask charge economy and restore-over-time", () => {
  it("restores health linearly over the effective duration and clamps at max", () => {
    const simulation = hearthmereArena(flask("life"));
    simulation.applyPlayerDamage({ amount: 60, sourceId: "test" });
    expect(playerHealth(simulation)).toBe(40);

    const result = simulation.useFlask("flask-1");
    expect(result).toMatchObject({
      accepted: true,
      resource: "health",
      instantApplied: 0,
      overTimeAmount: 70,
      durationTicks: 300,
      chargesSpent: 20,
    });
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 10,
      chargesMaximum: 30,
    });

    // Cumulative rounding: halfway through, exactly half the restore.
    step(simulation, 150);
    expect(playerHealth(simulation)).toBe(75);
    // 40 + 70 overflows the 100 maximum; overflow is lost.
    step(simulation, 150);
    expect(playerHealth(simulation)).toBe(100);
    expect(simulation.diagnostics().flaskRecoveries).toHaveLength(0);
  });

  it("lands the Sudden portion on the drink tick", () => {
    const simulation = hearthmereArena(
      flask("life", {
        affixId: "affix:sudden",
        tier: 1,
        statId: "stat:flask-instant-recovery",
        operation: "additive-basis-points",
        value: 3000,
      }),
    );
    simulation.applyPlayerDamage({ amount: 60, sourceId: "test" });

    const result = simulation.useFlask("flask-1");
    expect(result).toMatchObject({ accepted: true, instantApplied: 21 });
    expect(playerHealth(simulation)).toBe(61);

    // Remaining 49 arrives over 300 ticks: round(49 × 150 / 300) = 25.
    step(simulation, 150);
    expect(playerHealth(simulation)).toBe(86);
  });

  it("Fleetpour applies the same total in a shorter window", () => {
    const simulation = hearthmereArena(
      flask("life", {
        affixId: "affix:fleetpour",
        tier: 1,
        statId: "stat:flask-recovery-rate",
        operation: "additive-basis-points",
        value: 5000,
      }),
    );
    simulation.applyPlayerDamage({ amount: 80, sourceId: "test" });

    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: true,
      durationTicks: 200,
    });
    step(simulation, 200);
    expect(playerHealth(simulation)).toBe(90);
    expect(simulation.diagnostics().flaskRecoveries).toHaveLength(0);
  });

  it("restores mana through the subunit pool alongside natural regen", () => {
    const simulation = hearthmereArena(flask("mana"));
    simulation.addCharacterItem(
      createAbilityStoneStack(persistentInstanceId("item:flask-mana-stone"), 1),
    );
    // The flask left inventory slot 0 when it was equipped, so the stone
    // occupies slot 0 now.
    expect(
      simulation.consumeCharacterAbilityStone(0, DEFIANT_SIGNAL_ID),
    ).toMatchObject({ accepted: true });
    expect(simulation.requestAbility(DEFIANT_SIGNAL_ID).accepted).toBe(true);
    // Let the cast fully settle its mana payment before measuring.
    step(simulation, 5);
    const manaAfterCast = simulation.diagnostics().mana;
    expect(manaAfterCast).toBeLessThan(100);

    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: true,
      resource: "mana",
      overTimeAmount: 50,
      durationTicks: 240,
    });
    // After 48 ticks: cast remainder + 48 regen subunits + round(500 × 48/240)
    // = +148 subunits (14.8 mana) unless clamped.
    step(simulation, 48);
    expect(simulation.diagnostics().mana).toBeCloseTo(
      Math.min(100, manaAfterCast + 4.8 + 10),
      5,
    );
    // The full drink plus regen overflows the maximum; overflow is lost.
    step(simulation, 240);
    expect(simulation.diagnostics().mana).toBe(100);
  });

  it("enforces the shared cooldown across slots for exactly 18 ticks", () => {
    const simulation = hearthmereArena(flask("life"), flask("life"));
    simulation.applyPlayerDamage({ amount: 90, sourceId: "test" });

    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    expect(simulation.useFlask("flask-2")).toMatchObject({
      accepted: false,
      reason: "shared-cooldown",
    });
    step(simulation, FLASK_DRINK_SHARED_COOLDOWN_TICKS - 1);
    expect(simulation.useFlask("flask-2")).toMatchObject({
      accepted: false,
      reason: "shared-cooldown",
    });
    step(simulation, 1);
    expect(simulation.useFlask("flask-2")).toMatchObject({ accepted: true });
    // Rejections spent nothing: slot 2 spent exactly one drink.
    expect(simulation.diagnostics().flasks[1]).toMatchObject({
      chargesCurrent: 10,
    });
  });

  it("replaces an active same-resource recovery and discards its remainder", () => {
    const simulation = hearthmereArena(flask("life"), flask("life"));
    simulation.applyPlayerDamage({ amount: 90, sourceId: "test" });
    expect(playerHealth(simulation)).toBe(10);

    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    step(simulation, FLASK_DRINK_SHARED_COOLDOWN_TICKS);
    // First drink applied round(70 × 18 / 300) = 4 so far.
    expect(playerHealth(simulation)).toBe(14);

    expect(simulation.useFlask("flask-2").accepted).toBe(true);
    const recoveries = simulation.diagnostics().flaskRecoveries;
    expect(recoveries).toHaveLength(1);
    expect(recoveries[0]).toMatchObject({
      resource: "health",
      remainingAmount: 70,
    });
    // Run both windows out: total healed is 4 + 70, not 140.
    step(simulation, 320);
    expect(playerHealth(simulation)).toBe(84);
  });

  it("rejects a second drink without enough charges and spends nothing", () => {
    const simulation = hearthmereArena(flask("life"));
    simulation.applyPlayerDamage({ amount: 90, sourceId: "test" });
    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    step(simulation, FLASK_DRINK_SHARED_COOLDOWN_TICKS);

    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: false,
      reason: "insufficient-charges",
    });
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 10,
    });
  });

  it("Thrifty stretches the charge pool into extra drinks", () => {
    const simulation = hearthmereArena(
      flask("life", {
        affixId: "affix:thrifty",
        tier: 1,
        statId: "stat:flask-charges-used-reduction",
        operation: "flat",
        value: 9,
      }),
    );
    simulation.applyPlayerDamage({ amount: 99, sourceId: "test" });

    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: true,
      chargesSpent: 11,
    });
    step(simulation, FLASK_DRINK_SHARED_COOLDOWN_TICKS);
    expect(simulation.useFlask("flask-1")).toMatchObject({ accepted: true });
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 8,
    });
    step(simulation, FLASK_DRINK_SHARED_COOLDOWN_TICKS);
    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: false,
      reason: "insufficient-charges",
    });
  });

  it("rejects drinking at full health or with an empty slot", () => {
    const simulation = hearthmereArena(flask("life"));
    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: false,
      reason: "resource-full",
    });
    expect(simulation.useFlask("flask-3")).toMatchObject({
      accepted: false,
      reason: "slot-empty",
    });
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 30,
    });
    expect(simulation.diagnostics().lastFlaskResult).toMatchObject({
      accepted: false,
      slot: "flask-3",
      reason: "slot-empty",
    });
  });
});

describe("kill feeding, refill triggers, and death interaction", () => {
  function killableArena(
    ...flasks: readonly EquipmentItemInstance[]
  ): CombatArenaSimulation {
    const simulation = new CombatArenaSimulation({
      ...DEFAULT_COMBAT_ARENA_CONFIG,
      enemy: {
        ...DEFAULT_COMBAT_ARENA_CONFIG.enemy,
        spawnX: DEFAULT_COMBAT_ARENA_CONFIG.width / 2 + 90,
        spawnY: DEFAULT_COMBAT_ARENA_CONFIG.height / 2,
        maxHealth: 1,
      },
    });
    for (const [index, item] of flasks.entries()) {
      expect(simulation.addCharacterItem(item)).toMatchObject({
        accepted: true,
      });
      // Each add lands in the freshly vacated inventory slot 0.
      expect(
        simulation.equipCharacterItem(
          0,
          `flask-${index + 1}` as "flask-1" | "flask-2",
        ),
      ).toEqual({ accepted: true });
    }
    return simulation;
  }

  function killEnemy(simulation: CombatArenaSimulation): void {
    expect(simulation.requestAbility(BASIC_CLEAVE_ID).accepted).toBe(true);
    step(
      simulation,
      (definitionById(BASIC_CLEAVE_ID)?.timing.startupTicks ?? 0) + 1,
    );
    expect(simulation.diagnostics().enemy.dead).toBe(true);
  }

  it("feeds every equipped flask on a kill, clamped at its maximum", () => {
    const simulation = killableArena(
      flask("life", {
        affixId: "affix:reaping",
        tier: 1,
        statId: "stat:flask-charges-on-kill",
        operation: "flat",
        value: 5,
      }),
      flask("mana"),
    );
    simulation.applyPlayerDamage({ amount: 50, sourceId: "test" });
    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 10,
    });

    killEnemy(simulation);
    // Reaping flask gains 5 + 5; the untouched full mana flask stays clamped.
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 20,
    });
    expect(simulation.diagnostics().flasks[1]).toMatchObject({
      chargesCurrent: 30,
      chargesMaximum: 30,
    });
  });

  it("refills to full charges on zone entry and clears active recovery", () => {
    const simulation = hearthmereArena(flask("life"));
    simulation.applyPlayerDamage({ amount: 60, sourceId: "test" });
    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    step(simulation, 5);

    expect(simulation.travelTo(HEARTHMERE_ID)).toMatchObject({
      accepted: true,
    });
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 30,
    });
    expect(simulation.diagnostics().flaskRecoveries).toHaveLength(0);
    expect(simulation.diagnostics().flaskCooldownTicksRemaining).toBe(0);
  });

  it("refills on respawn after death and rejects drinking while dead", () => {
    const simulation = hearthmereArena(flask("life"));
    simulation.applyPlayerDamage({ amount: 60, sourceId: "test" });
    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    step(simulation, 10);

    simulation.applyPlayerDamage({ amount: 999, sourceId: "test" });
    expect(simulation.diagnostics().playerDead).toBe(true);
    // Death cancels the pending recovery (memo §4 invariant 8)...
    expect(simulation.diagnostics().flaskRecoveries).toHaveLength(0);
    const healthWhenDead = playerHealth(simulation);
    step(simulation, 60);
    expect(playerHealth(simulation)).toBe(healthWhenDead);
    // ...and dead players cannot drink.
    expect(simulation.useFlask("flask-1")).toMatchObject({
      accepted: false,
      reason: "player-defeated",
    });

    expect(simulation.respawn()).toMatchObject({ accepted: true });
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      chargesCurrent: 30,
    });
  });

  it("refills on reset and after a save restore (charges are transient)", () => {
    const simulation = hearthmereArena(flask("life"));
    simulation.applyPlayerDamage({ amount: 60, sourceId: "test" });
    expect(simulation.useFlask("flask-1").accepted).toBe(true);

    // The save DTO carries the flask item but no charge state (DEC-034).
    const save = simulation.captureCharacterSave();
    expect(JSON.stringify(save)).not.toContain("chargesCurrent");
    simulation.restoreCharacterSave(save);
    expect(simulation.diagnostics().flasks[0]).toMatchObject({
      displayName: "Heartwell Flask",
      chargesCurrent: 30,
    });

    expect(simulation.useFlask("flask-1").accepted).toBe(false);
    simulation.applyPlayerDamage({ amount: 60, sourceId: "test" });
    step(simulation, FLASK_DRINK_SHARED_COOLDOWN_TICKS);
    expect(simulation.useFlask("flask-1").accepted).toBe(true);
    simulation.reset();
    expect(simulation.diagnostics().flaskCooldownTicksRemaining).toBe(0);
    expect(simulation.diagnostics().flaskRecoveries).toHaveLength(0);
    expect(simulation.diagnostics().lastFlaskResult).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { HealthPool } from "../../src/core";

describe("HealthPool", () => {
  it("clamps damage at zero and reports death only once", () => {
    const health = new HealthPool(30);

    expect(health.applyDamage({ amount: 50 })).toMatchObject({
      applied: 30,
      previousHealth: 30,
      currentHealth: 0,
      died: true,
      ignoredReason: null,
    });
    expect(health.applyDamage({ amount: 1 })).toMatchObject({
      applied: 0,
      currentHealth: 0,
      died: false,
      ignoredReason: "dead",
    });
  });

  it("resets to maximum health", () => {
    const health = new HealthPool(30);
    health.applyDamage({ amount: 12 });
    health.reset();
    expect(health.health).toEqual({ current: 30, max: 30, dead: false });
  });

  it("updates maximum health while preserving missing health", () => {
    const health = new HealthPool(30);
    health.applyDamage({ amount: 12 });

    expect(health.updateMaximum(40)).toEqual({
      current: 28,
      max: 40,
      dead: false,
    });
    expect(health.updateMaximum(10)).toEqual({
      current: 0,
      max: 10,
      dead: true,
    });

    health.updateMaximum(35);
    health.reset();
    expect(health.health).toEqual({ current: 35, max: 35, dead: false });
  });

  it("rejects invalid health and damage values", () => {
    expect(() => new HealthPool(0)).toThrow(RangeError);
    const health = new HealthPool(30);
    expect(() => health.updateMaximum(0)).toThrow(RangeError);
    expect(() => health.applyDamage({ amount: -1 })).toThrow(RangeError);
    expect(() => health.applyDamage({ amount: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

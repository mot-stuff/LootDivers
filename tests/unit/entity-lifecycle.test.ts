import { describe, expect, it } from "vitest";

import {
  NavigationGrid,
  PresentationKind,
  SYNTHETIC_ENTITY_COUNT,
  SYNTHETIC_FIXTURE_SEED,
  SyntheticLifecycleFixture,
  TECHNICAL_UPDATE_ORDER,
  TechnicalEntityLifecycle,
} from "../../src/core";

function fixtureGrid(): NavigationGrid {
  const size = 128 * 128;
  return new NavigationGrid({
    width: 128,
    height: 128,
    costs: new Array<number>(size).fill(1),
    elevations: new Array<number>(size).fill(0),
  });
}

describe("technical entity lifecycle", () => {
  it("uses opaque IDs and removes every component during cleanup", () => {
    const lifecycle = new TechnicalEntityLifecycle(3);
    const first = lifecycle.create(
      { x: 10, y: 20, elevation: 0 },
      PresentationKind.Actor,
    );
    const second = lifecycle.create(
      { x: 30, y: 40, elevation: 1 },
      PresentationKind.Loot,
    );

    expect(first).not.toBe(second);
    expect(lifecycle.requestDestroy(first)).toBe(true);
    expect(lifecycle.requestDestroy(first)).toBe(false);
    expect(lifecycle.flushCleanup()).toBe(1);
    expect(lifecycle.isAlive(first)).toBe(false);
    expect(lifecycle.transforms.has(first)).toBe(false);
    expect(lifecycle.presentations.has(first)).toBe(false);
    expect(lifecycle.transforms.has(second)).toBe(true);
    expect(lifecycle.diagnostics()).toEqual({
      liveEntities: 1,
      pendingCleanup: 0,
      transformComponents: 1,
      presentationComponents: 1,
      created: 2,
      destroyed: 1,
    });

    lifecycle.destroyAll();
    expect(lifecycle.diagnostics()).toEqual({
      liveEntities: 0,
      pendingCleanup: 0,
      transformComponents: 0,
      presentationComponents: 0,
      created: 2,
      destroyed: 2,
    });
  });

  it("rolls dense component slots without stale lookup entries", () => {
    const lifecycle = new TechnicalEntityLifecycle(3);
    const first = lifecycle.create(
      { x: 1, y: 1, elevation: 0 },
      PresentationKind.Actor,
    );
    const middle = lifecycle.create(
      { x: 2, y: 2, elevation: 0 },
      PresentationKind.Projectile,
    );
    const last = lifecycle.create(
      { x: 3, y: 3, elevation: 0 },
      PresentationKind.Loot,
    );
    lifecycle.requestDestroy(middle);
    lifecycle.flushCleanup();

    expect(lifecycle.transforms.indexOf(first)).toBe(0);
    expect(lifecycle.transforms.indexOf(last)).toBe(1);
    expect(lifecycle.transforms.indexOf(middle)).toBe(-1);
    expect(lifecycle.transforms.ids[1]).toBe(last);
  });
});

describe("P0-002 lifecycle fixture", () => {
  it("creates exact populations and executes the declared load", () => {
    const fixture = new SyntheticLifecycleFixture(fixtureGrid());
    for (let step = 0; step < 6; step += 1) {
      fixture.step();
    }
    const diagnostics = fixture.diagnostics();

    expect(diagnostics.seed).toBe(SYNTHETIC_FIXTURE_SEED);
    expect(diagnostics.updateOrder).toEqual(TECHNICAL_UPDATE_ORDER);
    expect(diagnostics.populations).toEqual({
      actors: 200,
      projectiles: 500,
      cosmeticParticles: 1_000,
      loot: 100,
      total: SYNTHETIC_ENTITY_COUNT,
    });
    expect(diagnostics.queries.actorRadius).toBe(1_200);
    expect(diagnostics.queries.projectileSweeps).toBe(3_000);
    expect(diagnostics.paths.requested).toBe(2);
    expect(diagnostics.paths.requested).toBe(
      diagnostics.paths.completed +
        diagnostics.paths.noPath +
        diagnostics.paths.budgetExhausted +
        diagnostics.paths.invalid,
    );
    expect(diagnostics.paths.invalid).toBe(0);
    expect(diagnostics.projectAllocations.structuralAfterWarmup).toBe(0);

    fixture.dispose();
    expect(fixture.lifecycle.diagnostics()).toMatchObject({
      liveEntities: 0,
      transformComponents: 0,
      presentationComponents: 0,
      destroyed: SYNTHETIC_ENTITY_COUNT,
    });
  });

  it("is deterministic for the same seed and step count", () => {
    const first = new SyntheticLifecycleFixture(fixtureGrid());
    const second = new SyntheticLifecycleFixture(fixtureGrid());
    for (let step = 0; step < 12; step += 1) {
      first.step();
      second.step();
    }
    const left = first.diagnostics();
    const right = second.diagnostics();

    expect(left.populations).toEqual(right.populations);
    expect(left.queries).toEqual(right.queries);
    expect(left.paths).toEqual(right.paths);
    expect(left.projectAllocations).toEqual(right.projectAllocations);
    expect(Array.from(first.lifecycle.transforms.x)).toEqual(
      Array.from(second.lifecycle.transforms.x),
    );
    expect(Array.from(first.lifecycle.transforms.y)).toEqual(
      Array.from(second.lifecycle.transforms.y),
    );
  });
});

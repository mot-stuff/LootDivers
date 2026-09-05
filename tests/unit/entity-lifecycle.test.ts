import { describe, expect, it } from "vitest";

import {
  NavigationGrid,
  FIXTURE_STAGE_SAMPLE_CAPACITY,
  PresentationKind,
  SYNTHETIC_ENTITY_COUNT,
  SYNTHETIC_FIXTURE_SEED,
  SyntheticLifecycleFixture,
  TECHNICAL_UPDATE_ORDER,
  TechnicalEntityLifecycle,
  type RuntimeEntityId,
  type RuntimeEntityIdSource,
} from "../../src/core";
import { FixedPresentationPool } from "../../src/adapters/phaser/fixed-presentation-pool";

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

  it("rejects a duplicate generated ID before mutating existing components", () => {
    const duplicate = 7 as RuntimeEntityId;
    const ids: RuntimeEntityIdSource = {
      next: () => duplicate,
    };
    const lifecycle = new TechnicalEntityLifecycle(2, ids);
    lifecycle.create({ x: 1, y: 2, elevation: 0 }, PresentationKind.Actor);

    expect(() =>
      lifecycle.create({ x: 3, y: 4, elevation: 0 }, PresentationKind.Loot),
    ).toThrow("duplicate ID 7");
    expect(lifecycle.transforms.has(duplicate)).toBe(true);
    expect(lifecycle.presentations.has(duplicate)).toBe(true);
    expect(lifecycle.diagnostics()).toMatchObject({
      liveEntities: 1,
      transformComponents: 1,
      presentationComponents: 1,
      created: 1,
      destroyed: 0,
    });
  });
});

describe("fixed presentation pool", () => {
  it("acquires, releases, reuses, and reports bounded failures", () => {
    const activated: number[] = [];
    const deactivated: number[] = [];
    const pool = new FixedPresentationPool(
      2,
      (slot) => ({ slot }),
      (resource, id) => {
        activated.push(resource.slot * 100 + id);
      },
      (resource) => {
        deactivated.push(resource.slot);
      },
    );

    const first = pool.acquire(10);
    pool.acquire(11);
    expect(() => pool.acquire(12)).toThrow("capacity exhausted");
    expect(() => pool.acquire(10)).toThrow("already exists");
    expect(pool.release(10)).toBe(true);
    expect(pool.release(10)).toBe(false);
    expect(pool.acquire(12)).toBe(first);
    expect(pool.diagnostics()).toEqual({
      capacity: 2,
      active: 2,
      available: 0,
      highWaterMark: 2,
      acquisitions: 3,
      releases: 1,
      exhaustionAttempts: 1,
      overflowAttempts: 1,
    });
    expect(activated).toHaveLength(3);
    expect(deactivated.length).toBeGreaterThanOrEqual(3);
  });
});

describe("P0-002 lifecycle fixture", () => {
  it("creates exact populations and executes the declared load", () => {
    const fixture = new SyntheticLifecycleFixture(fixtureGrid());
    fixture.beginTimingSample();
    for (let step = 0; step < 6; step += 1) {
      fixture.step();
    }
    fixture.endTimingSample();
    const diagnostics = fixture.diagnostics();
    const rawTimings = fixture.rawTimingSamples();

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
    expect(diagnostics.timingSamples).toMatchObject({
      sampling: false,
      capacity: FIXTURE_STAGE_SAMPLE_CAPACITY,
      overflowCount: 0,
      simulation: { sampleCount: 6 },
      spatial: { sampleCount: 6 },
      pathfinding: { sampleCount: 6 },
    });
    expect(rawTimings.simulationMilliseconds).toHaveLength(6);
    expect(rawTimings.spatialMilliseconds).toHaveLength(6);
    expect(rawTimings.pathfindingMilliseconds).toHaveLength(6);

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

  it("survives individual actor swap-removal and respawn cycles", () => {
    const fixture = new SyntheticLifecycleFixture(fixtureGrid());
    const transformXIdentity = fixture.lifecycle.transforms.x;
    const presentationKindsIdentity = fixture.lifecycle.presentations.kinds;
    const movedId = fixture.lootIds[
      fixture.lootIds.length - 1
    ] as RuntimeEntityId;
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const before = fixture.actorIds[0] as RuntimeEntityId;
      const result = fixture.replaceActor(0);
      expect(result.destroyed).toBe(before);
      expect(result.created).not.toBe(before);
      expect(fixture.lifecycle.isAlive(before)).toBe(false);
      expect(fixture.lifecycle.transforms.has(before)).toBe(false);
      expect(fixture.lifecycle.presentations.has(before)).toBe(false);
      expect(fixture.lifecycle.transforms.has(result.created)).toBe(true);
      fixture.step();
      fixture.assertPopulations();
    }
    expect(fixture.lifecycle.transforms.has(movedId)).toBe(true);
    expect(fixture.lifecycle.transforms.x).toBe(transformXIdentity);
    expect(fixture.lifecycle.presentations.kinds).toBe(
      presentationKindsIdentity,
    );
    expect(fixture.lifecycle.transforms.capacity).toBe(SYNTHETIC_ENTITY_COUNT);
    expect(fixture.lifecycle.diagnostics()).toMatchObject({
      liveEntities: SYNTHETIC_ENTITY_COUNT,
      created: SYNTHETIC_ENTITY_COUNT + 20,
      destroyed: 20,
    });
  });

  it("resets interpolation history when records wrap or recycle", () => {
    const fixture = new SyntheticLifecycleFixture(fixtureGrid());
    fixture.step(20);
    expect(
      fixture.diagnostics().projectAllocations.projectileWraps,
    ).toBeGreaterThan(0);
    const transforms = fixture.lifecycle.transforms;
    let resetProjectiles = 0;
    for (const numericId of fixture.projectileIds) {
      const index = transforms.indexOf(numericId as RuntimeEntityId);
      if (
        transforms.previousX[index] === transforms.x[index] &&
        transforms.previousY[index] === transforms.y[index]
      ) {
        resetProjectiles += 1;
      }
    }
    expect(resetProjectiles).toBeGreaterThan(0);

    const recyclesBefore =
      fixture.diagnostics().projectAllocations.particleRecycles;
    fixture.step(10);
    expect(
      fixture.diagnostics().projectAllocations.particleRecycles -
        recyclesBefore,
    ).toBe(1_000);
    for (const numericId of fixture.particleIds) {
      const index = transforms.indexOf(numericId as RuntimeEntityId);
      expect(transforms.previousX[index]).toBe(transforms.x[index]);
      expect(transforms.previousY[index]).toBe(transforms.y[index]);
    }
  });
});

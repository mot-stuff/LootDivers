import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { Mulberry32 } from "../../src/core/random";
import {
  aabbsOverlap,
  circleIntersectsAabb,
  circlesOverlap,
  segmentIntersectsAabb,
  segmentIntersectsCircle,
  SpatialQueryBuffer,
  UniformSpatialHash,
  type Aabb,
} from "../../src/core/spatial";
import { NavigationGrid } from "../../src/core/navigation-grid";
import {
  BoundedAStar,
  createPathResult,
  PathBuffer,
} from "../../src/core/pathfinding";
import {
  FairPathRequestScheduler,
  type PathRequest,
} from "../../src/core/path-scheduler";
import { computeLocalSeparation } from "../../src/core/separation";
import { compileTiledMap } from "../../src/world/compiler";
import { compileNavigationGrid } from "../../src/world/navigation-compiler";
import { navigationGridForZone } from "../../src/world/navigation";

function jsonFixture(name: string): unknown {
  const path = fileURLToPath(
    new URL(`../../fixtures/world/${name}`, import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function flatGrid(
  width: number,
  height: number,
  costs: readonly number[],
  elevations?: readonly number[],
): NavigationGrid {
  return new NavigationGrid({
    width,
    height,
    costs,
    elevations: elevations ?? new Array<number>(width * height).fill(0),
  });
}

describe("simple collision primitives", () => {
  it("treats touching boundaries as collisions", () => {
    expect(
      circlesOverlap({ x: 0, y: 0, radius: 2 }, { x: 4, y: 0, radius: 2 }),
    ).toBe(true);
    expect(
      aabbsOverlap(
        { minX: -2, minY: -2, maxX: 0, maxY: 0 },
        { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      ),
    ).toBe(true);
    expect(
      circleIntersectsAabb(
        { x: 3, y: 1, radius: 1 },
        { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      ),
    ).toBe(true);
    expect(
      segmentIntersectsCircle(
        { startX: -4, startY: 1, endX: 4, endY: 1 },
        { x: 0, y: 0, radius: 1 },
      ),
    ).toBe(true);
    expect(
      segmentIntersectsAabb(
        { startX: -1, startY: 0, endX: 3, endY: 0 },
        { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      ),
    ).toBe(true);
  });

  it("rejects separated and degenerate non-intersections", () => {
    expect(
      segmentIntersectsCircle(
        { startX: 3, startY: 3, endX: 3, endY: 3 },
        { x: 0, y: 0, radius: 1 },
      ),
    ).toBe(false);
    expect(
      segmentIntersectsAabb(
        { startX: -3, startY: -3, endX: -1, endY: -1 },
        { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      ),
    ).toBe(false);
  });
});

describe("uniform spatial hash", () => {
  it("deduplicates multi-cell records and filters exact elevation", () => {
    const spatial = new UniformSpatialHash(10);
    const output = new SpatialQueryBuffer();
    spatial.upsert(1, 0, { minX: -5, minY: -5, maxX: 15, maxY: 15 });
    spatial.upsert(2, 1, { minX: 0, minY: 0, maxX: 2, maxY: 2 });

    expect(
      spatial.queryAabb({ minX: -5, minY: -5, maxX: 15, maxY: 15 }, 0, output),
    ).toBe(1);
    expect(
      output.records.slice(0, output.count).map((record) => record?.id),
    ).toEqual([1]);
    expect(
      spatial.queryCircle({ x: 0, y: 0, radius: 3, elevation: 1 }, output),
    ).toBe(1);
    expect(output.records[0]?.id).toBe(2);
  });

  it("updates and removes records without stale candidates", () => {
    const spatial = new UniformSpatialHash(8);
    const output = new SpatialQueryBuffer();
    spatial.upsert(4, 0, { minX: 0, minY: 0, maxX: 1, maxY: 1 });
    spatial.upsert(4, 0, { minX: 100, minY: 100, maxX: 101, maxY: 101 });
    expect(
      spatial.queryAabb({ minX: -1, minY: -1, maxX: 2, maxY: 2 }, 0, output),
    ).toBe(0);
    expect(spatial.remove(4)).toBe(true);
    expect(spatial.size).toBe(0);
  });

  it("matches brute-force AABB queries across seeded negative coordinates", () => {
    const random = new Mulberry32(0x5eed2008);
    const spatial = new UniformSpatialHash(13);
    const records: { id: number; elevation: number; bounds: Aabb }[] = [];
    for (let id = 0; id < 250; id += 1) {
      const x = random.nextFloat() * 500 - 250;
      const y = random.nextFloat() * 500 - 250;
      const width = random.nextFloat() * 24;
      const height = random.nextFloat() * 24;
      const record = {
        id,
        elevation: id % 3,
        bounds: { minX: x, minY: y, maxX: x + width, maxY: y + height },
      };
      records.push(record);
      spatial.upsert(record.id, record.elevation, record.bounds);
    }
    const output = new SpatialQueryBuffer();
    for (let queryIndex = 0; queryIndex < 100; queryIndex += 1) {
      const x = random.nextFloat() * 500 - 250;
      const y = random.nextFloat() * 500 - 250;
      const query = { minX: x, minY: y, maxX: x + 40, maxY: y + 40 };
      const elevation = queryIndex % 3;
      spatial.queryAabb(query, elevation, output);
      const actual = output.records
        .slice(0, output.count)
        .map((record) => record?.id)
        .filter((id): id is number => id !== undefined);
      const expected = records
        .filter(
          (record) =>
            record.elevation === elevation &&
            aabbsOverlap(record.bounds, query),
        )
        .map(({ id }) => id);
      expect(actual).toEqual(expected);
    }
  });

  it("returns swept-segment candidates only once", () => {
    const spatial = new UniformSpatialHash(4);
    const output = new SpatialQueryBuffer();
    spatial.upsert(1, 0, { minX: 2, minY: 2, maxX: 10, maxY: 10 });
    spatial.upsert(2, 0, { minX: 20, minY: 20, maxX: 21, maxY: 21 });
    expect(
      spatial.querySegment(
        {
          startX: 0,
          startY: 6,
          endX: 12,
          endY: 6,
          padding: 0,
          elevation: 0,
        },
        output,
      ),
    ).toBe(1);
    expect(output.records[0]?.id).toBe(1);
  });

  it("keeps caller buffers and spatial capacities stable after warm-up", () => {
    const spatial = new UniformSpatialHash(16);
    spatial.reserve({ minX: -64, minY: -64, maxX: 64, maxY: 64 }, 16);
    for (let id = 0; id < 12; id += 1) {
      const x = (id % 4) * 8 - 16;
      const y = Math.floor(id / 4) * 8 - 8;
      spatial.upsert(id, 0, {
        minX: x - 2,
        minY: y - 2,
        maxX: x + 2,
        maxY: y + 2,
      });
    }
    const output = new SpatialQueryBuffer(16);
    const recordsIdentity = output.records;
    const circle = { x: 0, y: 0, radius: 64, elevation: 0 };
    const segment = {
      startX: -64,
      startY: 0,
      endX: 64,
      endY: 0,
      padding: 8,
      elevation: 0,
    };
    spatial.queryCircle(circle, output);
    spatial.querySegment(segment, output);
    const warmedHighWater = output.highWaterMark;
    const before = {
      bucketCount: 0,
      bucketCreations: 0,
      bucketCapacityGrowths: 0,
      recordCellCapacityGrowths: 0,
      queryCount: 0,
    };
    const after = { ...before };
    spatial.writeAllocationDiagnostics(before);

    for (let iteration = 0; iteration < 10_000; iteration += 1) {
      circle.x = (iteration % 9) - 4;
      spatial.queryCircle(circle, output);
      segment.startY = (iteration % 7) - 3;
      segment.endY = segment.startY;
      spatial.querySegment(segment, output);
    }
    spatial.writeAllocationDiagnostics(after);

    expect(output.records).toBe(recordsIdentity);
    expect(output.highWaterMark).toBe(warmedHighWater);
    expect(output.overflowCount).toBe(0);
    expect(after.bucketCount).toBe(before.bucketCount);
    expect(after.bucketCreations).toBe(before.bucketCreations);
    expect(after.bucketCapacityGrowths).toBe(before.bucketCapacityGrowths);
    expect(after.recordCellCapacityGrowths).toBe(
      before.recordCellCapacityGrowths,
    );
    expect(after.queryCount - before.queryCount).toBe(20_000);
  });
});

describe("compiled navigation fixture", () => {
  it("compiles the deterministic 128x128 cost/elevation grid", () => {
    const compiled = compileNavigationGrid(
      jsonFixture("technical-navigation.json"),
      "technical-navigation.json",
    );
    expect([compiled.width, compiled.height, compiled.costs.length]).toEqual([
      128, 128, 16_384,
    ]);
    expect(compiled.costs[0]).toBe(1);
    expect(compiled.costs[64]).toBe(0);
    expect(compiled.costs[72 * 128 + 8]).toBe(3);
    expect(compiled.elevations[100 * 128 + 100]).toBe(1);
  });

  it("connects the compiled grid to the P0-006 zone contract without Phaser", () => {
    const zone = compileTiledMap(
      jsonFixture("technical-isometric.json"),
      "technical-isometric.json",
    );
    const navigation = compileNavigationGrid(
      jsonFixture("technical-navigation.json"),
      "technical-navigation.json",
    );
    const grid = navigationGridForZone(zone, navigation);
    expect(grid.isWalkable(127, 127, 0)).toBe(true);
    expect(grid.isWalkable(127, 127, 1)).toBe(false);
  });

  it("rejects authored rectangles that cross grid boundaries", () => {
    const invalid = jsonFixture("technical-navigation.json") as Record<
      string,
      unknown
    >;
    invalid["blocked"] = [{ x: 127, y: 127, width: 2, height: 1, value: 0 }];
    expect(() =>
      compileNavigationGrid(invalid, "invalid-navigation.json"),
    ).toThrow(
      'invalid-navigation.json: "blocked[0]" exceeds the navigation boundary',
    );
  });
});

describe("bounded deterministic A*", () => {
  it("chooses the lower-cost route and includes boundary endpoints", () => {
    const grid = flatGrid(5, 3, [1, 1, 1, 1, 1, 1, 9, 9, 9, 1, 1, 1, 1, 1, 1]);
    const search = new BoundedAStar(grid);
    const path = new PathBuffer();
    const result = createPathResult();
    search.findPath(
      { x: 0, y: 1, elevation: 0 },
      { x: 4, y: 1, elevation: 0 },
      64,
      path,
      result,
    );
    expect(result.status).toBe("complete");
    expect(result.totalCost).toBe(6);
    expect(path.points[0]).toEqual({ x: 0, y: 1, elevation: 0 });
    expect(path.points.at(-1)).toEqual({ x: 4, y: 1, elevation: 0 });
  });

  it("distinguishes no-path, invalid elevation, and budget exhaustion", () => {
    const grid = flatGrid(3, 3, [1, 0, 1, 1, 0, 1, 1, 0, 1]);
    const search = new BoundedAStar(grid);
    const path = new PathBuffer();
    const result = createPathResult();
    search.findPath(
      { x: 0, y: 0, elevation: 0 },
      { x: 2, y: 0, elevation: 0 },
      20,
      path,
      result,
    );
    expect(result.status).toBe("no-path");
    expect(result.expansions).toBeLessThanOrEqual(20);

    search.findPath(
      { x: 0, y: 0, elevation: 0 },
      { x: 0, y: 0, elevation: 1 },
      20,
      path,
      result,
    );
    expect(result.status).toBe("invalid");

    const open = flatGrid(16, 16, new Array<number>(256).fill(1));
    new BoundedAStar(open).findPath(
      { x: 0, y: 0, elevation: 0 },
      { x: 15, y: 15, elevation: 0 },
      2,
      path,
      result,
    );
    expect(result.status).toBe("budget-exhausted");
    expect(result.expansions).toBe(2);
  });

  it("produces valid adjacent paths for seeded boundary pairs", () => {
    const compiled = compileNavigationGrid(
      jsonFixture("technical-navigation.json"),
    );
    const grid = new NavigationGrid(compiled);
    const search = new BoundedAStar(grid);
    const path = new PathBuffer();
    const result = createPathResult();
    const pairs = [
      [0, 0, 127, 0],
      [127, 127, 120, 120],
      [5, 100, 90, 100],
      [10, 10, 60, 70],
    ] as const;
    for (const [startX, startY, goalX, goalY] of pairs) {
      search.findPath(
        { x: startX, y: startY, elevation: 0 },
        { x: goalX, y: goalY, elevation: 0 },
        16_384,
        path,
        result,
      );
      expect(result.status).toBe("complete");
      for (let index = 1; index < path.points.length; index += 1) {
        const prior = path.points[index - 1];
        const current = path.points[index];
        expect(
          Math.abs((prior?.x ?? 0) - (current?.x ?? 0)) +
            Math.abs((prior?.y ?? 0) - (current?.y ?? 0)),
        ).toBe(1);
        expect(grid.isWalkable(current?.x ?? -1, current?.y ?? -1, 0)).toBe(
          true,
        );
      }
    }
  });
});

describe("fair path scheduler and local separation", () => {
  it("processes FIFO requests under explicit work budgets", () => {
    const grid = flatGrid(8, 8, new Array<number>(64).fill(1));
    const completed: number[] = [];
    const scheduler = new FairPathRequestScheduler(
      new BoundedAStar(grid),
      {
        onPathCompleted(request, result) {
          completed.push(request.requesterId);
          expect(result.expansions).toBeLessThanOrEqual(4);
        },
      },
      {
        queueCapacity: 3,
        perRequestExpansionCap: 4,
        maxRequestsPerTick: 2,
        maxExpansionsPerTick: 8,
      },
    );
    const request = (requesterId: number): PathRequest => ({
      requesterId,
      start: { x: 0, y: 0, elevation: 0 },
      goal: { x: 7, y: 7, elevation: 0 },
    });
    expect(scheduler.request(request(1))).toBeUndefined();
    expect(scheduler.request(request(1))).toBe("already-pending");
    expect(scheduler.request(request(2))).toBeUndefined();
    expect(scheduler.request(request(3))).toBeUndefined();
    expect(scheduler.request(request(4))).toBe("queue-full");
    expect(scheduler.processTick()).toMatchObject({
      processedRequests: 2,
      expansions: 8,
      remainingRequests: 1,
    });
    expect(completed).toEqual([1, 2]);
    scheduler.processTick();
    expect(completed).toEqual([1, 2, 3]);
  });

  it("separates only nearby same-elevation records with a capped vector", () => {
    const spatial = new UniformSpatialHash(16);
    const query = new SpatialQueryBuffer();
    const circleQuery = { x: 0, y: 0, radius: 0, elevation: 0 };
    const output = { x: 0, y: 0 };
    spatial.upsert(1, 0, { minX: -1, minY: -1, maxX: 1, maxY: 1 });
    spatial.upsert(2, 0, { minX: 3, minY: -1, maxX: 5, maxY: 1 });
    spatial.upsert(3, 1, { minX: -5, minY: -1, maxX: -3, maxY: 1 });
    expect(
      computeLocalSeparation(
        spatial,
        1,
        { x: 0, y: 0 },
        0,
        10,
        0.25,
        circleQuery,
        query,
        output,
      ),
    ).toBe(1);
    expect(output.x).toBeCloseTo(-0.25);
    expect(output.y).toBe(0);
  });
});

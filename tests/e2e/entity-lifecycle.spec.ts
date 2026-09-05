import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("/?automation=1&fullFixture=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-app-state",
    "ready",
    {
      timeout: 15_000,
    },
  );
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__RARPG_FIXTURE_TEST__?.diagnostics()?.ready ?? false,
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
});

test("runs exact P0-002 populations, queries, paths, culling, and pools", async ({
  page,
}) => {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__RARPG_FIXTURE_TEST__?.diagnostics()?.simulation
            ?.simulationSteps ?? 0,
      ),
    )
    .toBeGreaterThan(5);
  const diagnostics = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.diagnostics(),
  );
  expect(diagnostics).not.toBeNull();
  expect(diagnostics?.atlasCount).toBe(1);
  expect(diagnostics?.textureMemoryEstimateBytes).toBe(163_840);
  expect(diagnostics?.presentationObjects).toBe(1_800);
  expect(diagnostics?.terrainChunks).toBe(320);
  expect(diagnostics?.foregroundCells).toBe(1_639);
  expect((diagnostics?.visible ?? 0) + (diagnostics?.culled ?? 0)).toBe(1_800);
  expect(diagnostics?.listenerCount).toBe(4);
  expect(diagnostics?.pools).toEqual({
    actors: {
      capacity: 200,
      active: 200,
      available: 0,
      highWaterMark: 200,
      acquisitions: 200,
      releases: 0,
      exhaustionAttempts: 0,
      overflowAttempts: 0,
    },
    projectiles: {
      capacity: 500,
      active: 500,
      available: 0,
      highWaterMark: 500,
      acquisitions: 500,
      releases: 0,
      exhaustionAttempts: 0,
      overflowAttempts: 0,
    },
    particles: {
      capacity: 1_000,
      active: 1_000,
      available: 0,
      highWaterMark: 1_000,
      acquisitions: 1_000,
      releases: 0,
      exhaustionAttempts: 0,
      overflowAttempts: 0,
    },
    loot: {
      capacity: 100,
      active: 100,
      available: 0,
      highWaterMark: 100,
      acquisitions: 100,
      releases: 0,
      exhaustionAttempts: 0,
      overflowAttempts: 0,
    },
  });
  expect(diagnostics?.simulation?.populations).toEqual({
    actors: 200,
    projectiles: 500,
    cosmeticParticles: 1_000,
    loot: 100,
    total: 1_800,
  });
  const steps = diagnostics?.simulation?.simulationSteps ?? 0;
  expect(diagnostics?.simulation?.queries.actorRadius).toBe(steps * 200);
  expect(diagnostics?.simulation?.queries.projectileSweeps).toBe(steps * 500);
  expect(diagnostics?.simulation?.paths.requested).toBe(Math.ceil(steps / 3));
  expect(
    diagnostics?.simulation?.projectAllocations.structuralAfterWarmup,
  ).toBe(0);
});

test("releases every owned object and remains flat across lifecycle cycles", async ({
  page,
}) => {
  const heapSamples: number[] = [];
  for (let cycle = 0; cycle < 5; cycle += 1) {
    await page.evaluate(() => window.__RARPG_FIXTURE_TEST__?.dispose());
    const released = await page.evaluate(() =>
      window.__RARPG_FIXTURE_TEST__?.diagnostics(),
    );
    expect(released).toMatchObject({
      ready: false,
      disposed: true,
      atlasCount: 0,
      presentationObjects: 0,
      visible: 0,
      culled: 0,
      terrainChunks: 0,
      listenerCount: 0,
      simulation: null,
    });
    await page.evaluate(() => window.__RARPG_FIXTURE_TEST__?.reset());
    await expect
      .poll(
        () =>
          page.evaluate(
            () => window.__RARPG_FIXTURE_TEST__?.diagnostics()?.ready ?? false,
          ),
        { timeout: 15_000 },
      )
      .toBe(true);
    const restored = await page.evaluate(() =>
      window.__RARPG_FIXTURE_TEST__?.diagnostics(),
    );
    expect(restored).toMatchObject({
      atlasCount: 1,
      presentationObjects: 1_800,
      terrainChunks: 320,
      listenerCount: 4,
    });
    if (restored?.jsHeapBytes !== null && restored?.jsHeapBytes !== undefined) {
      heapSamples.push(restored.jsHeapBytes);
    }
  }
  if (heapSamples.length > 1) {
    expect(Math.max(...heapSamples) - Math.min(...heapSamples)).toBeLessThan(
      64 * 1024 * 1024,
    );
  }
});

test("releases and reacquires one actor without stale ownership", async ({
  page,
}) => {
  for (let cycle = 0; cycle < 20; cycle += 1) {
    const ids = await page.evaluate(() =>
      window.__RARPG_FIXTURE_TEST__?.cycleActor(0),
    );
    expect(ids?.created).not.toBe(ids?.destroyed);
  }
  const diagnostics = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.diagnostics(),
  );
  expect(diagnostics?.presentationObjects).toBe(1_800);
  expect(diagnostics?.listenerCount).toBe(4);
  expect(diagnostics?.pools.actors).toMatchObject({
    capacity: 200,
    active: 200,
    available: 0,
    highWaterMark: 200,
    acquisitions: 220,
    releases: 20,
    exhaustionAttempts: 0,
    overflowAttempts: 0,
  });
  expect(diagnostics?.simulation?.lifecycle).toMatchObject({
    liveEntities: 1_800,
    transformComponents: 1_800,
    presentationComponents: 1_800,
    created: 1_820,
    destroyed: 20,
  });
});

test("samples allocation and frame diagnostics", async ({ page }) => {
  await page.evaluate(() => window.__RARPG_FIXTURE_TEST__?.beginSample());
  await page.waitForTimeout(1_000);
  const summary = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.endSample(),
  );
  const diagnostics = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.diagnostics(),
  );
  expect(summary?.sampleCount).toBeGreaterThan(10);
  expect(summary?.p95FrameIntervalMilliseconds).not.toBeNull();
  expect(summary?.p95MainThreadWorkMilliseconds).not.toBeNull();
  expect(
    diagnostics?.simulation?.projectAllocations.structuralAfterWarmup,
  ).toBe(0);
});

test("invalidates samples across focus and visibility transitions", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__RARPG_FIXTURE_TEST__?.beginSample();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(100);
  const summary = await page.evaluate(() =>
    window.__RARPG_FIXTURE_TEST__?.endSample(),
  );
  expect(summary?.invalidReasons).toEqual(
    expect.arrayContaining(["focus-lost", "visibility-hidden"]),
  );
  expect(summary?.droppedMilliseconds).toBeGreaterThanOrEqual(0);
  expect(summary?.maximumStepsPerCallback).toBeLessThanOrEqual(5);
});

test("matches deterministic full fixture presentation", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Canonical visual baseline uses pinned Chromium.",
  );
  await page.evaluate(() => window.__RARPG_FIXTURE_TEST__?.resetAtStep(120));
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            window.__RARPG_FIXTURE_TEST__?.diagnostics()?.simulation
              ?.simulationSteps ?? -1,
        ),
      { timeout: 5_000 },
    )
    .toBe(120);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(
    page.getByLabel("RARPG Phaser diagnostic canvas"),
  ).toHaveScreenshot(`entity-lifecycle-${testInfo.project.name}.png`, {
    animations: "disabled",
    maxDiffPixels: 1_000,
  });
});

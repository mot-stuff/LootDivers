import { fileURLToPath } from "node:url";

import { expect, test, type Page, type Route } from "@playwright/test";

const zoneFixturePath = fileURLToPath(
  new URL("../../public/zones/technical-isometric.zone.json", import.meta.url),
);

async function launchObservedLoad(
  page: Page,
  label: string,
  url: string,
): Promise<void> {
  await page.evaluate(
    ({ loadLabel, loadUrl }) => {
      const testWindow = window as typeof window & {
        __RARPG_LOAD_RESULTS__?: string[];
      };
      testWindow.__RARPG_LOAD_RESULTS__ ??= [];
      void testWindow.__RARPG_WORLD_TEST__?.load(loadUrl).then(
        () => testWindow.__RARPG_LOAD_RESULTS__?.push(`${loadLabel}:resolved`),
        (error: unknown) =>
          testWindow.__RARPG_LOAD_RESULTS__?.push(
            `${loadLabel}:rejected:${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
      );
    },
    { loadLabel: label, loadUrl: url },
  );
}

async function loadResults(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __RARPG_LOAD_RESULTS__?: string[];
        }
      ).__RARPG_LOAD_RESULTS__ ?? [],
  );
}

async function clickLogicalCanvasPoint(
  page: Page,
  x: number,
  y: number,
): Promise<void> {
  const point = await page
    .getByLabel("RARPG Phaser diagnostic canvas")
    .evaluate(
      (element, logicalPoint) => {
        const canvas = element as HTMLCanvasElement;
        const bounds = canvas.getBoundingClientRect();
        return {
          x: bounds.left + (logicalPoint.x / 960) * bounds.width,
          y: bounds.top + (logicalPoint.y / 540) * bounds.height,
        };
      },
      { x, y },
    );
  await page.mouse.click(point.x, point.y);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/?automation=1", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const diagnostics = window.__RARPG_WORLD_TEST__?.diagnostics();
        return diagnostics === undefined
          ? null
          : {
              zoneId: diagnostics.zoneId,
              objectCount: diagnostics.objectCount,
              chunkCount: diagnostics.chunkCount,
              assetCount: diagnostics.assetCount,
              listenerCount: diagnostics.listenerCount,
            };
      }),
    )
    .toEqual({
      zoneId: "fixture:technical-isometric",
      objectCount: 27,
      chunkCount: 20,
      assetCount: 1,
      listenerCount: 1,
    });
});

test("loads, picks, unloads, releases, and reloads the technical zone", async ({
  page,
}) => {
  const initial = await page.evaluate(() =>
    window.__RARPG_WORLD_TEST__?.diagnostics(),
  );
  expect(initial).toEqual({
    zoneId: "fixture:technical-isometric",
    objectCount: 27,
    chunkCount: 20,
    assetCount: 1,
    listenerCount: 1,
    pickedCell: null,
  });

  await page.evaluate(() => {
    window.__RARPG_WORLD_TEST__?.pick(480, 108);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_WORLD_TEST__?.diagnostics().pickedCell,
      ),
    )
    .toBe("0,0,e0");

  await page.evaluate(() => {
    window.__RARPG_WORLD_TEST__?.pick(512, 172);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_WORLD_TEST__?.diagnostics().pickedCell,
      ),
    )
    .toBe("3,2,e1");

  await page.evaluate(() => {
    window.__RARPG_WORLD_TEST__?.unload();
  });
  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual({
    zoneId: null,
    objectCount: 0,
    chunkCount: 0,
    assetCount: 0,
    listenerCount: 0,
    pickedCell: null,
  });

  await page.evaluate(async () => {
    await window.__RARPG_WORLD_TEST__?.load();
  });
  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual(initial);
});

test("serializes concurrent loads and keeps one committed resource set", async ({
  page,
}) => {
  let resolveFirst!: (route: Route) => void;
  let resolveSecond!: (route: Route) => void;
  const firstRequest = new Promise<Route>((resolve) => {
    resolveFirst = resolve;
  });
  const secondRequest = new Promise<Route>((resolve) => {
    resolveSecond = resolve;
  });
  await page.route("**/zones/lifecycle-first.json", resolveFirst);
  await page.route("**/zones/lifecycle-second.json", resolveSecond);

  await launchObservedLoad(page, "first", "/zones/lifecycle-first.json");
  await firstRequest;
  await launchObservedLoad(page, "second", "/zones/lifecycle-second.json");
  const latestRoute = await secondRequest;
  await latestRoute.fulfill({
    contentType: "application/json",
    path: zoneFixturePath,
  });

  await expect
    .poll(() => loadResults(page))
    .toEqual(["first:resolved", "second:resolved"]);
  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual({
    zoneId: "fixture:technical-isometric",
    objectCount: 27,
    chunkCount: 20,
    assetCount: 1,
    listenerCount: 1,
    pickedCell: null,
  });
});

test("cancels load on unload, ignores physical clicks, recovers from failure", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  let resolvePending!: (route: Route) => void;
  const pendingRequest = new Promise<Route>((resolve) => {
    resolvePending = resolve;
  });
  await page.route("**/zones/lifecycle-pending.json", resolvePending);
  await launchObservedLoad(page, "pending", "/zones/lifecycle-pending.json");
  await pendingRequest;
  await page.evaluate(() => window.__RARPG_WORLD_TEST__?.unload());
  await expect.poll(() => loadResults(page)).toContain("pending:resolved");

  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual({
    zoneId: null,
    objectCount: 0,
    chunkCount: 0,
    assetCount: 0,
    listenerCount: 0,
    pickedCell: null,
  });
  await clickLogicalCanvasPoint(page, 480, 108);
  expect(pageErrors).toEqual([]);

  await page.route("**/zones/lifecycle-failure.json", async (route) => {
    await route.fulfill({
      body: "temporary failure",
      contentType: "text/plain",
      status: 503,
    });
  });
  await launchObservedLoad(page, "failure", "/zones/lifecycle-failure.json");
  await expect
    .poll(() => loadResults(page))
    .toContain(
      'failure:rejected:Technical zone "/zones/lifecycle-failure.json" failed to load: request returned HTTP 503',
    );
  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual({
    zoneId: null,
    objectCount: 0,
    chunkCount: 0,
    assetCount: 0,
    listenerCount: 0,
    pickedCell: null,
  });

  await page.evaluate(() => window.__RARPG_WORLD_TEST__?.load());
  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual({
    zoneId: "fixture:technical-isometric",
    objectCount: 27,
    chunkCount: 20,
    assetCount: 1,
    listenerCount: 1,
    pickedCell: null,
  });
});

for (const pointerCase of [
  {
    name: "expanded DPR 1",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    expectedDisplay: "expanded",
  },
  {
    name: "compact DPR 2",
    viewport: { width: 700, height: 760 },
    deviceScaleFactor: 2,
    expectedDisplay: "compact",
  },
] as const) {
  test.describe(`physical canvas picking at ${pointerCase.name}`, () => {
    test.use({
      viewport: pointerCase.viewport,
      deviceScaleFactor: pointerCase.deviceScaleFactor,
    });

    test("normalizes ground and elevated cells", async ({ page }) => {
      const dimensions = await page
        .getByLabel("RARPG Phaser diagnostic canvas")
        .evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          return {
            backingWidth: canvas.width,
            backingHeight: canvas.height,
            displayWidth: canvas.getBoundingClientRect().width,
            displayHeight: canvas.getBoundingClientRect().height,
            dpr: window.devicePixelRatio,
          };
        });
      expect(dimensions.backingWidth).toBe(
        Math.round(dimensions.displayWidth * dimensions.dpr),
      );
      expect(dimensions.backingHeight).toBe(
        Math.round(dimensions.displayHeight * dimensions.dpr),
      );
      expect(dimensions.dpr).toBe(pointerCase.deviceScaleFactor);
      if (pointerCase.expectedDisplay === "expanded") {
        expect(dimensions.displayWidth).toBeGreaterThan(960);
      } else {
        expect(dimensions.displayWidth).toBeLessThan(960);
      }

      await clickLogicalCanvasPoint(page, 480, 108);
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__RARPG_WORLD_TEST__?.diagnostics().pickedCell,
          ),
        )
        .toBe("0,0,e0");

      await clickLogicalCanvasPoint(page, 512, 172);
      await expect
        .poll(() =>
          page.evaluate(
            () => window.__RARPG_WORLD_TEST__?.diagnostics().pickedCell,
          ),
        )
        .toBe("3,2,e1");
    });
  });
}

test("matches deterministic projection, depth, elevation, and occlusion", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Canonical visual baseline uses pinned Chromium.",
  );
  await expect(
    page.getByLabel("RARPG Phaser diagnostic canvas"),
  ).toHaveScreenshot(`technical-isometric-${testInfo.project.name}.png`, {
    animations: "disabled",
  });
});

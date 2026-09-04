import { expect, test, type Page } from "@playwright/test";

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
            };
      }),
    )
    .toEqual({
      zoneId: "fixture:technical-isometric",
      objectCount: 27,
      chunkCount: 20,
      assetCount: 1,
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
    pickedCell: null,
  });

  await page.evaluate(async () => {
    await window.__RARPG_WORLD_TEST__?.load();
  });
  expect(
    await page.evaluate(() => window.__RARPG_WORLD_TEST__?.diagnostics()),
  ).toEqual(initial);
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
            dpr: window.devicePixelRatio,
          };
        });
      expect(dimensions.backingWidth).toBe(960);
      expect(dimensions.backingHeight).toBe(540);
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

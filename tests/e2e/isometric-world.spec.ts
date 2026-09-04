import { expect, test } from "@playwright/test";

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

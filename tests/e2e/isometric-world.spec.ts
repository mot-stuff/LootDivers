import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?automation=1", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
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

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error("Technical fixture canvas has no bounding box.");
  }
  await page.mouse.click(
    box.x + (480 / 960) * box.width,
    box.y + (172 / 540) * box.height,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_WORLD_TEST__?.diagnostics().pickedCell,
      ),
    )
    .toBe("2,2,e0");

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

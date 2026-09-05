import { expect, test, type Page } from "@playwright/test";

import { ASHTRAIL_EXPANSE_ID, HEARTHMERE_ID } from "../../src/core";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

test("the playable session starts in Hearthmere and can travel to Ashtrail", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect(page.getByTestId("combat-minimap")).toBeVisible();
  await expect(page.getByTestId("combat-minimap-bounds")).toBeVisible();
  await expect(page.locator(".combat-minimap-floor")).toHaveCSS(
    "fill",
    "rgb(42, 33, 24)",
  );
  await expect(page.getByTestId("combat-minimap-bounds")).toHaveCSS(
    "stroke",
    "rgb(232, 184, 109)",
  );
  await expect(
    page.locator('[data-testid="combat-minimap"] [data-kind="vendor"]'),
  ).toHaveCount(1);

  await page.evaluate((zoneId) => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.travelTo(zoneId);
  }, ASHTRAIL_EXPANSE_ID);

  await expect(page.getByTestId("combat-zone")).toContainText(
    "Ashtrail Expanse",
  );
  await expect(page.locator(".combat-minimap-floor")).toHaveCSS(
    "fill",
    "rgb(16, 38, 58)",
  );
  await expect(page.getByTestId("combat-minimap-bounds")).toHaveCSS(
    "stroke",
    "rgb(100, 216, 203)",
  );
  await expect(
    page.locator('[data-testid="combat-minimap"] [data-kind="enemy"]'),
  ).toHaveCount(4);
  await expect(
    page.locator('[data-testid="combat-minimap"] [data-rank="elite"]'),
  ).toHaveCount(1);

  await page.evaluate((zoneId) => {
    window.__RARPG_COMBAT_TEST__?.travelTo(zoneId);
  }, HEARTHMERE_ID);

  const vendor = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return false;
    for (let index = 0; index < 400; index += 1) {
      const state = combat.diagnostics();
      const stall = state?.interactables.find(
        (interactable) => interactable.kind === "vendor",
      );
      if (state === null || stall === undefined) return false;
      const deltaX = stall.x - state.x;
      const deltaY = stall.y - state.y;
      if (Math.hypot(deltaX, deltaY) <= 36) {
        combat.setMovement(0, 0);
        break;
      }
      combat.setMovement(deltaX, deltaY);
      combat.advancePaused(1);
    }
    combat.setMovement(0, 0);
    combat.requestInteract();
    return true;
  });
  expect(vendor).toBe(true);
  await expect(page.getByTestId("vendor-menu")).toBeVisible();
  await expect(page.getByTestId("vendor-menu")).toContainText(
    "Trailguard Vest",
  );

  expect(failures, failures.join("\n")).toEqual([]);
});

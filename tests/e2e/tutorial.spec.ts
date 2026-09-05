import { expect, test, type Page } from "@playwright/test";

import { WAKESHORE_LANDING_ID } from "../../src/core";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

test("the tutorial guides move, attack, dodge, loot, gather, and travel in order", async ({
  page,
}, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect(page.getByTestId("combat-tutorial")).toHaveCount(0);

  await page.evaluate((zoneId) => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.travelTo(zoneId);
  }, WAKESHORE_LANDING_ID);

  const tutorial = page.getByTestId("combat-tutorial");
  const prompt = page.getByTestId("combat-tutorial-prompt");
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Wakeshore Landing",
  );
  await expect(tutorial).toBeVisible();
  await expect(tutorial).toHaveAttribute("data-step-id", "move");
  await expect(tutorial).toContainText("Step 1 of 6");
  await expect(prompt).toHaveText("Move with W, A, S, and D.");
  await page.screenshot({
    path: `test-results/tutorial/tutorial-prompt-${testInfo.project.name}.png`,
  });

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return;
    combat.setMovement(1, 0);
    combat.advancePaused(1);
    combat.setMovement(0, 0);
  });
  await expect(tutorial).toHaveAttribute("data-step-id", "attack");
  await expect(prompt).toHaveText(
    "Slay the Wakeshore Scuttler with Left Click.",
  );

  const killed = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return false;
    for (let index = 0; index < 2_400; index += 1) {
      const state = combat.diagnostics();
      if (state === null) return false;
      const scuttler = state.enemies.find(
        (enemy) => enemy.id === "enemy:wakeshore-scuttler",
      );
      if (scuttler === undefined) return false;
      if (scuttler.dead) {
        combat.setMovement(0, 0);
        return state.worldLoot.length > 0;
      }
      const deltaX = scuttler.x - state.x;
      const deltaY = scuttler.y - state.y;
      if (Math.hypot(deltaX, deltaY) > 44) {
        combat.setMovement(deltaX, deltaY);
      } else {
        combat.setMovement(0, 0);
        combat.requestAbilitySlot("lmb", scuttler.x, scuttler.y);
      }
      combat.advancePaused(1);
    }
    return false;
  });
  expect(killed, "the Wakeshore Scuttler must die and drop loot").toBe(true);
  await expect(tutorial).toHaveAttribute("data-step-id", "dodge");
  await expect(prompt).toHaveText("Dodge roll with Space.");

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return;
    combat.requestDodge();
    combat.advancePaused(2);
  });
  await expect(tutorial).toHaveAttribute("data-step-id", "loot");

  const looted = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return false;
    combat.advancePaused(60);
    for (let index = 0; index < 600; index += 1) {
      const state = combat.diagnostics();
      const drop = state?.worldLoot[0];
      if (state === null || drop === undefined) return false;
      const deltaX = drop.x - state.x;
      const deltaY = drop.y - state.y;
      if (Math.hypot(deltaX, deltaY) <= 30) {
        combat.setMovement(0, 0);
        combat.requestInteract();
        return true;
      }
      combat.setMovement(deltaX, deltaY);
      combat.advancePaused(1);
    }
    return false;
  });
  expect(looted, "the dropped loot must be picked up with F").toBe(true);
  await expect(tutorial).toHaveAttribute("data-step-id", "gather");

  const gathered = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return false;
    for (let index = 0; index < 600; index += 1) {
      const state = combat.diagnostics();
      const node = state?.interactables.find(
        (interactable) => interactable.kind === "ore-node",
      );
      if (state === null || node === undefined) return false;
      const deltaX = node.x - state.x;
      const deltaY = node.y - state.y;
      if (Math.hypot(deltaX, deltaY) <= 36) {
        combat.setMovement(0, 0);
        combat.requestInteract();
        combat.advancePaused(90);
        return true;
      }
      combat.setMovement(deltaX, deltaY);
      combat.advancePaused(1);
    }
    return false;
  });
  expect(gathered, "one ore gather must complete").toBe(true);
  await expect(tutorial).toHaveAttribute("data-step-id", "travel");

  const traveled = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return false;
    for (let index = 0; index < 600; index += 1) {
      const state = combat.diagnostics();
      const portal = state?.interactables.find(
        (interactable) => interactable.kind === "portal",
      );
      if (state === null || portal === undefined) return false;
      const deltaX = portal.x - state.x;
      const deltaY = portal.y - state.y;
      if (Math.hypot(deltaX, deltaY) <= 36) {
        combat.setMovement(0, 0);
        combat.requestInteract();
        return true;
      }
      combat.setMovement(deltaX, deltaY);
      combat.advancePaused(1);
    }
    return false;
  });
  expect(traveled, "the exit portal must be used").toBe(true);

  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect(page.getByTestId("combat-tutorial")).toHaveCount(0);
  const finished = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tutorial ?? null,
  );
  expect(finished?.completed).toBe(true);
  expect(finished?.stepsCompleted).toBe(6);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("the exit portal skips the tutorial at any step and re-entry resumes it", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");

  await page.evaluate((zoneId) => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.travelTo(zoneId);
  }, WAKESHORE_LANDING_ID);
  await expect(page.getByTestId("combat-tutorial")).toBeVisible();

  const skipped = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return false;
    for (let index = 0; index < 600; index += 1) {
      const state = combat.diagnostics();
      const portal = state?.interactables.find(
        (interactable) => interactable.kind === "portal",
      );
      if (state === null || portal === undefined) return false;
      const deltaX = portal.x - state.x;
      const deltaY = portal.y - state.y;
      if (Math.hypot(deltaX, deltaY) <= 36) {
        combat.setMovement(0, 0);
        combat.requestInteract();
        return true;
      }
      combat.setMovement(deltaX, deltaY);
      combat.advancePaused(1);
    }
    return false;
  });
  expect(skipped, "the exit portal must always work").toBe(true);

  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect(page.getByTestId("combat-tutorial")).toHaveCount(0);
  const afterSkip = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tutorial ?? null,
  );
  expect(afterSkip?.completed).toBe(false);

  await page.evaluate((zoneId) => {
    window.__RARPG_COMBAT_TEST__?.travelTo(zoneId);
  }, WAKESHORE_LANDING_ID);
  await expect(page.getByTestId("combat-tutorial")).toBeVisible();
  await expect(page.getByTestId("combat-tutorial")).toHaveAttribute(
    "data-step-id",
    "attack",
  );

  expect(failures, failures.join("\n")).toEqual([]);
});

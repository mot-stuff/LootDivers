import { expect, test, type Page } from "@playwright/test";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

test("a plain load shows the main menu and New Game lands in the tutorial", async ({
  page,
}, testInfo) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page).toHaveTitle("Loot Divers");

  const menu = page.getByTestId("main-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByAltText("Loot Divers")).toBeVisible();
  const newGame = page.getByTestId("main-menu-new-game");
  const continueButton = page.getByTestId("main-menu-continue");
  await expect(newGame).toBeEnabled();
  await expect(continueButton).toBeVisible();
  await expect(continueButton).toBeDisabled();
  await expect(menu).toContainText("No saved hero yet");
  await expect(page.getByTestId("main-menu-build")).toContainText("build");

  // The simulation stays paused and uninteractable behind the menu: the
  // canvas is unfocused and the loop is not running.
  await expect
    .poll(() => page.evaluate(() => window.__RARPG_COMBAT_TEST__ !== undefined))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.pausedForUi ?? null,
      ),
    )
    .toBe(true);
  const tickBefore = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tick ?? null,
  );
  await page.screenshot({
    path: `test-results/menu/main-menu-${testInfo.project.name}.png`,
  });

  await newGame.click();

  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Wakeshore Landing",
  );
  const tutorial = page.getByTestId("combat-tutorial");
  await expect(tutorial).toBeVisible();
  await expect(tutorial).toHaveAttribute("data-step-id", "move");
  await expect(page.getByTestId("combat-tutorial-prompt")).toHaveText(
    "Move with W, A, S, and D.",
  );

  // Input is live: the canvas has focus and the simulation is stepping.
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.pausedForUi ?? null,
      ),
    )
    .toBe(false);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tick ?? null,
      ),
    )
    .toBeGreaterThan(tickBefore ?? 0);
  await page.screenshot({
    path: `test-results/menu/new-game-tutorial-${testInfo.project.name}.png`,
  });

  expect(failures, failures.join("\n")).toEqual([]);
});

test("?autostart bypasses the menu and boots straight into gameplay", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");

  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");

  // The automation hook drives the game exactly as before the menu shipped.
  const paused = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return null;
    combat.setAutomationPaused(true);
    const before = combat.diagnostics()?.tick ?? null;
    combat.advancePaused(3);
    const after = combat.diagnostics()?.tick ?? null;
    combat.setAutomationPaused(false);
    return before !== null && after !== null ? after - before : null;
  });
  expect(paused).toBe(3);

  expect(failures, failures.join("\n")).toEqual([]);
});

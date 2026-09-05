import { expect, test, type Page } from "@playwright/test";

// GitHub-hosted CI runners have no GPU; the kill/loot portion of this flow
// is timing-sensitive under software rendering. Covered by the local
// four-browser gate (DEC-033).
const RUNNING_IN_CI = process.env["CI"] !== undefined;

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

async function combatReady(page: Page): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(() => window.__RARPG_COMBAT_TEST__?.diagnostics() ?? null),
    )
    .not.toBeNull();
}

function generationCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const hook = window.__RARPG_CHARACTER_SAVE_TEST__;
    if (hook === undefined) return -1;
    try {
      const state = await hook.generationState();
      return state.generations.length;
    } catch {
      return 0;
    }
  });
}

test("zone travel autosaves and Continue restores the character after reload", async ({
  page,
}, testInfo) => {
  test.skip(
    RUNNING_IN_CI && testInfo.project.name === "webkit",
    "hardware-sensitive on GPU-less CI (DEC-033)",
  );
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Play: a deterministic arena kill grants experience and drops loot,
  // which we pick up so the save carries a non-empty inventory.
  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) throw new Error("Combat hook unavailable.");
    combat.setAutomationPaused(true);
    combat.reset();
    combat.advancePaused(76);
    combat.setAimDirection(1, 0);
    combat.requestAbilitySlot("lmb");
    combat.advancePaused(15);
    combat.requestAbilitySlot("lmb");
    combat.advancePaused(15);
    combat.setMovement(1, 0);
    combat.advancePaused(10);
    combat.setMovement(0, 0);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if ((combat.diagnostics()?.worldLoot.length ?? 0) === 0) break;
      combat.requestInteract();
      combat.advancePaused(3);
    }
  });
  const played = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    const diagnostics = combat?.diagnostics();
    const items = combat?.itemHud();
    if (!diagnostics || !items) return null;
    return {
      experience: diagnostics.experience,
      level: diagnostics.level,
      kills: diagnostics.enemyKillCount,
      inventoryCount: items.inventorySlots.filter((slot) => slot.item !== null)
        .length,
      remainingLoot: diagnostics.worldLoot.length,
    };
  });
  expect(played).not.toBeNull();
  expect(played!.kills).toBe(1);
  expect(played!.experience).toBeGreaterThan(0);
  expect(played!.inventoryCount).toBeGreaterThan(0);
  expect(played!.remainingLoot).toBe(0);

  // Travel: the zone change is the autosave trigger (DEC-034). Two zone
  // changes have happened by now (the automation reset re-entered Ashtrail,
  // then this travel reaches Hollowdeep), so wait until both save
  // generations landed — writes are serialized, which makes the Hollowdeep
  // save the active generation.
  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.travelTo("zone:hollowdeep");
    combat?.setAutomationPaused(false);
  });
  await expect(page.getByTestId("combat-zone")).toContainText("Hollowdeep");
  await expect
    .poll(() => generationCount(page), {
      message: "zone travel should persist a new save generation",
    })
    .toBe(2);

  // Reload without ?autostart: a real player boot with an existing save.
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  const continueButton = page.getByTestId("main-menu-continue");
  await expect(continueButton).toBeEnabled();
  await expect(page.getByTestId("main-menu-continue-note")).toHaveText(
    "Resume your saved hero",
  );

  await continueButton.click();
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hollowdeep");

  // The restored character matches the saved one: progression, inventory,
  // and refilled vitals; the simulation is live again.
  const restored = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    const diagnostics = combat?.diagnostics();
    const items = combat?.itemHud();
    if (!diagnostics || !items) return null;
    return {
      experience: diagnostics.experience,
      level: diagnostics.level,
      zoneId: diagnostics.zoneId,
      inventoryCount: items.inventorySlots.filter((slot) => slot.item !== null)
        .length,
      healthFull: diagnostics.playerHealth === diagnostics.playerMaxHealth,
    };
  });
  expect(restored).toEqual({
    experience: played!.experience,
    level: played!.level,
    zoneId: "zone:hollowdeep",
    inventoryCount: played!.inventoryCount,
    healthFull: true,
  });
  // Input hand-off (canvas focus) can land a frame later; poll like the
  // main-menu spec does, then confirm the simulation is stepping.
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
    .toBeGreaterThan(0);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("a corrupted save is treated as absent and never crashes boot", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // One travel writes the only save generation.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.travelTo("zone:hollowdeep");
  });
  await expect(page.getByTestId("combat-zone")).toContainText("Hollowdeep");
  await expect
    .poll(() => generationCount(page), {
      message: "zone travel should persist a save generation",
    })
    .toBe(1);

  // Kill the player so the pagehide safeguard cannot write a fresh valid
  // save during navigation, then corrupt the only stored generation.
  await page.evaluate(async () => {
    window.__RARPG_COMBAT_TEST__?.applyPlayerDamage(1_000_000);
    await window.__RARPG_CHARACTER_SAVE_TEST__?.corruptActive();
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("main-menu")).toBeVisible();
  await expect(page.getByTestId("main-menu-new-game")).toBeEnabled();
  await expect(page.getByTestId("main-menu-continue")).toBeDisabled();
  await expect(page.getByTestId("main-menu-continue-note")).toHaveText(
    "No saved hero yet",
  );

  expect(failures, failures.join("\n")).toEqual([]);
});

import { expect, test, type Page } from "@playwright/test";

// No DEC-033 CI skip: every simulation interaction here is paused-stepped
// through the automation hooks and save settlement is polled through
// `activeSave`, so nothing samples wall-clock or GPU-dependent state.

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

/** See character-save.spec.ts: polls the committed, checksum-verified save. */
function activeSaveZone(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const hook = window.__RARPG_CHARACTER_SAVE_TEST__;
    if (hook === undefined) return null;
    const save = await hook.activeSave();
    return save?.zoneId ?? null;
  });
}

test("kills drop gold piles that walk-over collects and the save restores", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Deterministic paused kill (same recipe as the loot-loop spec): the
  // Ashtrail Gnasher closes to meleeRange (54 world units) and dies there —
  // outside the 40-unit walk-over radius, so the pile visibly persists.
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
  });

  const dropped = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    const diagnostics = combat?.diagnostics();
    const items = combat?.itemHud();
    if (!diagnostics || !items) return null;
    return {
      kills: diagnostics.enemyKillCount,
      goldPiles: diagnostics.goldPiles,
      renderedGoldPiles: diagnostics.renderedGoldPiles,
      walletGold: items.gold,
    };
  });
  expect(dropped).not.toBeNull();
  expect(dropped!.kills).toBe(1);
  // Exactly one pile per kill (memo §2.1), normal-rank amount, not yet
  // collected, rendered with the integer amount as its label.
  expect(dropped!.goldPiles).toHaveLength(1);
  const pile = dropped!.goldPiles[0]!;
  expect(pile.amount).toBeGreaterThanOrEqual(3);
  expect(pile.amount).toBeLessThanOrEqual(7);
  expect(dropped!.walletGold).toBe(0);
  expect(dropped!.renderedGoldPiles).toEqual([
    expect.objectContaining({
      pileId: pile.pileId,
      amount: pile.amount,
      labelText: String(pile.amount),
    }),
  ]);

  // Walk over the pile: no F key, no interaction — the counter increments
  // and the pile (marker + label) leaves the arena.
  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setMovement(1, 0);
    combat?.advancePaused(30);
    combat?.setMovement(0, 0);
  });
  const collected = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    const diagnostics = combat?.diagnostics();
    const items = combat?.itemHud();
    if (!diagnostics || !items) return null;
    return {
      goldPiles: diagnostics.goldPiles.length,
      renderedGoldPiles: diagnostics.renderedGoldPiles.length,
      walletGold: items.gold,
    };
  });
  expect(collected).toEqual({
    goldPiles: 0,
    renderedGoldPiles: 0,
    walletGold: pile.amount,
  });

  // The inventory panel shows the gold line (memo §2.5).
  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.keyboard.press("i");
  await expect(page.getByTestId("inventory-menu")).toBeVisible();
  await expect(page.getByTestId("gold-amount")).toHaveText(String(pile.amount));
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inventory-menu")).toHaveCount(0);

  // Travel is the autosave trigger (DEC-034); wait for the committed save
  // to read back before navigating so the reload can never race the write.
  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.travelTo("zone:hollowdeep");
    combat?.setAutomationPaused(false);
  });
  await expect(page.getByTestId("combat-zone")).toContainText("Hollowdeep");
  await expect
    .poll(() => activeSaveZone(page), {
      message: "zone travel should persist the Hollowdeep save",
    })
    .toBe("zone:hollowdeep");

  // Real-player reload: Continue restores the character with gold intact.
  await page.goto("/play/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  const continueButton = page.getByTestId("main-menu-continue");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hollowdeep");

  await expect
    .poll(() =>
      page.evaluate(() => window.__RARPG_COMBAT_TEST__?.itemHud()?.gold),
    )
    .toBe(pile.amount);
  await page.keyboard.press("i");
  await expect(page.getByTestId("gold-amount")).toHaveText(String(pile.amount));

  expect(failures, failures.join("\n")).toEqual([]);
});

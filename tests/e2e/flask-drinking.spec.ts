import { expect, test, type Page } from "@playwright/test";

/**
 * TASK-711 flask drinking (DEC-038). Both specs are DEC-033-proof by
 * design: the first advances a paused simulation tick by tick and asserts
 * exact restore math; the second drives the real key binding but only
 * polls stable endpoints (charge counts and the fully-restored vitals),
 * never sampling mid-window values in real time.
 */

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

function flaskState(page: Page, index: number) {
  return page.evaluate((slotIndex) => {
    const state = window.__RARPG_COMBAT_TEST__?.diagnostics();
    const flask = state?.flasks[slotIndex];
    return flask === undefined
      ? null
      : {
          chargesCurrent: flask.chargesCurrent,
          chargesMaximum: flask.chargesMaximum,
          displayName: flask.displayName,
        };
  }, index);
}

function playerHealth(page: Page): Promise<number | null> {
  return page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.playerHealth ?? null,
  );
}

test("drinking restores health over the exact tick window (paused, deterministic)", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Freeze the simulation, equip a deterministic Heartwell (base recovery
  // 70 over 300 ticks; Deep Reserve raises max charges to 34), and wound
  // the player.
  const drink = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (combat === undefined) return null;
    combat.setAutomationPaused(true);
    if (!combat.grantFlask(1, "life")) return null;
    combat.applyPlayerDamage(60);
    return combat.useFlask(1);
  });
  expect(drink).toMatchObject({
    accepted: true,
    resource: "health",
    instantApplied: 0,
    overTimeAmount: 70,
    durationTicks: 300,
    chargesSpent: 20,
  });
  expect(await flaskState(page, 0)).toEqual({
    chargesCurrent: 14,
    chargesMaximum: 34,
    displayName: "Heartwell Flask",
  });
  expect(await playerHealth(page)).toBe(40);

  // Cumulative rounding restores exactly half at the halfway tick.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.advancePaused(150);
  });
  expect(await playerHealth(page)).toBe(75);

  // The rest of the window clamps at maximum health (overflow is lost).
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.advancePaused(150);
  });
  expect(await playerHealth(page)).toBe(100);

  // The HUD flask row mirrors the core charge state.
  const slot = page
    .getByTestId("combat-flask-slots")
    .locator(".combat-flask-slot")
    .first();
  await expect(slot).toHaveAttribute("data-charges", "14");
  await expect(slot).toContainText("14/34");
  await expect(slot).toHaveAttribute(
    "aria-label",
    "Flask slot 1, Heartwell Flask, 14 of 34 charges, out of charges",
  );

  expect(failures, failures.join("\n")).toEqual([]);
});

test("key 1 drinks the equipped flask and rejections surface HUD feedback", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.grantFlask(1, "life");
    combat?.applyPlayerDamage(50);
  });
  expect(await playerHealth(page)).toBe(50);

  // While the canvas is unfocused (menus/text entry), key 1 is inert.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press("1");
  expect(await flaskState(page, 0)).toMatchObject({ chargesCurrent: 34 });

  // Focused gameplay: key 1 spends charges and starts the restore.
  await page.evaluate(() => {
    document.querySelector("canvas")?.focus();
  });
  await page.keyboard.press("1");
  await expect
    .poll(() => flaskState(page, 0), {
      message: "key 1 should spend the drink's charges",
    })
    .toMatchObject({ chargesCurrent: 14 });

  // Stable endpoint: the restore-over-time eventually fills health; no
  // mid-window sampling (DEC-033).
  await expect.poll(() => playerHealth(page), { timeout: 15_000 }).toBe(100);

  // A second drink cannot afford the 20-charge cost: rejection feedback
  // appears and spends nothing.
  await page.keyboard.press("1");
  const feedback = page.getByTestId("combat-flask-feedback");
  await expect(feedback).toHaveText("Not enough flask charges");
  await expect(feedback).toHaveAttribute("data-reason", "insufficient-charges");
  expect(await flaskState(page, 0)).toMatchObject({ chargesCurrent: 14 });

  expect(failures, failures.join("\n")).toEqual([]);
});

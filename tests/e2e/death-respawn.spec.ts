import { expect, test, type Page } from "@playwright/test";

import {
  ASHTRAIL_EXPANSE_ID,
  HEARTHMERE_ID,
  HOLLOWDEEP_ID,
  WAKESHORE_LANDING_ID,
} from "../../src/core";

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

/** Kills the player deterministically through the automation hook. */
async function killPlayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.applyPlayerDamage(1_000_000);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.playerDead ?? null,
      ),
    )
    .toBe(true);
}

/** Committed, checksum-verified active save zone (see character-save.spec). */
function activeSaveZone(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const hook = window.__RARPG_CHARACTER_SAVE_TEST__;
    if (hook === undefined) return null;
    const save = await hook.activeSave();
    return save?.zoneId ?? null;
  });
}

test("dying shows the death screen and confirming respawns in Hearthmere with vitals full", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Fight from Ashtrail so the respawn is an observable zone change.
  await page.evaluate((zoneId) => {
    window.__RARPG_COMBAT_TEST__?.travelTo(zoneId);
  }, ASHTRAIL_EXPANSE_ID);
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Ashtrail Expanse",
  );

  await expect(page.getByTestId("death-overlay")).toHaveCount(0);
  await killPlayer(page);

  // The death screen appears with the original copy and the respawn
  // destination, and it replaces the paused HUD rather than stacking on it.
  const overlay = page.getByTestId("death-overlay");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("You have fallen");
  await expect(page.locator(".combat-paused-hud")).toHaveCount(0);
  const respawnButton = page.getByTestId("death-respawn");
  await expect(respawnButton).toHaveText("Respawn in Hearthmere");

  await respawnButton.click();
  await expect(overlay).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  const respawned = await page.evaluate(() => {
    const state = window.__RARPG_COMBAT_TEST__?.diagnostics();
    return state === null || state === undefined
      ? null
      : {
          zoneId: state.zoneId,
          playerDead: state.playerDead,
          vitalsFull:
            state.playerHealth === state.playerMaxHealth && state.mana === 100,
        };
  });
  expect(respawned).toEqual({
    zoneId: HEARTHMERE_ID,
    playerDead: false,
    vitalsFull: true,
  });

  // The respawned session is live: the simulation keeps ticking.
  const tickAfterRespawn = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tick ?? null,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tick ?? null,
      ),
    )
    .toBeGreaterThan(tickAfterRespawn ?? 0);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("a tutorial death respawns in Wakeshore Landing with banked steps intact", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Enter the tutorial and bank the "move" step deterministically.
  await page.evaluate((zoneId) => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.travelTo(zoneId);
    combat?.setMovement(1, 0);
    combat?.advancePaused(1);
    combat?.setMovement(0, 0);
    combat?.setAutomationPaused(false);
  }, WAKESHORE_LANDING_ID);
  const tutorial = page.getByTestId("combat-tutorial");
  await expect(tutorial).toHaveAttribute("data-step-id", "attack");

  await killPlayer(page);
  // Tutorial deaths must not eject to Hearthmere (DEC-030/DEC-037): the
  // screen offers the tutorial zone itself.
  const respawnButton = page.getByTestId("death-respawn");
  await expect(respawnButton).toHaveText("Respawn in Wakeshore Landing");

  await respawnButton.click();
  await expect(page.getByTestId("death-overlay")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Wakeshore Landing",
  );
  // Banked progress survived the death: the prompt resumes at "attack",
  // and zone entry rebuilt the scuttler for the retry.
  await expect(tutorial).toHaveAttribute("data-step-id", "attack");
  const world = await page.evaluate(() => {
    const state = window.__RARPG_COMBAT_TEST__?.diagnostics();
    const scuttler = state?.enemies.find(
      (enemy) => enemy.id === "enemy:wakeshore-scuttler",
    );
    return state === null || state === undefined
      ? null
      : {
          zoneId: state.zoneId,
          playerDead: state.playerDead,
          healthFull: state.playerHealth === state.playerMaxHealth,
          scuttlerAlive: scuttler !== undefined && !scuttler.dead,
        };
  });
  expect(world).toEqual({
    zoneId: WAKESHORE_LANDING_ID,
    playerDead: false,
    healthFull: true,
    scuttlerAlive: true,
  });

  expect(failures, failures.join("\n")).toEqual([]);
});

test("reloading after death or respawn restores the post-respawn state (no rewind)", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Travel commits a Hollowdeep save (DEC-034), so a rewind — if one were
  // possible — would restore Hollowdeep.
  await page.evaluate((zoneId) => {
    window.__RARPG_COMBAT_TEST__?.travelTo(zoneId);
  }, HOLLOWDEEP_ID);
  await expect(page.getByTestId("combat-zone")).toContainText("Hollowdeep");
  await expect
    .poll(() => activeSaveZone(page), {
      message: "zone travel should persist the Hollowdeep save",
    })
    .toBe(HOLLOWDEEP_ID);

  // Dying fires the death save with the respawn destination already
  // committed: even before the player confirms, the active save is
  // Hearthmere, so reload-from-the-death-screen cannot rewind (DEC-037).
  await killPlayer(page);
  await expect
    .poll(() => activeSaveZone(page), {
      message: "the death save should commit the respawn destination",
    })
    .toBe(HEARTHMERE_ID);

  // Confirming fires the save-at-respawn trigger with the same outcome.
  await page.getByTestId("death-respawn").click();
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect.poll(() => activeSaveZone(page)).toBe(HEARTHMERE_ID);

  // A real player boot: Continue restores the post-respawn character.
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  const continueButton = page.getByTestId("main-menu-continue");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  const restored = await page.evaluate(() => {
    const state = window.__RARPG_COMBAT_TEST__?.diagnostics();
    return state === null || state === undefined
      ? null
      : {
          zoneId: state.zoneId,
          playerDead: state.playerDead,
          healthFull: state.playerHealth === state.playerMaxHealth,
        };
  });
  expect(restored).toEqual({
    zoneId: HEARTHMERE_ID,
    playerDead: false,
    healthFull: true,
  });

  expect(failures, failures.join("\n")).toEqual([]);
});

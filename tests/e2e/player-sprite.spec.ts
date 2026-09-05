import { expect, test, type Page } from "@playwright/test";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`page: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    failures.push(
      `request: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    );
  });
  return failures;
}

async function diagnostics(page: Page) {
  return page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics() ?? null,
  );
}

async function playerAnimation(page: Page): Promise<string | null> {
  return (await diagnostics(page))?.playerAnimation ?? null;
}

test("barbarian sprite drives idle, locomotion, roll, attack, and death animations", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect.poll(() => diagnostics(page)).not.toBeNull();

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());

  await expect
    .poll(async () => (await diagnostics(page))?.playerSpriteReady)
    .toBe(true);

  // Running world-east faces screen south-east (sheet row 1) regardless
  // of where the cursor aims (world north-west here).
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.setAutomationPaused(true);
    window.__RARPG_COMBAT_TEST__?.setAimDirection(-1, -1);
    window.__RARPG_COMBAT_TEST__?.setMovement(1, 0);
    window.__RARPG_COMBAT_TEST__?.advancePaused(2);
  });
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:run:1");
  expect((await diagnostics(page))?.playerDirectionRow).toBe(1);

  // Stopping keeps the last movement facing, still ignoring the cursor.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.setMovement(0, 0);
    window.__RARPG_COMBAT_TEST__?.advancePaused(2);
  });
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:idle:1");

  // Running world-south faces screen south-west (sheet row 3).
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.setMovement(0, 1);
    window.__RARPG_COMBAT_TEST__?.advancePaused(2);
  });
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:run:3");

  // Dodge rolls in the movement direction.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.requestDodge();
    window.__RARPG_COMBAT_TEST__?.advancePaused(2);
  });
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:roll:3");

  // Let the dodge finish, then stop moving before the attack.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.setMovement(0, 0);
    window.__RARPG_COMBAT_TEST__?.advancePaused(30);
  });
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:idle:3");

  // Attacks still swing toward the cursor (world east = row 1).
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.setAimDirection(1, 0);
    window.__RARPG_COMBAT_TEST__?.requestPrimaryAttack();
    window.__RARPG_COMBAT_TEST__?.advancePaused(2);
  });
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:attack:1");

  // Lethal direct damage plays the death animation until reset.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.advancePaused(60);
    window.__RARPG_COMBAT_TEST__?.applyPlayerDamage(999);
  });
  await expect
    .poll(async () => (await diagnostics(page))?.playerDead)
    .toBe(true);
  await expect.poll(() => playerAnimation(page)).toBe("barbarian:die:1");

  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.reset();
    window.__RARPG_COMBAT_TEST__?.advancePaused(2);
  });
  await expect
    .poll(async () =>
      (await playerAnimation(page))?.startsWith("barbarian:idle:"),
    )
    .toBe(true);

  expect(failures).toEqual([]);
});

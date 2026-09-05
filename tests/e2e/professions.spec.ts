import { expect, test, type Page } from "@playwright/test";

import { ARENA_FORGE, VEINSHARD_OUTCROP_ID, oreNodeById } from "../../src/core";

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  page.on("requestfailed", (request) => {
    failures.push(
      `request: ${request.url()} (${request.failure()?.errorText ?? "unknown"})`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });
  return failures;
}

test("F gathers Veinshard and opens the Tempering Forge craft menu", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/?autostart", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(() => window.__RARPG_COMBAT_TEST__?.diagnostics() ?? null),
    )
    .not.toBeNull();

  const outcrop = oreNodeById(VEINSHARD_OUTCROP_ID);
  if (outcrop === undefined) throw new Error("Veinshard outcrop missing.");

  await page.evaluate(
    ({ x, y }) => {
      const combat = window.__RARPG_COMBAT_TEST__;
      if (combat === undefined) return;
      combat.setAutomationPaused(true);
      combat.reset();
      for (let index = 0; index < 400; index += 1) {
        const position = combat.diagnostics();
        if (position === null) return;
        const deltaX = x - position.x;
        const deltaY = y - position.y;
        if (Math.hypot(deltaX, deltaY) <= 36) {
          combat.setMovement(0, 0);
          break;
        }
        combat.setMovement(deltaX, deltaY);
        combat.advancePaused(1);
      }
      combat.setMovement(0, 0);
      combat.requestInteract();
      combat.advancePaused(80);
    },
    { x: outcrop.x, y: outcrop.y },
  );

  const mined = await page.evaluate(() => {
    const hud = window.__RARPG_COMBAT_TEST__?.itemHud();
    const character = window.__RARPG_COMBAT_TEST__?.characterHud();
    return {
      materials: hud?.inventorySlots
        .map((slot) => slot.item)
        .filter((item) => item?.kind === "material"),
      mining: character?.professions.find(
        (profession) => profession.id === "mining",
      ),
    };
  });
  expect(mined.materials).toEqual([
    expect.objectContaining({
      kind: "material",
      displayName: "Veinshard Ore",
      quantity: 1,
    }),
  ]);
  expect(mined.mining).toMatchObject({
    level: 1,
    experienceCurrent: 8,
  });

  await page.evaluate(
    ({ x, y }) => {
      const combat = window.__RARPG_COMBAT_TEST__;
      if (combat === undefined) return;
      for (let index = 0; index < 400; index += 1) {
        const position = combat.diagnostics();
        if (position === null) return;
        const deltaX = x - position.x;
        const deltaY = y - position.y;
        if (Math.hypot(deltaX, deltaY) <= 36) {
          combat.setMovement(0, 0);
          break;
        }
        combat.setMovement(deltaX, deltaY);
        combat.advancePaused(1);
      }
      combat.setMovement(0, 0);
      combat.requestInteract();
    },
    { x: ARENA_FORGE.x, y: ARENA_FORGE.y },
  );

  await expect(page.getByTestId("craft-menu")).toBeVisible();
  await expect(page.getByTestId("craft-menu")).toContainText(
    "Tempering Cleaver",
  );
  await expect(page.getByTestId("craft-menu")).toContainText(
    "Veinshard Ore 1/3",
  );

  expect(failures, failures.join("\n")).toEqual([]);
});

import { expect, test, type Page } from "@playwright/test";

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

test("enemy loot can be picked, equipped, and used to reassign combat", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(() => window.__RARPG_COMBAT_TEST__?.diagnostics() ?? null),
    )
    .not.toBeNull();

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    for (let kill = 0; kill < 3; kill += 1) {
      combat?.reset();
      combat?.advancePaused(76);
      combat?.setAimDirection(1, 0);
      combat?.requestAbilitySlot("lmb");
      combat?.advancePaused(15);
      combat?.requestAbilitySlot("lmb");
      combat?.advancePaused(15);
    }
  });

  const dropped = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics() ?? null,
  );
  expect(dropped).toMatchObject({
    enemyKillCount: 3,
    lootDropCount: 4,
    worldLoot: [
      expect.objectContaining({
        item: expect.objectContaining({ kind: "equipment" }),
      }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: "ability-stone" }),
      }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: "equipment" }),
      }),
      expect.objectContaining({
        item: expect.objectContaining({ kind: "equipment" }),
      }),
    ],
    renderedLoot: [
      expect.objectContaining({ itemKind: "equipment" }),
      expect.objectContaining({ itemKind: "ability-stone" }),
      expect.objectContaining({ itemKind: "equipment" }),
      expect.objectContaining({ itemKind: "equipment" }),
    ],
  });

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setMovement(1, 0);
    combat?.advancePaused(30);
    combat?.setMovement(0, 0);
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.worldLoot.length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.renderedLoot.length,
    ),
  ).toBe(0);

  const itemHud = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.itemHud() ?? null,
  );
  const equipmentSlot = itemHud?.inventorySlots.find(
    ({ item }) => item?.kind === "equipment" && item.modifiers.length > 0,
  );
  const stoneSlot = itemHud?.inventorySlots.find(
    ({ item }) => item?.kind === "ability-stone",
  );
  if (
    equipmentSlot?.item?.kind !== "equipment" ||
    stoneSlot?.item?.kind !== "ability-stone"
  ) {
    throw new Error("Deterministic equipment and Ability Stone were missing.");
  }

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await page.getByRole("button", { name: /Inventory/ }).click();
  const menu = page.getByTestId("inventory-menu");
  await expect(menu).toBeVisible();

  await page
    .getByRole("button", {
      name: `Inventory slot ${equipmentSlot.index + 1}, ${equipmentSlot.item.displayName}`,
    })
    .click();
  await expect(page.getByTestId("item-tooltip")).toContainText(
    equipmentSlot.item.displayName,
  );
  await expect(page.getByLabel("Item modifiers").locator("li")).toHaveCount(
    equipmentSlot.item.modifiers.length,
  );
  await page
    .getByRole("button", {
      name: `Equip ${equipmentSlot.item.displayName}`,
    })
    .click();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const hud = window.__RARPG_COMBAT_TEST__?.itemHud();
        return (
          (hud?.playerMaximumHealth ?? 0) > 100 ||
          (hud?.outgoingAbilityDamagePercent ?? 0) > 100
        );
      }),
    )
    .toBe(true);

  await page
    .getByRole("button", {
      name: `Inventory slot ${stoneSlot.index + 1}, Ability Stone`,
    })
    .click();
  await page.getByRole("button", { name: "Create Cinder Dart" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__RARPG_COMBAT_TEST__
            ?.itemHud()
            ?.abilityChoices.find(({ id }) => id === "ability:cinder-dart")
            ?.owned,
      ),
    )
    .toBe(true);

  await page
    .getByRole("combobox", { name: "Assign E ability" })
    .selectOption("ability:cinder-dart");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__RARPG_COMBAT_TEST__
            ?.itemHud()
            ?.loadout.find(({ slot }) => slot === "e")?.abilityId,
      ),
    )
    .toBe("ability:cinder-dart");
  await expect(
    page.getByTestId("combat-action-hud").locator(".combat-ability").nth(2),
  ).toHaveAttribute("data-ability-id", "ability:cinder-dart");

  await page.getByRole("button", { name: "Close inventory" }).click();
  await expect(canvas).toBeFocused();
  await page.keyboard.press("e");
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.lastAbilityResult,
      ),
    )
    .toMatchObject({
      abilityId: "ability:cinder-dart",
      accepted: true,
    });
  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.advancePaused(7));
  expect(
    await page.evaluate(
      () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.projectiles,
    ),
  ).toEqual([expect.objectContaining({ abilityId: "ability:cinder-dart" })]);
  expect(failures).toEqual([]);
});

test("rejected final Basic Cleave replacement resyncs the controlled loadout", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(() => window.__RARPG_COMBAT_TEST__?.diagnostics() ?? null),
    )
    .not.toBeNull();

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.reset();
    combat?.advancePaused(76);
    combat?.setAimDirection(1, 0);
    combat?.requestAbilitySlot("lmb");
    combat?.advancePaused(15);
    combat?.requestAbilitySlot("lmb");
    combat?.advancePaused(15);
    combat?.setMovement(1, 0);
    combat?.advancePaused(30);
    combat?.setMovement(0, 0);
  });

  const itemHud = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.itemHud() ?? null,
  );
  const stoneSlot = itemHud?.inventorySlots.find(
    ({ item }) => item?.kind === "ability-stone",
  );
  if (stoneSlot?.item?.kind !== "ability-stone") {
    throw new Error("First-kill Ability Stone was not picked up.");
  }

  await page.getByRole("button", { name: /Inventory/ }).click();
  await page
    .getByRole("button", {
      name: `Inventory slot ${stoneSlot.index + 1}, Ability Stone`,
    })
    .click();
  await page.getByRole("button", { name: "Create Cinder Dart" }).click();

  const lmbAssignment = page.getByRole("combobox", {
    name: "Assign Left click ability",
  });
  await expect(lmbAssignment).toHaveValue("ability:basic-cleave");
  await lmbAssignment.selectOption("ability:cinder-dart");
  await expect(lmbAssignment).toHaveValue("ability:basic-cleave");
  expect(
    await page.evaluate(
      () =>
        window.__RARPG_COMBAT_TEST__
          ?.itemHud()
          ?.loadout.find(({ slot }) => slot === "lmb")?.abilityId,
    ),
  ).toBe("ability:basic-cleave");

  await page.getByRole("button", { name: "Close inventory" }).click();
  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await expect(canvas).toBeFocused();
  await canvas.click({ position: { x: 100, y: 100 } });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.lastAbilityResult,
      ),
    )
    .toMatchObject({
      abilityId: "ability:basic-cleave",
      accepted: true,
    });
  expect(failures).toEqual([]);
});

import { expect, test, type Page } from "@playwright/test";

import { equipmentBaseById, type ItemRarity } from "../../src/core";

const RARITY_LABEL_COLORS: Readonly<Record<ItemRarity, string>> = {
  common: "#ffffff",
  magic: "#60a5fa",
  rare: "#ffd166",
  unique: "#ff8000",
};
const ABILITY_STONE_LABEL_COLOR = "#c084fc";

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

test("enemy loot can be picked, equipped, and used to create an ability", async ({
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
  if (dropped === null) {
    throw new Error("Combat loot diagnostics were unavailable.");
  }

  // Every drop shows a floating ground label with the compact base display
  // name (never the affix-decorated name) in its rarity color.
  const expectedLabels = dropped.worldLoot.map(({ item }) =>
    item.kind === "ability-stone"
      ? { labelText: "Ability Stone", labelColor: ABILITY_STONE_LABEL_COLOR }
      : {
          labelText: equipmentBaseById(item.baseId)?.displayName ?? "",
          labelColor: RARITY_LABEL_COLORS[item.rarity],
        },
  );
  expect(
    dropped.renderedLoot.map(({ labelText, labelColor }) => ({
      labelText,
      labelColor,
    })),
  ).toEqual(expectedLabels);
  // All four drops land on the same deterministic kill spot, so their labels
  // must stack upward instead of overlapping: each successive label sits
  // strictly above the previous one.
  for (let index = 1; index < dropped.renderedLoot.length; index += 1) {
    expect(dropped.renderedLoot[index]!.labelCanvasY).toBeLessThan(
      dropped.renderedLoot[index - 1]!.labelCanvasY - 4,
    );
  }

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setMovement(1, 0);
    combat?.advancePaused(10);
    combat?.setMovement(0, 0);
  });
  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  for (let remaining = 4; remaining > 0; remaining -= 1) {
    await page.keyboard.press("f");
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.worldLoot.length,
        ),
      )
      .toBe(remaining - 1);
  }
  expect(
    await page.evaluate(
      () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.renderedLoot.length,
    ),
  ).toBe(0);

  const itemHud = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.itemHud() ?? null,
  );
  const equipmentSlot =
    itemHud?.inventorySlots.find(
      ({ item }) =>
        item?.kind === "equipment" &&
        item.slotKind !== "flask" &&
        item.modifiers.some(({ source }) => source === "affix"),
    ) ??
    itemHud?.inventorySlots.find(
      ({ item }) =>
        item?.kind === "equipment" &&
        item.slotKind !== "flask" &&
        item.modifiers.length > 0,
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

  // The canvas holds focus after loot pickup, and I toggles the menu open.
  await page.keyboard.press("i");
  const menu = page.getByTestId("inventory-menu");
  await expect(menu).toBeVisible();

  const sourceSlot = page.getByRole("button", {
    name: `Inventory slot ${equipmentSlot.index + 1}, ${equipmentSlot.item.displayName}`,
  });
  await sourceSlot.click();
  await expect(page.getByTestId("item-tooltip")).toContainText(
    equipmentSlot.item.displayName,
  );
  await expect(page.getByLabel("Item modifiers").locator("li")).toHaveCount(
    equipmentSlot.item.modifiers.length,
  );
  // Affix lines surface T1–T5 tier markers; base lines never do.
  const affixModifierCount = equipmentSlot.item.modifiers.filter(
    ({ source }) => source === "affix",
  ).length;
  const tierMarkers = page.locator('[data-testid="item-tooltip"] .affix-tier');
  await expect(tierMarkers).toHaveCount(affixModifierCount);
  if (affixModifierCount > 0) {
    await expect(tierMarkers.first()).toHaveText(/^T[1-5]$/);
  }

  // Drag the item from the inventory onto its concrete paper-doll slot.
  const targetSlot =
    equipmentSlot.item.slotKind === "ring"
      ? "ring-1"
      : equipmentSlot.item.slotKind;
  const dropTarget = page.locator(`[data-drop-equipment-slot="${targetSlot}"]`);
  const sourceBox = await sourceSlot.boundingBox();
  const targetBox = await dropTarget.boundingBox();
  if (sourceBox === null || targetBox === null) {
    throw new Error("Drag source or drop target was not visible.");
  }
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 8 },
  );
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
  await expect(dropTarget).toHaveClass(/drop-valid/);
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(
        (slot) =>
          window.__RARPG_COMBAT_TEST__
            ?.itemHud()
            ?.equipmentSlots.find((candidate) => candidate.slot === slot)?.item
            ?.instanceId ?? null,
        targetSlot,
      ),
    )
    .toBe(equipmentSlot.item.instanceId);
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

  await expect(page.getByText("Combat loadout")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: /Assign / })).toHaveCount(0);
  await expect(
    page.getByTestId("inventory-flask-slots").locator("li"),
  ).toHaveCount(4);

  await page.getByRole("button", { name: "Close inventory" }).click();
  await expect(canvas).toBeFocused();
  expect(failures).toEqual([]);
});

test("inventory keeps default Basic Cleave and reserved flask slots", async ({
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

  await page.getByRole("button", { name: /Inventory/ }).click();
  const menu = page.getByTestId("inventory-menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByText("Combat loadout")).toHaveCount(0);
  await expect(menu.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByTestId("inventory-flask-slots").locator("li"),
  ).toHaveCount(4);
  await expect(
    page.getByTestId("combat-action-hud").locator(".combat-ability").first(),
  ).toHaveAttribute("data-ability-id", "ability:basic-cleave");

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

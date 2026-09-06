import { expect, test, type Page } from "@playwright/test";

/**
 * TASK-715 (DEC-041) system menu coverage. DEC-033-proof by design: pause
 * assertions poll the focus-gated runner's stable `pausedForUi` flag, key
 * rebind proof polls charge counts (stable endpoints) after deterministic
 * `grantFlask` setups, and no mid-simulation values are ever sampled in
 * real time.
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

function pausedForUi(page: Page): Promise<boolean | null> {
  return page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.pausedForUi ?? null,
  );
}

async function focusCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector("canvas")?.focus();
  });
}

function flaskCharges(page: Page): Promise<number | null> {
  return page.evaluate(
    () =>
      window.__RARPG_COMBAT_TEST__?.diagnostics()?.flasks[0]?.chargesCurrent ??
      null,
  );
}

test("Escape opens the pausing system menu in LIFO priority and Resume unpauses", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  const menu = page.getByTestId("system-menu");
  await focusCanvas(page);
  await expect.poll(() => pausedForUi(page)).toBe(false);

  // Escape with no other overlay open: the system menu appears and the
  // focus-gated runner pauses (the menu holds focus, not the canvas).
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();
  await expect(menu).toBeFocused();
  await expect.poll(() => pausedForUi(page)).toBe(true);

  // Resume closes the menu, refocuses the canvas, and unpauses.
  await page.getByTestId("system-menu-resume").click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => pausedForUi(page)).toBe(false);

  // Escape priority is unchanged: an open inventory consumes Escape first
  // (LIFO), and only the next Escape reaches the system menu.
  await page.keyboard.press("i");
  await expect(page.getByTestId("inventory-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("inventory-menu")).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeVisible();

  // Escape also closes the menu itself and hands focus back to gameplay.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect.poll(() => pausedForUi(page)).toBe(false);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("rebinding a flask key applies immediately, persists across reload, and resets to defaults", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  // Deterministic setup: an equipped Heartwell (34 max charges, 20 per
  // drink) and a wounded player so drinks are accepted.
  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.grantFlask(1, "life");
    combat?.applyPlayerDamage(60);
  });
  await expect.poll(() => flaskCharges(page)).toBe(34);

  // Rebind Flask 1 from Digit1 to Digit5 through the menu.
  await focusCanvas(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("system-menu-keybinds").click();
  const flaskBinding = page.getByTestId("keybind-flask-1");
  await expect(flaskBinding).toHaveText("1");
  await flaskBinding.click();
  await expect(flaskBinding).toHaveText("Press a key…");
  await page.keyboard.press("5");
  await expect(flaskBinding).toHaveText("5");
  // The HUD flask row reflects the new key label immediately.
  await expect(
    page.getByTestId("combat-flask-slots").locator("kbd").first(),
  ).toHaveText("5");
  await page.getByTestId("system-menu-back").click();
  await page.getByTestId("system-menu-resume").click();

  // The old key is inert; the new key drinks (charges are the stable
  // endpoint: 34 → 14 spends exactly one 20-charge drink).
  await focusCanvas(page);
  await page.keyboard.press("1");
  await expect(page.getByTestId("system-menu")).toHaveCount(0);
  expect(await flaskCharges(page)).toBe(34);
  await page.keyboard.press("5");
  await expect
    .poll(() => flaskCharges(page), {
      message: "the rebound key should spend the drink's charges",
    })
    .toBe(14);

  // The mapping is device state in localStorage: a full reload keeps it.
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);
  await focusCanvas(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("system-menu-keybinds").click();
  await expect(page.getByTestId("keybind-flask-1")).toHaveText("5");

  // Reset to Defaults restores Digit1 end to end.
  await page.getByTestId("system-menu-reset-keybinds").click();
  await expect(page.getByTestId("keybind-flask-1")).toHaveText("1");
  await page.getByTestId("system-menu-back").click();
  await page.getByTestId("system-menu-resume").click();

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.grantFlask(1, "life");
    combat?.applyPlayerDamage(60);
  });
  await expect.poll(() => flaskCharges(page)).toBe(34);
  await focusCanvas(page);
  await page.keyboard.press("5");
  expect(await flaskCharges(page)).toBe(34);
  await page.keyboard.press("1");
  await expect.poll(() => flaskCharges(page)).toBe(14);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("Exit to Character Select saves the hero and returns to the /play/ menu", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  await focusCanvas(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("system-menu-exit-character-select").click();
  await page.waitForURL("**/play/");

  // The main menu gates re-entry (character select composes here once a
  // session exists, DEC-036) and the exit flush committed a loadable save:
  // Continue arms from the boot-time load.
  await expect(page.getByTestId("main-menu")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.__RARPG_CHARACTER_SAVE_TEST__?.activeSave()) ?? null,
      ),
    )
    .toMatchObject({ zoneId: "zone:hearthmere", source: "active" });
  await expect(page.getByTestId("main-menu-continue")).toBeEnabled();

  expect(failures, failures.join("\n")).toEqual([]);
});

test("Exit to Main Menu saves and navigates to the homepage without logging out", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  // The homepage probes the session on load (TASK-716/DEC-042) and fetches
  // the news feed (TASK-721); answer both cleanly so the landing keeps the
  // console quiet.
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  );
  await page.route("**/api/news", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await combatReady(page);

  await focusCanvas(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("system-menu-exit-main-menu").click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page).toHaveTitle("Loot Divers");
  // Signed out, the homepage offers the account-first CTA (TASK-716).
  await expect(page.getByTestId("home-create-account")).toBeVisible();

  expect(failures, failures.join("\n")).toEqual([]);
});

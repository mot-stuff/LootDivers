import { expect, test, type Page } from "@playwright/test";

/**
 * TASK-719 regression coverage: the owner's journey against the REAL API —
 * the app from `server/` running on MemoryStore — not the route mocks the
 * other account specs use. These tests found the login-save-restore defect
 * (progress lost because page-hide was the only save trigger carrying
 * tutorial progress, and its PUT dies with the document).
 *
 * Run `npm run dev:memory` in `server/` first (127.0.0.1:8790); when the API
 * is not listening the suite skips, so CI (which has no API) is unaffected.
 * The preview origin's /api is proxied to the API so cookies and the
 * ?accountTest seam work unchanged.
 */

const API = "http://127.0.0.1:8790";

async function apiUp(): Promise<boolean> {
  try {
    const response = await fetch(`${API}/auth/session`);
    return response.status === 401 || response.ok;
  } catch {
    return false;
  }
}

async function proxyApi(page: Page): Promise<void> {
  await page.context().route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const target = `${API}${url.pathname.replace(/^\/api/, "")}${url.search}`;
    const response = await route.fetch({ url: target });
    await route.fulfill({
      status: response.status(),
      headers: response.headers(),
      body: await response.body(),
    });
  });
}

async function signupAndCreate(page: Page, name: string): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTestId("home-auth-tab-signup").click();
  await page
    .getByTestId("home-auth-email")
    .fill(
      `t719-${String(Date.now())}-${Math.random().toString(36).slice(2)}@example.test`,
    );
  await page.getByTestId("home-auth-password").fill("a-strong-password");
  await page.getByTestId("home-auth-submit").click();
  await expect(page.getByTestId("home-play")).toBeVisible();

  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await expect(page.getByTestId("account-select")).toBeVisible();
  await page.getByTestId("account-create-open").click();
  await page.getByTestId("account-create-name").fill(name);
  await page.getByTestId("account-create-submit").click();
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Wakeshore Landing",
    { timeout: 15_000 },
  );
  await page.waitForTimeout(400);
}

/** Banks the move and dodge tutorial steps through real simulation verbs. */
async function bankTutorialSteps(page: Page): Promise<void> {
  const banked = await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    if (!combat) return -1;
    combat.setAutomationPaused(true);
    combat.setMovement(1, 0);
    combat.advancePaused(40);
    combat.setMovement(0, 0);
    combat.requestDodge();
    combat.advancePaused(80);
    combat.setAutomationPaused(false);
    return combat.diagnostics()?.tutorial?.stepsCompleted ?? -1;
  });
  expect(banked).toBeGreaterThanOrEqual(2);
}

/** Reads the stored envelope's banked tutorial steps straight off the API. */
async function serverBankedSteps(page: Page): Promise<string[] | null> {
  return page.evaluate(async () => {
    const list = (await fetch("/api/characters", {
      credentials: "include",
    }).then((response) => response.json())) as { id: string }[];
    const id = list[0]?.id;
    if (id === undefined) return null;
    const detail = (await fetch(`/api/characters/${id}`, {
      credentials: "include",
    }).then((response) => response.json())) as {
      envelope: {
        payload?: { character?: { tutorialBankedSteps?: string[] } };
      } | null;
    };
    return detail.envelope?.payload?.character?.tutorialBankedSteps ?? null;
  });
}

test("banked tutorial steps reach the server before any travel or tab close", async ({
  page,
}) => {
  test.skip(
    !(await apiUp()),
    "dev API not running (server: npm run dev:memory)",
  );
  test.setTimeout(120_000);
  await proxyApi(page);

  await signupAndCreate(page, "Step Keeper");
  await bankTutorialSteps(page);

  // TASK-719 fix: banking a step is itself a save trigger, so the progress
  // lands while the session is alive — no longer riding on page-hide.
  await expect
    .poll(async () => serverBankedSteps(page), { timeout: 10_000 })
    .toEqual(expect.arrayContaining(["move", "dodge"]));
});

test("owner journey: play, relogin, select restores progress through the real API", async ({
  page,
}) => {
  test.skip(
    !(await apiUp()),
    "dev API not running (server: npm run dev:memory)",
  );
  test.setTimeout(120_000);
  await proxyApi(page);

  await signupAndCreate(page, "Rega the Bold");
  await bankTutorialSteps(page);
  await expect
    .poll(async () => serverBankedSteps(page), { timeout: 10_000 })
    .toEqual(expect.arrayContaining(["move", "dodge"]));

  // Travel (another DEC-034 trigger), then re-login fresh and select.
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.travelTo("zone:hearthmere");
  });
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await page.waitForTimeout(500);

  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await expect(page.getByTestId("account-select")).toBeVisible();
  const entry = page.getByTestId("account-character-select");
  await expect(entry).toHaveCount(1);
  await entry.click();

  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere", {
    timeout: 15_000,
  });
  const restored = await page.evaluate(
    () => window.__RARPG_COMBAT_TEST__?.diagnostics()?.tutorial ?? null,
  );
  expect(restored).not.toBeNull();
  expect(restored?.stepsCompleted).toBeGreaterThanOrEqual(2);
});

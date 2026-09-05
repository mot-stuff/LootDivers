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

test("playable arena accepts independent movement, aim, and dodge input", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(
    page.getByRole("heading", { name: "Combat movement arena" }),
  ).toBeVisible();
  await expect.poll(() => diagnostics(page)).not.toBeNull();

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());

  await page.keyboard.down("w");
  await page.keyboard.down("d");
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return state === null
        ? null
        : {
            movementX: state.movementX,
            movementY: state.movementY,
          };
    })
    .toMatchObject({
      movementX: 1 / Math.sqrt(2),
      movementY: -1 / Math.sqrt(2),
    });
  await page.keyboard.up("w");
  await page.keyboard.up("d");

  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await diagnostics(page))?.dodgeCount).toBe(1);
  await expect
    .poll(async () => (await diagnostics(page))?.dodgeReady)
    .toBe(false);

  await page.getByRole("button", { name: "Send diagnostic intent" }).focus();
  await expect
    .poll(async () => (await diagnostics(page))?.pausedForUi)
    .toBe(true);
  const pausedState = await diagnostics(page);
  await page.waitForTimeout(120);
  expect((await diagnostics(page))?.tick).toBe(pausedState?.tick);

  await page.keyboard.press("w");
  expect((await diagnostics(page))?.tick).toBe(pausedState?.tick);
  expect(failures).toEqual([]);
});

test("real pointer movement inverse-projects screen aim into world facing", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  const box = await canvas.boundingBox();
  const canvasSize = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  const state = await diagnostics(page);
  if (box === null || state === null) {
    throw new Error("Combat canvas diagnostics were unavailable.");
  }

  await page.mouse.move(
    box.x + (state.playerCanvasX / canvasSize.width) * box.width,
    box.y + (state.playerCanvasY / canvasSize.height) * box.height - 100,
  );

  await expect
    .poll(async () => {
      const facing = await diagnostics(page);
      if (facing === null) {
        return false;
      }
      const screenX = facing.pointerCanvasX - facing.playerCanvasX;
      const screenY = facing.pointerCanvasY - facing.playerCanvasY;
      const difference = screenX / 0.65;
      const sum = screenY / 0.34;
      const worldX = (difference + sum) / 2;
      const worldY = (sum - difference) / 2;
      const length = Math.hypot(worldX, worldY);
      return (
        length > 0 &&
        Math.abs(facing.facingX - worldX / length) < 0.01 &&
        Math.abs(facing.facingY - worldY / length) < 0.01
      );
    })
    .toBe(true);
  expect(failures).toEqual([]);
});

test("movement remains bounded by semantic arena diagnostics", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());
  await page.keyboard.down("a");
  await expect
    .poll(async () => (await diagnostics(page))?.x, { timeout: 3_000 })
    .toBe(18);
  await page.keyboard.up("a");

  const state = await diagnostics(page);
  expect(state?.x).toBe(18);
  expect(state?.y).toBe(180);
  expect(failures).toEqual([]);
});

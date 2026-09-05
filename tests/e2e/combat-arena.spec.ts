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

test("playable arena accepts movement, primary attack, aim, and dodge input", async ({
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

  const attackOrigin = await diagnostics(page);
  const canvasBox = await canvas.boundingBox();
  const canvasSize = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  if (attackOrigin === null || canvasBox === null) {
    throw new Error("Combat attack diagnostics were unavailable.");
  }
  await page.mouse.click(
    canvasBox.x +
      ((attackOrigin.playerCanvasX + 60) / canvasSize.width) * canvasBox.width,
    canvasBox.y +
      ((attackOrigin.playerCanvasY + 31) / canvasSize.height) *
        canvasBox.height,
  );
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return {
        attackCount: state?.attackCount,
        attackHitCount: state?.attackHitCount,
        targetHealth: state?.targets[0]?.health,
        impactCount: state?.impactCount,
      };
    })
    .toEqual({
      attackCount: 1,
      attackHitCount: 0,
      targetHealth: 100,
      impactCount: 0,
    });

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
  await expect.poll(async () => (await diagnostics(page))?.dodging).toBe(true);
  const dodgeDamage = await page.evaluate(() =>
    window.__RARPG_COMBAT_TEST__?.applyPlayerDamage(30),
  );
  expect(dodgeDamage).toMatchObject({
    applied: 0,
    currentHealth: 100,
    ignoredReason: "invulnerable",
  });
  await expect
    .poll(async () => (await diagnostics(page))?.dodgeReady)
    .toBe(false);

  await page.getByRole("link", { name: "Skip canvas" }).focus();
  await expect
    .poll(async () => (await diagnostics(page))?.pausedForUi)
    .toBe(true);
  await expect(page.locator(".combat-paused-hud")).toBeVisible();
  const pausedState = await diagnostics(page);
  await page.waitForTimeout(120);
  expect((await diagnostics(page))?.tick).toBe(pausedState?.tick);

  await page.keyboard.press("w");
  expect((await diagnostics(page))?.tick).toBe(pausedState?.tick);
  expect(failures).toEqual([]);
});

test("playable encounter approaches and dies to four directional attacks", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect.poll(() => diagnostics(page)).not.toBeNull();

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.reset();
    combat?.advancePaused(113);
    combat?.setAimDirection(1, 0);
  });
  await expect
    .poll(async () => (await diagnostics(page))?.enemy.state)
    .toBe("windup");

  for (let attack = 1; attack <= 4; attack += 1) {
    await page.evaluate(() => {
      const combat = window.__RARPG_COMBAT_TEST__;
      combat?.requestPrimaryAttack();
      combat?.advancePaused(15);
    });
    await expect
      .poll(async () => (await diagnostics(page))?.enemy.health)
      .toBe(100 - attack * 25);
  }

  const defeated = await diagnostics(page);
  expect(defeated).toMatchObject({
    attackCount: 4,
    attackHitCount: 1,
    enemy: {
      health: 0,
      dead: true,
      state: "dead",
    },
    deathFeedbackCount: 1,
  });
  expect(failures).toEqual([]);
});

test("enemy cadence honors exact-tick dodge and reset semantics", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect.poll(() => diagnostics(page)).not.toBeNull();

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.setAutomationPaused(true);
    combat?.reset();
    combat?.setAimDirection(1, 0);
    combat?.advancePaused(130);
  });
  expect(await diagnostics(page)).toMatchObject({
    tick: 130,
    playerHealth: 100,
    enemy: {
      state: "windup",
      windupTicksRemaining: 1,
      attackCount: 1,
      damageAttemptCount: 0,
    },
  });

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.requestDodge();
    combat?.advancePaused(1);
  });
  expect(await diagnostics(page)).toMatchObject({
    tick: 131,
    playerHealth: 100,
    dodging: true,
    enemy: {
      damageAttemptCount: 1,
      damageAppliedCount: 0,
    },
    enemyStrikeFeedbackCount: 1,
    impactCount: 0,
  });

  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.advancePaused(60));
  expect(await diagnostics(page)).toMatchObject({
    tick: 191,
    playerHealth: 80,
    enemy: {
      attackCount: 2,
      damageAttemptCount: 2,
      damageAppliedCount: 1,
    },
    enemyStrikeFeedbackCount: 2,
    impactCount: 1,
  });

  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());
  expect(await diagnostics(page)).toMatchObject({
    tick: 0,
    x: 600,
    y: 400,
    playerHealth: 100,
    playerDead: false,
    dodgeCount: 0,
    dodgeTicksRemaining: 0,
    cooldownTicksRemaining: 0,
    attackCount: 0,
    attackPhaseTicksRemaining: 0,
    enemy: {
      x: 860,
      y: 400,
      health: 100,
      dead: false,
      state: "approaching",
      windupTicksRemaining: 0,
      cadenceTicksRemaining: 0,
      attackCount: 0,
      damageAttemptCount: 0,
      damageAppliedCount: 0,
    },
    impactCount: 0,
    deathFeedbackCount: 0,
    enemyStrikeFeedbackCount: 0,
  });
  expect(failures).toEqual([]);
});

test("combat canvas fills the browser viewport", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");

  const viewport = page.viewportSize();
  const box = await page
    .getByLabel("RARPG Phaser diagnostic canvas")
    .boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box?.x).toBeCloseTo(0, 0);
  expect(box?.y).toBeCloseTo(0, 0);
  expect(box?.width).toBeCloseTo(viewport?.width ?? 0, 0);
  expect(box?.height).toBeCloseTo(viewport?.height ?? 0, 0);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 900, height: 900 },
]) {
  test(`DOM stamina HUD stays compact at top-right at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toHaveAttribute(
      "data-app-state",
      "ready",
    );

    const box = await page.getByTestId("combat-stamina-hud").boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y).toBeCloseTo(16, 0);
    expect(box?.width).toBeLessThanOrEqual(224);
    expect(viewport.width - ((box?.x ?? 0) + (box?.width ?? 0))).toBeCloseTo(
      16,
      0,
    );
  });
}

for (const scenario of [
  { name: "default responsive viewport", viewport: null },
  { name: "900x900 viewport", viewport: { width: 900, height: 900 } },
] as const) {
  test(`real diagonal pointer aligns rendered facing at ${scenario.name}`, async ({
    page,
  }) => {
    const failures = collectRuntimeFailures(page);
    if (scenario.viewport !== null) {
      await page.setViewportSize(scenario.viewport);
    }
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toHaveAttribute(
      "data-app-state",
      "ready",
    );

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

    const playerViewportX =
      box.x + (state.playerCanvasX / canvasSize.width) * box.width;
    const playerViewportY =
      box.y + (state.playerCanvasY / canvasSize.height) * box.height;
    const cursorViewportX = playerViewportX + 120;
    const cursorViewportY = playerViewportY - 90;
    await page.mouse.move(cursorViewportX, cursorViewportY);

    const alignmentDegrees = async (): Promise<number> => {
      const facing = await diagnostics(page);
      const currentBox = await canvas.boundingBox();
      if (facing === null || currentBox === null) {
        return Number.POSITIVE_INFINITY;
      }
      const renderedPlayerX =
        currentBox.x +
        (facing.playerCanvasX / canvasSize.width) * currentBox.width;
      const renderedPlayerY =
        currentBox.y +
        (facing.playerCanvasY / canvasSize.height) * currentBox.height;
      const renderedFacingX =
        currentBox.x +
        (facing.facingCanvasX / canvasSize.width) * currentBox.width;
      const renderedFacingY =
        currentBox.y +
        (facing.facingCanvasY / canvasSize.height) * currentBox.height;
      const cursorX = cursorViewportX - renderedPlayerX;
      const cursorY = cursorViewportY - renderedPlayerY;
      const renderedX = renderedFacingX - renderedPlayerX;
      const renderedY = renderedFacingY - renderedPlayerY;
      const lengths =
        Math.hypot(cursorX, cursorY) * Math.hypot(renderedX, renderedY);
      const cosine = (cursorX * renderedX + cursorY * renderedY) / lengths;
      return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
    };

    await expect.poll(alignmentDegrees).toBeLessThan(0.5);
    console.log(
      `${scenario.name} aim alignment: ${(await alignmentDegrees()).toFixed(3)}°`,
    );
    expect(failures).toEqual([]);
  });
}

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
    .poll(async () => (await diagnostics(page))?.x, { timeout: 5_000 })
    .toBe(18);
  await page.keyboard.up("a");

  const state = await diagnostics(page);
  expect(state?.x).toBe(18);
  expect(state?.y).toBe(400);
  expect(failures).toEqual([]);
});

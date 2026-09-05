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
    page.getByRole("heading", { name: "Ability combat arena" }),
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
      targetHealth: 50,
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

test("common enemy approaches and dies to two directional attacks", async ({
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
    combat?.advancePaused(76);
    combat?.setAimDirection(1, 0);
  });
  await expect
    .poll(async () => (await diagnostics(page))?.enemy.state)
    .toBe("windup");
  const approached = await diagnostics(page);
  expect(approached?.enemyHealthBarVisible).toBe(true);
  expect(approached?.enemyHealthBarCanvasX).toBeCloseTo(
    approached?.enemyCanvasX ?? 0,
    5,
  );
  expect(approached?.enemyHealthBarCanvasY).toBeLessThan(
    approached?.enemyCanvasY ?? 0,
  );

  for (let attack = 1; attack <= 2; attack += 1) {
    await page.evaluate(() => {
      const combat = window.__RARPG_COMBAT_TEST__;
      combat?.requestPrimaryAttack();
      combat?.advancePaused(15);
    });
    await expect
      .poll(async () => (await diagnostics(page))?.enemy.health)
      .toBe(50 - attack * 25);
  }

  const defeated = await diagnostics(page);
  expect(defeated).toMatchObject({
    attackCount: 2,
    attackHitCount: 1,
    enemy: {
      health: 0,
      dead: true,
      state: "dead",
    },
    deathFeedbackCount: 1,
    enemyHealthBarVisible: false,
  });
  await expect(page.locator('[aria-label*="Enemy health"]')).toHaveCount(0);
  await expect(page.getByText("ENEMY DEFEATED", { exact: true })).toHaveCount(
    0,
  );
  expect(failures).toEqual([]);
});

test("ability automation exposes projectile, area, and status presentation paths", async ({
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
    combat?.requestCinderDart();
    combat?.advancePaused(7);
  });
  expect(await diagnostics(page)).toMatchObject({
    mana: 85.7,
    projectiles: [
      expect.objectContaining({ abilityId: "ability:cinder-dart", radius: 6 }),
    ],
    renderedProjectileCount: 1,
  });
  await expect(
    page.getByRole("progressbar", { name: "Player mana" }),
  ).toHaveAttribute("aria-valuenow", "85.7");
  const cinderDart = page.locator('[data-ability-id="ability:cinder-dart"]');
  await expect(cinderDart).toHaveAttribute("data-state", "executing");
  await expect(cinderDart).toContainText("Executing");
  await expect(
    page.locator('[data-ability-id="ability:winter-pulse"]'),
  ).toHaveAttribute("data-state", "busy");

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.reset();
    combat?.requestWinterPulse(860, 400);
    combat?.advancePaused(12);
  });
  expect(await diagnostics(page)).toMatchObject({
    enemy: { health: 30 },
    areaFeedback: [
      expect.objectContaining({
        abilityId: "ability:winter-pulse",
        radius: 100,
      }),
    ],
    statuses: [
      expect.objectContaining({ statusId: "chilled", ticksRemaining: 120 }),
    ],
    renderedAreaCount: 1,
    renderedStatusCount: 1,
  });
  await expect(
    page.getByLabel("Active combat effects").getByText("Enemy Chilled 2s"),
  ).toBeVisible();

  await page.evaluate(() => {
    const combat = window.__RARPG_COMBAT_TEST__;
    combat?.reset();
    combat?.advancePaused(30);
    combat?.requestDefiantSignal();
    combat?.advancePaused(6);
  });
  expect(await diagnostics(page)).toMatchObject({
    areaFeedback: [
      expect.objectContaining({
        abilityId: "ability:defiant-signal",
        radius: 180,
      }),
    ],
    statuses: expect.arrayContaining([
      expect.objectContaining({ targetId: "player", statusId: "focused" }),
      expect.objectContaining({ statusId: "weakened" }),
    ]),
    renderedAreaCount: 1,
    renderedStatusCount: 2,
  });
  await expect(
    page.getByLabel("Active combat effects").getByText("Focused 3s"),
  ).toBeVisible();
  await expect(
    page.getByLabel("Active combat effects").getByText("Enemy Weakened 3s"),
  ).toBeVisible();
  const actionBar = page.getByTestId("combat-action-hud");
  await expect(actionBar.locator(".combat-ability")).toHaveCount(4);
  await expect(actionBar.locator(".combat-ability kbd")).toHaveText([
    "LMB",
    "Q",
    "E",
    "F",
  ]);
  await expect(
    page.getByLabel(/Left click, Basic Cleave, Free, No cooldown/),
  ).toBeVisible();
  expect(failures).toEqual([]);
});

test("focused canvas Q, E, and F drive authoritative ability presentation", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());

  await page.keyboard.press("q");
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return state === null
        ? null
        : {
            manaSpent: state.mana < 100,
            cooldownStarted:
              (state.abilities.find(
                (ability) => ability.abilityId === "ability:cinder-dart",
              )?.cooldownTicksRemaining ?? 0) > 0,
            projectileRendered: state.renderedProjectileCount > 0,
          };
    })
    .toEqual({
      manaSpent: true,
      cooldownStarted: true,
      projectileRendered: true,
    });

  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());
  await canvas.focus();
  const pulseOrigin = await diagnostics(page);
  const canvasBox = await canvas.boundingBox();
  const canvasSize = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  if (pulseOrigin === null || canvasBox === null) {
    throw new Error("Combat pulse diagnostics were unavailable.");
  }
  await page.mouse.move(
    canvasBox.x +
      (pulseOrigin.enemyCanvasX / canvasSize.width) * canvasBox.width,
    canvasBox.y +
      (pulseOrigin.enemyCanvasY / canvasSize.height) * canvasBox.height,
  );
  await page.keyboard.press("e");
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return state === null
        ? null
        : {
            manaSpent: state.mana < 100,
            cooldownStarted:
              (state.abilities.find(
                (ability) => ability.abilityId === "ability:winter-pulse",
              )?.cooldownTicksRemaining ?? 0) > 0,
            areaRendered: state.renderedAreaCount > 0,
            chilledRendered: state.statuses.some(
              (status) => status.statusId === "chilled",
            ),
          };
    })
    .toEqual({
      manaSpent: true,
      cooldownStarted: true,
      areaRendered: true,
      chilledRendered: true,
    });

  await page.evaluate(() => window.__RARPG_COMBAT_TEST__?.reset());
  await canvas.focus();
  await page.keyboard.press("f");
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return state === null
        ? null
        : {
            manaSpent: state.mana < 100,
            cooldownStarted:
              (state.abilities.find(
                (ability) => ability.abilityId === "ability:defiant-signal",
              )?.cooldownTicksRemaining ?? 0) > 0,
            areaRendered: state.renderedAreaCount > 0,
            focusedRendered: state.statuses.some(
              (status) => status.statusId === "focused",
            ),
          };
    })
    .toEqual({
      manaSpent: true,
      cooldownStarted: true,
      areaRendered: true,
      focusedRendered: true,
    });
  expect(failures).toEqual([]);
});

test("focused canvas ability keys are rejected after player death", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.reset();
    window.__RARPG_COMBAT_TEST__?.applyPlayerDamage(1_000);
  });

  await page.keyboard.press("q");
  await page.keyboard.press("e");
  await page.keyboard.press("f");
  await expect
    .poll(async () => {
      const state = await diagnostics(page);
      return state === null
        ? null
        : {
            mana: state.mana,
            cooldowns: state.cooldowns,
            result: state.lastAbilityResult,
            currentExecution: state.currentExecution,
          };
    })
    .toMatchObject({
      mana: 100,
      cooldowns: {
        "ability:basic-cleave": 0,
        "ability:cinder-dart": 0,
        "ability:winter-pulse": 0,
        "ability:defiant-signal": 0,
      },
      result: {
        abilityId: "ability:defiant-signal",
        accepted: false,
        reason: "player-defeated",
      },
      currentExecution: null,
    });
  await expect(
    page.getByTestId("combat-action-hud").locator('[data-state="defeated"]'),
  ).toHaveCount(4);
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
    combat?.advancePaused(93);
  });
  expect(await diagnostics(page)).toMatchObject({
    tick: 93,
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
    tick: 94,
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
    tick: 154,
    playerHealth: 90,
    enemy: {
      attackCount: 2,
      damageAttemptCount: 2,
      damageAppliedCount: 1,
    },
    enemyStrikeFeedbackCount: 2,
    impactCount: 1,
  });
  await expect(
    page.getByRole("progressbar", { name: "Player health" }),
  ).toHaveAttribute("aria-valuenow", "90");

  await page.evaluate(() =>
    window.__RARPG_COMBAT_TEST__?.applyPlayerDamage(100),
  );
  await expect(
    page.getByRole("progressbar", { name: "Player health" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(
    page.getByTestId("combat-vitals-hud").locator('[data-state="dead"]'),
  ).toHaveCount(1);
  await expect(page.getByTestId("combat-vitals-hud")).toHaveText("HPMPXP");

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
      health: 50,
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
  await expect(
    page.getByRole("progressbar", { name: "Player health" }),
  ).toHaveAttribute("aria-valuenow", "100");
  await expect(
    page.getByTestId("combat-vitals-hud").locator('[data-state="dead"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("combat-vitals-hud")).toHaveText("HPMPXP");
  await expect(page.locator('[aria-label*="Enemy health"]')).toHaveCount(0);
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
  { width: 480, height: 720 },
]) {
  test(`player vitals stay compact at top-right at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toHaveAttribute(
      "data-app-state",
      "ready",
    );

    const hud = page.getByTestId("combat-vitals-hud");
    const rows = hud.locator(":scope > .combat-vitals-row");
    const labels = hud.locator(".combat-vitals-label");
    await expect(hud).toHaveCount(1);
    await expect(rows).toHaveCount(3);
    await expect(labels).toHaveText(["HP", "MP", "XP"]);
    await expect(hud).toHaveText("HPMPXP");
    await expect(hud).not.toContainText(
      /HEALTH|STAMINA|READY|FULL|DEFEATED|\d|%/i,
    );
    await expect(
      page.getByRole("progressbar", { name: "Player health" }),
    ).toHaveAttribute("aria-valuenow", "100");
    await expect(
      page.getByRole("progressbar", { name: "Player mana" }),
    ).toHaveAttribute("aria-valuenow", "100");
    await expect(
      page.getByRole("progressbar", {
        name: "Reserved experience placeholder",
      }),
    ).toHaveAttribute("aria-valuenow", "0");
    await expect(
      page.getByRole("progressbar", { name: /stamina/i }),
    ).toHaveCount(0);
    const hudBox = await hud.boundingBox();
    expect(hudBox).not.toBeNull();
    expect(hudBox?.y).toBeCloseTo(16, 0);
    expect(hudBox?.width).toBeLessThanOrEqual(224);
    expect(
      viewport.width - ((hudBox?.x ?? 0) + (hudBox?.width ?? 0)),
    ).toBeCloseTo(16, 0);
    expect(hudBox?.x).toBeGreaterThanOrEqual(0);
    expect(hudBox?.y).toBeGreaterThanOrEqual(0);
    expect((hudBox?.x ?? 0) + (hudBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width,
    );
    expect((hudBox?.y ?? 0) + (hudBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height,
    );

    const actionBar = page.getByTestId("combat-action-hud");
    await expect(actionBar).toBeVisible();
    const actionBarBox = await actionBar.boundingBox();
    expect(actionBarBox).not.toBeNull();
    expect(actionBarBox?.x).toBeCloseTo(viewport.width <= 700 ? 8 : 16, 0);
    expect(actionBarBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect(actionBarBox?.width ?? Infinity).toBeLessThanOrEqual(288);
    expect(
      viewport.height - ((actionBarBox?.y ?? 0) + (actionBarBox?.height ?? 0)),
    ).toBeCloseTo(viewport.width <= 700 ? 8 : 16, 0);
    expect(
      (actionBarBox?.x ?? 0) + (actionBarBox?.width ?? 0),
    ).toBeLessThanOrEqual(viewport.width);
    expect(
      (actionBarBox?.y ?? 0) + (actionBarBox?.height ?? 0),
    ).toBeLessThanOrEqual(viewport.height);
    await expect(actionBar.locator(".combat-ability")).toHaveCount(4);
    await expect(actionBar.locator(".combat-ability kbd")).toHaveText([
      "LMB",
      "Q",
      "E",
      "F",
    ]);
    const flaskSlots = page.getByTestId("combat-flask-slots");
    await expect(flaskSlots.locator(".combat-flask-slot")).toHaveCount(4);
    await expect(flaskSlots.locator(".combat-flask-slot kbd")).toHaveText([
      "1",
      "2",
      "3",
      "4",
    ]);

    await page.getByRole("link", { name: "Skip canvas" }).focus();
    const pause = page.locator(".combat-paused-hud");
    await expect(pause).toBeVisible();
    const pauseBox = await pause.boundingBox();
    const titleBox = await page.locator(".diagnostic-shell").boundingBox();
    expect(pauseBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    expect(pauseBox?.y ?? 0).toBeGreaterThanOrEqual(
      (titleBox?.y ?? 0) + (titleBox?.height ?? 0),
    );
    await expect(
      pause.locator('[data-testid="combat-vitals-hud"]'),
    ).toHaveCount(0);
    await expect(page.locator('[aria-label*="Enemy health"]')).toHaveCount(0);
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

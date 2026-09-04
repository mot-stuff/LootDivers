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
  page.on("response", (response) => {
    if (response.status() >= 400) {
      failures.push(`response: ${response.status()} ${response.url()}`);
    }
  });

  return failures;
}

async function openReadyShell(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
}

test("DOM focus does not leak keyboard input into canvas capture", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await openReadyShell(page);

  const diagnosticButton = page.getByRole("button", {
    name: "Send diagnostic intent",
  });
  await diagnosticButton.focus();
  await page.keyboard.press("w");
  await expect(page.getByTestId("keyboard-count")).toHaveText("0");

  await diagnosticButton.press("Space");
  await expect(page.getByTestId("intent-count")).toHaveText("1");
  await expect(page.getByTestId("keyboard-count")).toHaveText("0");

  const canvas = page.getByLabel("RARPG Phaser diagnostic canvas");
  await canvas.focus();
  await page.keyboard.press("w");
  await expect(page.getByTestId("keyboard-count")).toHaveText("1");
  await expect(page.getByTestId("intent-count")).toHaveText("2");

  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Skip canvas" })).toBeFocused();
  await expect(page.getByTestId("keyboard-count")).toHaveText("1");
  await expect(page.getByTestId("intent-count")).toHaveText("2");
  await page.keyboard.press("w");
  await expect(page.getByTestId("keyboard-count")).toHaveText("1");
  await expect(page.getByTestId("intent-count")).toHaveText("2");

  await canvas.focus();
  await page.keyboard.press("Tab");
  await expect(diagnosticButton).toBeFocused();
  await expect(page.getByTestId("keyboard-count")).toHaveText("1");
  await expect(page.getByTestId("intent-count")).toHaveText("2");
  await page.keyboard.press("w");
  await expect(page.getByTestId("keyboard-count")).toHaveText("1");
  await expect(page.getByTestId("intent-count")).toHaveText("2");
  expect(failures).toEqual([]);
});

test("canvas resizes cleanly across supported desktop viewports", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await openReadyShell(page);

    await expect
      .poll(() =>
        page.evaluate(() => {
          const canvas =
            document.querySelector<HTMLCanvasElement>("#game-canvas");
          const host = document.querySelector<HTMLElement>("#game-host");
          if (canvas === null || host === null) {
            return null;
          }

          const canvasRect = canvas.getBoundingClientRect();
          const hostRect = host.getBoundingClientRect();
          return {
            horizontalOverflow:
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
            hostWidth: Math.round(hostRect.width),
            hostHeight: Math.round(hostRect.height),
            canvasWidth: Math.round(canvasRect.width),
            canvasHeight: Math.round(canvasRect.height),
            backingWidth: canvas.width,
            backingHeight: canvas.height,
            dpr: window.devicePixelRatio,
          };
        }),
      )
      .toMatchObject({
        horizontalOverflow: false,
      });

    const dimensions = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#game-canvas");
      const host = document.querySelector<HTMLElement>("#game-host");
      if (canvas === null || host === null) {
        throw new Error("UI shell canvas or host is missing.");
      }
      return {
        hostWidth: host.clientWidth,
        hostHeight: host.clientHeight,
        canvasWidth: Math.round(canvas.getBoundingClientRect().width),
        canvasHeight: Math.round(canvas.getBoundingClientRect().height),
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        dpr: window.devicePixelRatio,
      };
    });

    expect(dimensions.canvasWidth).toBe(dimensions.hostWidth);
    expect(dimensions.canvasHeight).toBe(dimensions.hostHeight);
    expect(dimensions.backingWidth).toBe(
      Math.round(dimensions.hostWidth * dimensions.dpr),
    );
    expect(dimensions.backingHeight).toBe(
      Math.round(dimensions.hostHeight * dimensions.dpr),
    );
  }

  expect(failures).toEqual([]);
});

test("canvas backing store follows device pixel ratio", async ({ browser }) => {
  const context = await browser.newContext({
    deviceScaleFactor: 2,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const failures = collectRuntimeFailures(page);

  try {
    await openReadyShell(page);
    const dimensions = await page
      .locator("#game-canvas")
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        return {
          cssWidth: Math.round(rect.width),
          cssHeight: Math.round(rect.height),
          backingWidth: canvas.width,
          backingHeight: canvas.height,
          dpr: window.devicePixelRatio,
        };
      });

    expect(dimensions.dpr).toBe(2);
    expect(dimensions.backingWidth).toBe(dimensions.cssWidth * 2);
    expect(dimensions.backingHeight).toBe(dimensions.cssHeight * 2);
    expect(failures).toEqual([]);
  } finally {
    await context.close();
  }
});

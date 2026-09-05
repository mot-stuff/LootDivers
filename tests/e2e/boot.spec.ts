import { expect, test } from "@playwright/test";

test("production build boots Phaser and the diagnostic shell", async ({
  page,
}) => {
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

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("boot-status")).toHaveText(
    "Technical isometric fixture ready",
  );
  await expect(page.getByText("fixture:technical-isometric")).toBeVisible();
  await expect(page.getByLabel("RARPG Phaser diagnostic canvas")).toBeVisible();
  await expect(page.getByText(/^WebGL 2/)).toBeVisible();

  const contextVersion = await page
    .getByLabel("RARPG Phaser diagnostic canvas")
    .evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext("webgl2");
      return context === null
        ? null
        : String(context.getParameter(context.VERSION));
    });

  expect(contextVersion).toMatch(/^WebGL 2/);
  expect(failures).toEqual([]);
});

test("cleans partial lifecycle resources when atlas loading fails", async ({
  page,
}) => {
  await page.route("**/assets/technical-entities.svg", async (route) => {
    await route.fulfill({ status: 500, body: "synthetic atlas failure" });
  });
  await page.goto("/?automation=1&fullFixture=1", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.locator("body")).toHaveAttribute(
    "data-app-state",
    "unsupported",
  );
  const diagnostics = await page.evaluate(
    () => window.__RARPG_FIXTURE_FAILURE__,
  );
  expect(diagnostics).toMatchObject({
    ready: false,
    disposed: true,
    atlasCount: 0,
    presentationObjects: 0,
    terrainChunks: 0,
    listenerCount: 0,
    atlasLoadErrorListeners: 0,
    simulation: null,
  });
});

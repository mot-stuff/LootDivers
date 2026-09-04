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

import { expect, test, type Page } from "@playwright/test";

import newsEntries from "../../src/home/news.json" with { type: "json" };

/**
 * TASK-708 (DEC-035) homepage coverage: "/" is a light multi-page entry
 * (no game code), news renders from the repo-owned src/home/news.json,
 * Play navigates into the game shell at /play/, and the auth forms
 * validate client-side and degrade gracefully while the TASK-707 API is
 * not live. The contract paths are proven against Playwright route mocks
 * of the Phase 8 v1 API (docs/tasks/PHASE8-KICKOFF.md §2).
 */

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

test("the homepage loads light with branding and repo-file news", async ({
  page,
}, testInfo) => {
  const failures = collectRuntimeFailures(page);
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Loot Divers");
  await expect(page.getByAltText("Loot Divers")).toBeVisible();
  await expect(page.getByTestId("home-play")).toBeVisible();
  await expect(page.getByTestId("home-play")).toHaveAttribute("href", "/play/");

  // Every news.json entry renders, newest first; publishing an entry only
  // requires editing that file.
  const entries = page.getByTestId("home-news-list").locator("li");
  await expect(entries).toHaveCount(newsEntries.length);
  const sortedTitles = [...newsEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) => entry.title);
  for (const [index, title] of sortedTitles.entries()) {
    await expect(entries.nth(index).locator("h3")).toHaveText(title);
  }

  // DEC-035: no Phaser on "/". The game ships in the "play" entry chunk,
  // so the homepage must never request it (or anything under /play/).
  const gameRequests = requestedUrls.filter((url) =>
    /phaser|\/play\/|assets\/play-/i.test(url),
  );
  expect(gameRequests, gameRequests.join("\n")).toEqual([]);

  await page.screenshot({
    path: `test-results/homepage/homepage-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(failures, failures.join("\n")).toEqual([]);
});

test("Play navigates into the game shell at /play/", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTestId("home-play").click();

  await expect(page).toHaveURL(/\/play\/$/);
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("main-menu")).toBeVisible();
  expect(failures, failures.join("\n")).toEqual([]);
});

test("auth forms validate email shape and password length client-side", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });

  const status = page.getByTestId("home-auth-status");
  await page.getByTestId("home-auth-submit").click();
  await expect(status).toHaveText("Enter a valid email address.");

  await page.getByTestId("home-auth-email").fill("not-an-email");
  await page.getByTestId("home-auth-password").fill("longenough");
  await page.getByTestId("home-auth-submit").click();
  await expect(status).toHaveText("Enter a valid email address.");

  await page.getByTestId("home-auth-email").fill("diver@example.com");
  await page.getByTestId("home-auth-password").fill("short");
  await page.getByTestId("home-auth-submit").click();
  await expect(status).toHaveText("Passwords must be at least 8 characters.");

  // Client-side rejections never reach the network.
  expect(apiRequests).toEqual([]);
});

test("auth forms fail soft while the account server is unavailable", async ({
  page,
}) => {
  await page.route("**/api/auth/**", (route) =>
    route.abort("connectionfailed"),
  );
  await page.goto("/", { waitUntil: "networkidle" });

  await page.getByTestId("home-auth-email").fill("diver@example.com");
  await page.getByTestId("home-auth-password").fill("longenough");
  await page.getByTestId("home-auth-submit").click();

  const status = page.getByTestId("home-auth-status");
  await expect(status).toContainText("account server isn't available yet");
  await expect(status).toHaveAttribute("data-tone", "error");
  // The page stays usable: Play remains a working escape hatch.
  await expect(page.getByTestId("home-play")).toBeVisible();
});

test("auth forms complete against the mocked v1 API contract", async ({
  page,
}) => {
  // Mock the §2 contract: signup succeeds (201 + auto-login), login
  // rejects with a contract error envelope that must surface readably.
  await page.route("**/api/auth/signup", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ userId: "00000000-0000-4000-8000-000000000001" }),
    }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "invalid_credentials",
          message: "Email or password is incorrect.",
        },
      }),
    }),
  );
  await page.goto("/", { waitUntil: "networkidle" });

  const status = page.getByTestId("home-auth-status");
  await page.getByTestId("home-auth-email").fill("diver@example.com");
  await page.getByTestId("home-auth-password").fill("wrong-password");
  await page.getByTestId("home-auth-submit").click();
  await expect(status).toHaveText("Email or password is incorrect.");

  await page.getByTestId("home-auth-tab-signup").click();
  await page.getByTestId("home-auth-email").fill("diver@example.com");
  await page.getByTestId("home-auth-password").fill("a-strong-password");
  await page.getByTestId("home-auth-submit").click();

  // Successful auth routes into the game shell.
  await expect(page).toHaveURL(/\/play\/$/);
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
});

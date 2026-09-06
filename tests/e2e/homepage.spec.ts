import { expect, test, type Page } from "@playwright/test";

import newsEntries from "../../src/home/news.json" with { type: "json" };

/**
 * TASK-708 (DEC-035) homepage coverage: "/" is a light multi-page entry
 * (no game code), news renders from the repo-owned src/home/news.json,
 * and the auth forms validate client-side and degrade gracefully. The
 * contract paths are proven against Playwright route mocks of the Phase 8
 * v1 API (docs/tasks/PHASE8-KICKOFF.md §2).
 *
 * TASK-716 (DEC-042): the hero CTA is session-aware. Signed out (or with
 * the API unreachable) the hero offers Create account / Log in into the
 * auth panel and no Play button; a mocked session shows Play now with a
 * signed-in hint and logout; a successful login/signup switches the CTA
 * in place without a reload.
 */

const SESSION = { userId: "user-1", email: "diver@example.com" };

function collectRuntimeFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

/** Mocks GET /auth/session; a null session answers 200 with no email so
 * the probe resolves signed-out without a console-visible error status. */
async function mockSession(
  page: Page,
  session: typeof SESSION | null,
): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(session ?? {}),
    }),
  );
}

test("the homepage loads light with branding, news, and account-first CTAs", async ({
  page,
}, testInfo) => {
  const failures = collectRuntimeFailures(page);
  const requestedUrls: string[] = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  await mockSession(page, null);

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Loot Divers");
  await expect(page.getByAltText("Loot Divers")).toBeVisible();

  // TASK-716: signed out there is no Play button — the primary CTA is
  // account creation, the secondary is login, both into the auth panel.
  await expect(page.getByTestId("home-play")).not.toBeVisible();
  const createAccount = page.getByTestId("home-create-account");
  await expect(createAccount).toBeVisible();
  await expect(createAccount).toHaveAttribute("href", "#home-account-heading");
  await expect(page.getByTestId("home-log-in")).toBeVisible();
  // The tagline no longer promises account-free play.
  await expect(page.locator(".home-play-note")).toHaveText(
    "Free in your browser. No download.",
  );

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

test("the signed-out CTAs open the auth panel in the matching mode", async ({
  page,
}) => {
  await mockSession(page, null);
  await page.goto("/", { waitUntil: "networkidle" });

  await page.getByTestId("home-create-account").click();
  await expect(page.getByTestId("home-auth-tab-signup")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("home-auth-email")).toBeFocused();

  await page.getByTestId("home-log-in").click();
  await expect(page.getByTestId("home-auth-tab-login")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("home-auth-email")).toBeFocused();
});

test("a live session shows Play now and it navigates into the game shell", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await mockSession(page, SESSION);
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByTestId("home-create-account")).not.toBeVisible();
  await expect(page.getByTestId("home-session")).toContainText(SESSION.email);
  const play = page.getByTestId("home-play");
  await expect(play).toBeVisible();
  await expect(play).toHaveAttribute("href", "/play/");

  await play.click();
  await expect(page).toHaveURL(/\/play\/$/);
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("main-menu")).toBeVisible();
  expect(failures, failures.join("\n")).toEqual([]);
});

test("logout on the homepage returns the hero to the account-first state", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await mockSession(page, SESSION);
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", (route) => {
    logoutRequests += 1;
    return route.fulfill({ status: 204 });
  });
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByTestId("home-play")).toBeVisible();
  await page.getByTestId("home-logout").click();

  await expect(page.getByTestId("home-play")).not.toBeVisible();
  await expect(page.getByTestId("home-create-account")).toBeVisible();
  expect(logoutRequests).toBe(1);
  expect(failures, failures.join("\n")).toEqual([]);
});

test("auth forms validate email shape and password length client-side", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const authSubmissions: string[] = [];
  page.on("request", (request) => {
    // The boot session probe is expected traffic (TASK-716); only actual
    // credential submissions count.
    if (/\/api\/auth\/(login|signup)/.test(request.url())) {
      authSubmissions.push(request.url());
    }
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
  expect(authSubmissions).toEqual([]);
});

test("auth forms fail soft while the account server is unavailable", async ({
  page,
}) => {
  await page.route("**/api/auth/**", (route) =>
    route.abort("connectionfailed"),
  );
  await page.goto("/", { waitUntil: "networkidle" });

  // The failed probe degrades to the signed-out state, not an error page.
  await expect(page.getByTestId("home-create-account")).toBeVisible();
  await expect(page.getByTestId("home-play")).not.toBeVisible();

  await page.getByTestId("home-auth-email").fill("diver@example.com");
  await page.getByTestId("home-auth-password").fill("longenough");
  await page.getByTestId("home-auth-submit").click();

  const status = page.getByTestId("home-auth-status");
  await expect(status).toContainText("account server is unreachable");
  await expect(status).toHaveAttribute("data-tone", "error");
});

test("auth forms complete against the mocked v1 API contract", async ({
  page,
}) => {
  // Mock the §2 contract: signup succeeds (201 + auto-login), login
  // rejects with a contract error envelope that must surface readably.
  await mockSession(page, null);
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

  // TASK-716: success switches the hero CTA to Play in place — no
  // navigation, no manual refresh.
  await expect(status).toHaveText("You're signed in — dive when ready.");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("home-play")).toBeVisible();
  await expect(page.getByTestId("home-session")).toContainText(
    "diver@example.com",
  );
  await expect(page.getByTestId("home-create-account")).not.toBeVisible();
});

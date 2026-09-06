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

/** API news entries for the TASK-721 live-feed tests. */
const API_NEWS = [
  {
    id: "00000000-0000-4000-8000-00000000n001",
    date: "2026-09-06",
    title: "Live from the server",
    body: "This entry came from GET /news, not the static file.",
    author: "Loot Divers Team",
    publishedAt: "2026-09-06T10:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-00000000n002",
    date: "2026-09-05",
    title: "An older live entry",
    body: "Published through the admin panel.",
    author: "Loot Divers Team",
    publishedAt: "2026-09-05T10:00:00.000Z",
  },
];

/**
 * Mocks GET /news (TASK-721): an empty feed keeps the console clean and
 * exercises the static-file fallback the older assertions rely on.
 */
async function mockNews(page: Page, entries: unknown[]): Promise<void> {
  await page.route("**/api/news", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(entries),
    }),
  );
}

async function mockHighscores(page: Page, rows: unknown[]): Promise<void> {
  await page.route("**/api/highscores", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(rows),
    }),
  );
}

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
  await mockNews(page, []);

  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Loot Divers");
  await expect(page.getByAltText("Loot Divers")).toBeVisible();

  // TASK-721: the admin entry never shows for signed-out visitors.
  await expect(page.getByTestId("home-admin-link")).toBeHidden();

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
  await mockNews(page, []);
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByTestId("home-create-account")).not.toBeVisible();
  await expect(page.getByTestId("home-session")).toContainText(SESSION.email);
  // TASK-721: a plain (non-admin) session never reveals the admin entry.
  await expect(page.getByTestId("home-admin-link")).toBeHidden();
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
  await mockNews(page, []);
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

// --- TASK-721 (DEC-047): news comes from the live feed with a static
// fallback, so admin panel edits go live without a deploy. -----------------

test("news renders from GET /news when the API answers", async ({ page }) => {
  const failures = collectRuntimeFailures(page);
  await mockSession(page, null);
  await mockNews(page, API_NEWS);
  await page.goto("/", { waitUntil: "networkidle" });

  const entries = page.getByTestId("home-news-list").locator("li");
  await expect(entries).toHaveCount(API_NEWS.length);
  await expect(entries.nth(0).locator("h3")).toHaveText("Live from the server");
  await expect(entries.nth(0)).toContainText(
    "This entry came from GET /news, not the static file.",
  );
  await expect(entries.nth(1).locator("h3")).toHaveText("An older live entry");
  expect(failures, failures.join("\n")).toEqual([]);
});

test("news falls back to the static file when the API is unreachable", async ({
  page,
}) => {
  await mockSession(page, null);
  await page.route("**/api/news", (route) => route.abort("connectionfailed"));
  await page.goto("/", { waitUntil: "networkidle" });

  // Every static news.json entry renders, newest first, exactly as before
  // the live feed existed.
  const entries = page.getByTestId("home-news-list").locator("li");
  await expect(entries).toHaveCount(newsEntries.length);
  const sortedTitles = [...newsEntries]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((entry) => entry.title);
  for (const [index, title] of sortedTitles.entries()) {
    await expect(entries.nth(index).locator("h3")).toHaveText(title);
  }
});

test("news titles and bodies render as text, never as markup", async ({
  page,
}) => {
  await mockSession(page, null);
  await mockNews(page, [
    {
      id: "00000000-0000-4000-8000-00000000x001",
      date: "2026-09-06",
      title: '<img src=x onerror="window.__xss=1">',
      body: "<script>window.__xss=2</script> stays inert text",
      author: "Loot Divers Team",
      publishedAt: "2026-09-06T10:00:00.000Z",
    },
  ]);
  await page.goto("/", { waitUntil: "networkidle" });

  const entry = page.getByTestId("home-news-list").locator("li").first();
  await expect(entry.locator("h3")).toHaveText(
    '<img src=x onerror="window.__xss=1">',
  );
  await expect(entry).toContainText("stays inert text");
  // The markup rendered as text nodes: no injected elements, no execution.
  await expect(entry.locator("img, script")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { __xss?: number }).__xss ?? null),
  ).toBeNull();
});

test("the dispatch panel tabs between news and highscores", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  await mockSession(page, null);
  await mockNews(page, []);
  await mockHighscores(page, [
    {
      rank: 1,
      name: "High Tide",
      class: "barbarian",
      level: 12,
      damage: 48,
    },
    {
      rank: 2,
      name: '<img src=x onerror="window.__hs=1">',
      class: "barbarian",
      level: 8,
      damage: 30,
    },
  ]);
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.getByTestId("home-news-panel")).toBeVisible();
  await expect(page.getByTestId("home-highscores-panel")).toBeHidden();

  await page.getByTestId("home-feed-tab-highscores").click();
  await expect(page.getByTestId("home-feed-tab-highscores")).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("home-news-panel")).toBeHidden();
  const board = page.getByTestId("home-highscores-list").locator("li");
  await expect(board).toHaveCount(2);
  await expect(board.first()).toContainText("High Tide");
  await expect(board.first()).toContainText("Lv 12");
  await expect(board.first()).toContainText("48 dmg");
  await expect(board.nth(1)).toHaveText(/<img src=x onerror="window\.__hs=1">/);
  await expect(board.nth(1).locator("img")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as { __hs?: number }).__hs ?? null),
  ).toBeNull();

  await page.getByTestId("home-feed-tab-news").click();
  await expect(page.getByTestId("home-news-panel")).toBeVisible();
  await expect(page.getByTestId("home-highscores-panel")).toBeHidden();
  expect(failures, failures.join("\n")).toEqual([]);
});

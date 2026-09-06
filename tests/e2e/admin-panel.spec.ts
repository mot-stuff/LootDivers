import { expect, test, type Page } from "@playwright/test";

/**
 * TASK-721 (DEC-047) admin panel coverage.
 *
 * Mocked flows: the homepage admin entry shows only for admin sessions,
 * "/admin/" denies non-admins, and the panel tools (lookup, ban/unban with
 * confirmation, save-rejection log, news manager) drive the TASK-720
 * (DEC-046) API contract through Playwright route mocks.
 *
 * The final test is the real-API journey against the MemoryStore dev
 * server (like the TASK-719 spec): promote a fresh signup via the dev-only
 * seam, look up an account, ban, unban, and publish news that then renders
 * on the public homepage. It skips when the API is not running.
 */

const ADMIN_SESSION = {
  userId: "user-1",
  email: "owner@example.com",
  isAdmin: true,
};
const PLAYER_SESSION = {
  userId: "user-2",
  email: "diver@example.com",
  isAdmin: false,
};

function json(status: number, body: unknown) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function mockSession(page: Page, session: unknown): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(json(200, session ?? {})),
  );
}

async function mockNews(page: Page, entries: unknown[]): Promise<void> {
  await page.route("**/api/news", (route) => route.fulfill(json(200, entries)));
}

async function mockRejections(
  page: Page,
  body: { recent: unknown[]; counts: unknown[] },
): Promise<void> {
  await page.route("**/api/admin/save-rejections*", (route) =>
    route.fulfill(json(200, body)),
  );
}

const EMPTY_REJECTIONS = { recent: [], counts: [] };

interface MockAccount {
  id: string;
  email: string;
  createdAt: string;
  bannedAt: string | null;
  banReason: string | null;
  isAdmin: boolean;
  characters: unknown[];
}

function mockAccount(overrides?: Partial<MockAccount>): MockAccount {
  return {
    id: "00000000-0000-4000-8000-0000000000aa",
    email: "diver@example.com",
    createdAt: "2026-09-01T09:00:00.000Z",
    bannedAt: null,
    banReason: null,
    isAdmin: false,
    characters: [
      {
        id: "00000000-0000-4000-8000-0000000000cc",
        name: "Rega the Bold",
        level: 7,
        zoneId: "zone:hearthmere",
        updatedAt: "2026-09-05T12:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

test("the homepage admin entry shows only for admin sessions and opens the panel", async ({
  page,
}) => {
  await mockSession(page, ADMIN_SESSION);
  await mockNews(page, []);
  await mockRejections(page, EMPTY_REJECTIONS);
  await page.goto("/", { waitUntil: "networkidle" });

  const adminLink = page.getByTestId("home-admin-link");
  await expect(adminLink).toBeVisible();
  await expect(adminLink).toHaveAttribute("href", "/admin/");

  await adminLink.click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(page.getByTestId("admin-panel")).toBeVisible();
  await expect(page.getByTestId("admin-gate")).toBeHidden();
  await expect(page.getByTestId("admin-session-email")).toContainText(
    ADMIN_SESSION.email,
  );
});

test("direct /admin/ navigation shows the access-required state for non-admins", async ({
  page,
}) => {
  // A signed-in but non-admin session: tools stay hidden.
  await mockSession(page, PLAYER_SESSION);
  await mockNews(page, []);
  await page.goto("/admin/", { waitUntil: "networkidle" });

  await expect(page.getByTestId("admin-panel")).toBeHidden();
  const gate = page.getByTestId("admin-gate");
  await expect(gate).toBeVisible();
  await expect(gate).toContainText("Admin access required");
  await expect(page.getByTestId("admin-gate-copy")).toContainText(
    "does not have administrator access",
  );

  // The header home link returns to the homepage.
  await page.getByTestId("admin-home-link").click();
  await expect(page).toHaveURL(/\/$/);
});

test("a signed-out /admin/ visit is denied and points back to the homepage login", async ({
  page,
}) => {
  await mockSession(page, null);
  await page.goto("/admin/", { waitUntil: "networkidle" });

  await expect(page.getByTestId("admin-panel")).toBeHidden();
  await expect(page.getByTestId("admin-gate")).toContainText(
    "Admin access required",
  );
  await expect(page.getByTestId("admin-gate-copy")).toContainText(
    "not signed in",
  );
});

test("account lookup renders the account, ban requires a confirmed reason, unban restores", async ({
  page,
}) => {
  await mockSession(page, ADMIN_SESSION);
  await mockNews(page, []);
  await mockRejections(page, EMPTY_REJECTIONS);

  // Lookup state machine: first GET answers the clean account, after the
  // ban POST it answers the banned account, after unban clean again.
  let banned = false;
  const banRequests: string[] = [];
  let unbanRequests = 0;
  await page.route("**/api/admin/accounts?email=*", (route) =>
    route.fulfill(
      json(
        200,
        banned
          ? mockAccount({
              bannedAt: "2026-09-06T08:00:00.000Z",
              banReason: "Repeated save tampering",
            })
          : mockAccount(),
      ),
    ),
  );
  await page.route("**/api/admin/accounts/*/ban", async (route) => {
    const body = route.request().postDataJSON() as { reason?: string };
    banRequests.push(body.reason ?? "");
    banned = true;
    await route.fulfill(
      json(200, {
        id: mockAccount().id,
        email: mockAccount().email,
        bannedAt: "2026-09-06T08:00:00.000Z",
        banReason: body.reason,
      }),
    );
  });
  await page.route("**/api/admin/accounts/*/unban", async (route) => {
    unbanRequests += 1;
    banned = false;
    await route.fulfill(
      json(200, {
        id: mockAccount().id,
        email: mockAccount().email,
        bannedAt: null,
        banReason: null,
      }),
    );
  });

  await page.goto("/admin/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("admin-panel")).toBeVisible();

  // Lookup shows the account card with characters and ban state.
  await page.getByTestId("admin-lookup-email").fill("diver@example.com");
  await page.getByTestId("admin-lookup-submit").click();
  await expect(page.getByTestId("admin-account-email")).toHaveText(
    "diver@example.com",
  );
  await expect(page.getByTestId("admin-ban-state")).toContainText(
    "In good standing",
  );
  await expect(page.getByTestId("admin-characters")).toContainText(
    "Rega the Bold — level 7",
  );

  // Ban is two-step: open the form, a reason is required, then confirm.
  await page.getByTestId("admin-ban-open").click();
  await page.getByTestId("admin-ban-confirm").click();
  await expect(page.getByTestId("admin-action-status")).toContainText(
    "A ban reason is required.",
  );
  expect(banRequests).toEqual([]);
  await page.getByTestId("admin-ban-reason").fill("Repeated save tampering");
  await page.getByTestId("admin-ban-confirm").click();
  await expect(page.getByTestId("admin-ban-state")).toContainText("BANNED");
  await expect(page.getByTestId("admin-ban-state")).toContainText(
    "Repeated save tampering",
  );
  expect(banRequests).toEqual(["Repeated save tampering"]);

  // Unban is two-step as well and returns the account to good standing.
  await page.getByTestId("admin-unban").click();
  await page.getByTestId("admin-unban-confirm").click();
  await expect(page.getByTestId("admin-ban-state")).toContainText(
    "In good standing",
  );
  expect(unbanRequests).toBe(1);
});

test("banning an admin surfaces the 409 target-is-admin error", async ({
  page,
}) => {
  await mockSession(page, ADMIN_SESSION);
  await mockNews(page, []);
  await mockRejections(page, EMPTY_REJECTIONS);
  await page.route("**/api/admin/accounts?email=*", (route) =>
    route.fulfill(json(200, mockAccount({ email: "other-admin@example.com" }))),
  );
  await page.route("**/api/admin/accounts/*/ban", (route) =>
    route.fulfill(
      json(409, {
        error: {
          code: "target-is-admin",
          message:
            "Admin accounts cannot be banned via the API; demote via CLI first.",
        },
      }),
    ),
  );

  await page.goto("/admin/", { waitUntil: "networkidle" });
  await page.getByTestId("admin-lookup-email").fill("other-admin@example.com");
  await page.getByTestId("admin-lookup-submit").click();
  await page.getByTestId("admin-ban-open").click();
  await page.getByTestId("admin-ban-reason").fill("attempted ban");
  await page.getByTestId("admin-ban-confirm").click();

  await expect(page.getByTestId("admin-action-status")).toContainText(
    "cannot be banned via the API",
  );
  // The account card stays in the unbanned state.
  await expect(page.getByTestId("admin-ban-state")).toContainText(
    "In good standing",
  );
});

test("the save-rejection log renders recent rows and per-account counts", async ({
  page,
}) => {
  await mockSession(page, ADMIN_SESSION);
  await mockNews(page, []);
  await mockRejections(page, {
    recent: [
      {
        userId: "user-9",
        email: "cheater@example.com",
        characterId: "00000000-0000-4000-8000-0000000000c9",
        code: "level-mismatch",
        createdAt: "2026-09-06T07:00:00.000Z",
      },
      {
        userId: "user-9",
        email: "cheater@example.com",
        characterId: "00000000-0000-4000-8000-0000000000c9",
        code: "invalid-save",
        createdAt: "2026-09-06T06:00:00.000Z",
      },
    ],
    counts: [{ userId: "user-9", email: "cheater@example.com", count: 2 }],
  });

  await page.goto("/admin/", { waitUntil: "networkidle" });
  const counts = page.getByTestId("admin-rejections-counts");
  await expect(counts).toContainText("cheater@example.com");
  await expect(counts).toContainText("2");
  const recent = page.getByTestId("admin-rejections-recent");
  await expect(recent.locator("tbody tr")).toHaveCount(2);
  await expect(recent).toContainText("level-mismatch");
  await expect(recent).toContainText("invalid-save");
});

test("the news manager lists, creates, edits, and deletes entries with confirmation", async ({
  page,
}) => {
  await mockSession(page, ADMIN_SESSION);
  await mockRejections(page, EMPTY_REJECTIONS);

  // A tiny in-mock news store: GET /news reads it, the admin routes write.
  const entries: {
    id: string;
    date: string;
    title: string;
    body: string;
    author: string;
    publishedAt: string;
  }[] = [
    {
      id: "00000000-0000-4000-8000-00000000n001",
      date: "2026-09-05",
      title: "Original entry",
      body: "Before the edit.",
      author: "Loot Divers Team",
      publishedAt: "2026-09-05T10:00:00.000Z",
    },
  ];
  await page.route("**/api/news", (route) => route.fulfill(json(200, entries)));
  await page.route("**/api/admin/news", async (route) => {
    const body = route.request().postDataJSON() as {
      title: string;
      body: string;
      author?: string;
    };
    const created = {
      id: `00000000-0000-4000-8000-00000000n00${String(entries.length + 1)}`,
      date: "2026-09-06",
      title: body.title,
      body: body.body,
      author: body.author ?? "Loot Divers Team",
      publishedAt: "2026-09-06T10:00:00.000Z",
    };
    entries.unshift(created);
    await route.fulfill(json(201, created));
  });
  await page.route("**/api/admin/news/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const index = entries.findIndex((entry) => entry.id === id);
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        title: string;
        body: string;
      };
      const existing = entries[index]!;
      entries[index] = { ...existing, title: body.title, body: body.body };
      await route.fulfill(json(200, entries[index]));
      return;
    }
    if (route.request().method() === "DELETE") {
      entries.splice(index, 1);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fallback();
  });

  await page.goto("/admin/", { waitUntil: "networkidle" });
  await expect(page.getByTestId("admin-news-entry")).toHaveCount(1);

  // Create.
  await page.getByTestId("admin-news-title").fill("Patch notes: the depths");
  await page
    .getByTestId("admin-news-body")
    .fill("New monsters stir below Hearthmere.");
  await page.getByTestId("admin-news-submit").click();
  await expect(page.getByTestId("admin-news-status")).toHaveText(
    "Entry published.",
  );
  await expect(page.getByTestId("admin-news-entry")).toHaveCount(2);
  await expect(page.getByTestId("admin-news-entry").first()).toContainText(
    "Patch notes: the depths",
  );

  // Edit: the form loads the entry, saving PUTs and re-renders.
  await page.getByTestId("admin-news-edit").last().click();
  await expect(page.getByTestId("admin-news-title")).toHaveValue(
    "Original entry",
  );
  await page.getByTestId("admin-news-title").fill("Original entry, revised");
  await page.getByTestId("admin-news-submit").click();
  await expect(page.getByTestId("admin-news-status")).toHaveText(
    "Entry updated.",
  );
  await expect(page.getByTestId("admin-news-entry").last()).toContainText(
    "Original entry, revised",
  );

  // Delete: two-step confirmation, then the entry is gone.
  await page.getByTestId("admin-news-delete").last().click();
  await page.getByTestId("admin-news-delete-confirm").last().click();
  await expect(page.getByTestId("admin-news-entry")).toHaveCount(1);
  await expect(page.getByTestId("admin-news-entry").first()).toContainText(
    "Patch notes: the depths",
  );
});

// --- Real-API journey (MemoryStore dev server; skips when not running) ----

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

async function signup(page: Page, email: string): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTestId("home-auth-tab-signup").click();
  await page.getByTestId("home-auth-email").fill(email);
  await page.getByTestId("home-auth-password").fill("a-strong-password");
  await page.getByTestId("home-auth-submit").click();
  await expect(page.getByTestId("home-play")).toBeVisible();
}

test("admin journey against the real API: promote, look up, ban, unban, publish news", async ({
  page,
}) => {
  test.skip(
    !(await apiUp()),
    "dev API not running (server: npm run dev:memory)",
  );
  test.setTimeout(120_000);
  await proxyApi(page);

  const stamp = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
  const victimEmail = `t721-victim-${stamp}@example.test`;
  const adminEmail = `t721-admin-${stamp}@example.test`;

  // A player account to moderate, then log out.
  await signup(page, victimEmail);
  await page.getByTestId("home-logout").click();
  await expect(page.getByTestId("home-create-account")).toBeVisible();

  // The admin account, promoted through the dev-only MemoryStore seam
  // (production grants admin via CLI only, DEC-046).
  await signup(page, adminEmail);
  const promoted = await fetch(`${API}/dev/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail }),
  });
  expect(promoted.status).toBe(200);

  // A reload re-probes the session: the admin entry appears.
  await page.reload({ waitUntil: "networkidle" });
  const adminLink = page.getByTestId("home-admin-link");
  await expect(adminLink).toBeVisible();
  await adminLink.click();
  await expect(page.getByTestId("admin-panel")).toBeVisible();

  // Look up the player, ban with a reason, verify, unban, verify.
  await page.getByTestId("admin-lookup-email").fill(victimEmail);
  await page.getByTestId("admin-lookup-submit").click();
  await expect(page.getByTestId("admin-account-email")).toHaveText(victimEmail);
  await page.getByTestId("admin-ban-open").click();
  await page.getByTestId("admin-ban-reason").fill("Save tampering (test)");
  await page.getByTestId("admin-ban-confirm").click();
  await expect(page.getByTestId("admin-ban-state")).toContainText("BANNED");
  await page.getByTestId("admin-unban").click();
  await page.getByTestId("admin-unban-confirm").click();
  await expect(page.getByTestId("admin-ban-state")).toContainText(
    "In good standing",
  );

  // Publish news through the panel…
  const newsTitle = `Depths report ${stamp}`;
  await page.getByTestId("admin-news-title").fill(newsTitle);
  await page
    .getByTestId("admin-news-body")
    .fill("Fresh from the admin panel journey test.");
  await page.getByTestId("admin-news-submit").click();
  await expect(page.getByTestId("admin-news-status")).toHaveText(
    "Entry published.",
  );

  // …and the public homepage now serves it from GET /news.
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.getByTestId("home-news-list").locator("li").first(),
  ).toContainText(newsTitle);
});

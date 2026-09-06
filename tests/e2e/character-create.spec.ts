import { expect, test, type Page } from "@playwright/test";

/**
 * TASK-709 account-aware menu flows against a Playwright route mock of the
 * Phase 8 §2 contract (the packet-accepted stand-in until the QA pass hits
 * the real droplet). `?accountTest` points the menu at the same-origin
 * `/api` base these routes intercept — on 127.0.0.1 the real session probe
 * is deliberately skipped (DEC-036 custom-domain-only policy), and plain
 * `/play/` loads stay purely local, which the last test pins down.
 *
 * TASK-714 (DEC-040): under the gate, a signed-out visitor gets the
 * account-required screen instead of any local play, character select gains
 * a logout button, and an unreachable character list offers retry/homepage
 * rather than falling back to local play.
 */

const SESSION = { userId: "user-1", email: "diver@example.com" };

interface MockCharacter {
  id: string;
  name: string;
  class: string;
  level: number;
  updatedAt: string;
  envelope: unknown;
}

interface SavePut {
  id: string;
  envelope: { payload?: { character?: { zoneId?: string } } };
  level: number;
}

interface MockAccountApi {
  characters: MockCharacter[];
  savePuts: SavePut[];
  createRequests: number;
  deleteRequests: string[];
  /** When set, POST /characters answers with this contract error. */
  createError?: { status: number; code: string; message: string };
}

function mockCharacter(
  id: string,
  name: string,
  overrides?: Partial<MockCharacter>,
): MockCharacter {
  return {
    id,
    name,
    class: "barbarian",
    level: 1,
    updatedAt: "2026-09-05T12:00:00.000Z",
    envelope: null,
    ...overrides,
  };
}

function json(status: number, body: unknown) {
  return {
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  };
}

async function installAccountMock(
  page: Page,
  state: MockAccountApi,
): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(json(200, SESSION)),
  );
  // TASK-721: the homepage now fetches GET /news on load; answer an empty
  // feed so tests that land on "/" keep a quiet console (empty falls back
  // to the static news.json).
  await page.route("**/api/news", (route) => route.fulfill(json(200, [])));
  await page.route("**/api/characters", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill(
        json(
          200,
          state.characters.map((entry) => ({
            id: entry.id,
            name: entry.name,
            class: entry.class,
            level: entry.level,
            updatedAt: entry.updatedAt,
          })),
        ),
      );
      return;
    }
    if (method === "POST") {
      state.createRequests += 1;
      if (state.createError !== undefined) {
        const { status, code, message } = state.createError;
        await route.fulfill(json(status, { error: { code, message } }));
        return;
      }
      const body = route.request().postDataJSON() as {
        name: string;
        class: string;
      };
      const id = `char-${String(state.characters.length + 1)}`;
      state.characters.push(mockCharacter(id, body.name));
      await route.fulfill(json(201, { id }));
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/characters/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "";
    const character = state.characters.find((entry) => entry.id === id);
    const method = route.request().method();
    if (method === "GET") {
      if (character === undefined) {
        await route.fulfill(
          json(404, { error: { code: "not-found", message: "No such hero." } }),
        );
        return;
      }
      await route.fulfill(json(200, character));
      return;
    }
    if (method === "DELETE") {
      state.deleteRequests.push(id);
      state.characters = state.characters.filter((entry) => entry.id !== id);
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/characters/*/save", async (route) => {
    const segments = new URL(route.request().url()).pathname.split("/");
    const id = segments[segments.length - 2] ?? "";
    const body = route.request().postDataJSON() as {
      envelope: SavePut["envelope"];
      level: number;
    };
    state.savePuts.push({ id, envelope: body.envelope, level: body.level });
    const character = state.characters.find((entry) => entry.id === id);
    if (character !== undefined) {
      character.envelope = body.envelope;
      character.level = body.level;
    }
    await route.fulfill(json(200, { revision: state.savePuts.length }));
  });
}

function freshMockState(characters: MockCharacter[] = []): MockAccountApi {
  return {
    characters,
    savePuts: [],
    createRequests: 0,
    deleteRequests: [],
  };
}

function collectRuntimeFailures(page: Page, ignore?: RegExp): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (ignore?.test(message.text()) === true) return;
    failures.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => failures.push(`page: ${error.message}`));
  return failures;
}

async function menuReady(page: Page): Promise<void> {
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("main-menu")).toBeVisible();
}

test("a signed-in session lists heroes and create flows into the tutorial with server saves", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  const state = freshMockState();
  await installAccountMock(page, state);
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);

  // The account select replaces the local actions wholesale.
  await expect(page.getByTestId("account-select")).toBeVisible();
  await expect(page.getByTestId("account-email")).toContainText(SESSION.email);
  await expect(page.getByTestId("account-empty")).toBeVisible();
  await expect(page.getByTestId("main-menu-new-game")).toHaveCount(0);

  // Create screen: class card, original description, animated idle preview.
  await page.getByTestId("account-create-open").click();
  await expect(page.getByTestId("account-class-card")).toContainText(
    "Barbarian",
  );
  await expect(page.getByTestId("account-class-card")).toContainText(
    "Storm-bred",
  );
  const preview = page.getByTestId("account-create-preview");
  await expect(preview).toBeVisible();
  const animation = await preview.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      name: style.animationName,
      image: style.backgroundImage,
      playState: style.animationPlayState,
    };
  });
  expect(animation.name).toBe("barbarian-idle-preview");
  expect(animation.image).toContain("/assets/characters/diver/Idle.png");
  expect(animation.playState).toBe("running");
  // The flipbook visibly advances: the background x-offset changes between
  // two samples one frame-step apart.
  const offsetA = await preview.evaluate(
    (element) => getComputedStyle(element).backgroundPositionX,
  );
  await expect
    .poll(() =>
      preview.evaluate(
        (element) => getComputedStyle(element).backgroundPositionX,
      ),
    )
    .not.toBe(offsetA);

  // DEC-036 name validation is client-side: no request leaves the page.
  const nameInput = page.getByTestId("account-create-name");
  for (const invalid of ["1Rega", "Rega--Bold", "ab"]) {
    await nameInput.fill(invalid);
    await page.getByTestId("account-create-submit").click();
    await expect(page.getByTestId("account-create-error")).toContainText(
      "3-16 characters",
    );
  }
  expect(state.createRequests).toBe(0);

  // A valid name creates the character and enters the tutorial like New
  // Game (fresh characters have no envelope).
  await nameInput.fill("Rega the Bold");
  await page.getByTestId("account-create-submit").click();
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Wakeshore Landing",
  );
  await expect(page.getByTestId("combat-tutorial")).toBeVisible();
  await expect(page.getByTestId("combat-tutorial-prompt")).toHaveText(
    "Move with W, A, S, and D.",
  );

  // The save pipeline now targets the server: the tutorial travel's
  // autosave lands as a PUT for the new character row.
  await expect
    .poll(() => state.savePuts.length, {
      message: "the tutorial travel should persist a server save",
    })
    .toBeGreaterThan(0);
  const lastSave = state.savePuts[state.savePuts.length - 1]!;
  expect(lastSave.id).toBe("char-1");
  expect(lastSave.envelope.payload?.character?.zoneId).toBe(
    "zone:wakeshore-landing",
  );

  expect(failures, failures.join("\n")).toEqual([]);
});

test("selecting an existing hero restores the server envelope round trip", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  const state = freshMockState();
  await installAccountMock(page, state);
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);

  // Session one: create a hero and move it off the tutorial zone so the
  // saved state is distinguishable from a fresh start.
  await page.getByTestId("account-create-open").click();
  await page.getByTestId("account-create-name").fill("Rega the Bold");
  await page.getByTestId("account-create-submit").click();
  await expect(page.getByTestId("combat-zone")).toContainText(
    "Wakeshore Landing",
  );
  await expect.poll(() => state.savePuts.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.__RARPG_COMBAT_TEST__?.travelTo("zone:hearthmere");
  });
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect
    .poll(
      () =>
        state.savePuts[state.savePuts.length - 1]?.envelope.payload?.character
          ?.zoneId ?? null,
      { message: "the Hearthmere travel should persist a server save" },
    )
    .toBe("zone:hearthmere");

  // Session two: a fresh boot lists the hero; selecting it must restore
  // the server envelope (Hearthmere), not run the fresh tutorial path.
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);
  const entry = page.getByTestId("account-character-select");
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText("Rega the Bold");
  await entry.click();
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");
  await expect(page.getByTestId("combat-tutorial")).toHaveCount(0);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("duplicate-name conflicts surface inline on the create screen", async ({
  page,
}) => {
  // The intentional 409 emits a browser-level "Failed to load resource"
  // console error; only unexpected failures should fail the test.
  const failures = collectRuntimeFailures(page, /status of 409/);
  const state = freshMockState([mockCharacter("char-1", "Rega the Bold")]);
  state.createError = {
    status: 409,
    code: "duplicate-name",
    message: "You already have a hero with that name.",
  };
  await installAccountMock(page, state);
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);

  await page.getByTestId("account-create-open").click();
  await page.getByTestId("account-create-name").fill("Rega The Bold");
  await page.getByTestId("account-create-submit").click();
  await expect(page.getByTestId("account-create-error")).toHaveText(
    "You already have a hero with that name.",
  );
  // The menu stays open on the create screen for another attempt.
  await expect(page.getByTestId("account-create")).toBeVisible();
  expect(state.createRequests).toBe(1);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("the slot limit locks creation until a hero is deleted with typed confirmation", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  const state = freshMockState([
    mockCharacter("char-1", "Rega the Bold", { level: 7 }),
    mockCharacter("char-2", "Ash"),
    mockCharacter("char-3", "D'Marr"),
    mockCharacter("char-4", "Kel-Vren"),
  ]);
  await installAccountMock(page, state);
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);

  await expect(page.getByTestId("account-character-select")).toHaveCount(4);
  await expect(page.getByTestId("account-create-open")).toBeDisabled();
  await expect(page.getByTestId("account-slot-note")).toContainText(
    "slots are full",
  );

  // Typed confirmation: the destructive button arms only on an exact name.
  await page.getByRole("button", { name: "Delete Rega the Bold" }).click();
  const confirm = page.getByTestId("account-delete-submit");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("account-delete-input").fill("rega the bold");
  await expect(confirm).toBeDisabled();
  await page.getByTestId("account-delete-input").fill("Rega the Bold");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByTestId("account-character-select")).toHaveCount(3);
  await expect(page.getByTestId("account-slot-note")).toHaveCount(0);
  await expect(page.getByTestId("account-create-open")).toBeEnabled();
  expect(state.deleteRequests).toEqual(["char-1"]);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("an unreachable character list shows the service gate and retry recovers", async ({
  page,
}) => {
  const state = freshMockState([
    mockCharacter("char-1", "Rega the Bold", { level: 7 }),
  ]);
  await installAccountMock(page, state);
  // The session resolves but the character list dies on the network until
  // the test flips the switch; fallback() reaches the working mock above.
  let listDown = true;
  await page.route("**/api/characters", async (route) => {
    if (listDown && route.request().method() === "GET") {
      await route.abort("failed");
      return;
    }
    await route.fallback();
  });
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);

  // DEC-040: no local play behind the gate — the unreachable screen offers
  // retry and the homepage, never New Game.
  await expect(page.getByTestId("account-unavailable")).toContainText(
    "unreachable",
  );
  await expect(page.getByTestId("account-select")).toHaveCount(0);
  await expect(page.getByTestId("main-menu-new-game")).toHaveCount(0);
  await expect(page.getByTestId("account-gate-home")).toHaveAttribute(
    "href",
    "/",
  );

  // Retry recovers into character select once the API answers again.
  listDown = false;
  await page.getByTestId("account-retry").click();
  await expect(page.getByTestId("account-select")).toBeVisible();
  await expect(page.getByTestId("account-character-select")).toHaveCount(1);
});

test("a signed-out visitor is gated behind the account-required screen", async ({
  page,
}) => {
  // The intentional 401 probe emits a browser-level resource error; only
  // unexpected failures should fail the test.
  const failures = collectRuntimeFailures(page, /status of 401/);
  await page.route("**/api/auth/session", (route) =>
    route.fulfill(
      json(401, { error: { code: "unauthorized", message: "Not signed in." } }),
    ),
  );
  // The homepage landing fetches GET /news (TASK-721); keep it quiet.
  await page.route("**/api/news", (route) => route.fulfill(json(200, [])));
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);

  // DEC-040: no local menu, no playable state — only the gate.
  await expect(page.getByTestId("account-required")).toBeVisible();
  await expect(page.getByTestId("main-menu-new-game")).toHaveCount(0);
  await expect(page.getByTestId("main-menu-continue")).toHaveCount(0);
  await expect(page.getByTestId("account-select")).toHaveCount(0);

  // The homepage CTA lands on the real homepage where auth lives; still
  // signed out, it offers the account-first CTA (TASK-716).
  const home = page.getByTestId("account-required-home");
  await expect(home).toHaveAttribute("href", "/");
  await home.click();
  await expect(page.getByTestId("home-create-account")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  expect(failures, failures.join("\n")).toEqual([]);
});

test("logout ends the session and returns to the homepage", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  const state = freshMockState([
    mockCharacter("char-1", "Rega the Bold", { level: 7 }),
  ]);
  await installAccountMock(page, state);
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);
  await expect(page.getByTestId("account-select")).toBeVisible();

  await page.getByTestId("account-logout").click();
  await expect(page.getByTestId("home-play")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");
  expect(logoutRequests).toBe(1);

  expect(failures, failures.join("\n")).toEqual([]);
});

test("Back to Home returns from character select and creation without logging out", async ({
  page,
}) => {
  const failures = collectRuntimeFailures(page);
  const state = freshMockState([
    mockCharacter("char-1", "Rega the Bold", { level: 7 }),
  ]);
  await installAccountMock(page, state);
  let logoutRequests = 0;
  await page.route("**/api/auth/logout", async (route) => {
    logoutRequests += 1;
    await route.fulfill({ status: 204 });
  });

  // Character select: the home link is plain navigation — the session
  // survives, so the homepage greets the signed-in state (TASK-721).
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);
  const selectHome = page.getByTestId("account-select-home");
  await expect(selectHome).toHaveAttribute("href", "/");
  await selectHome.click();
  await expect(page.getByTestId("home-play")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  // Character creation: same control, same behavior.
  await page.goto("/play/?accountTest", { waitUntil: "networkidle" });
  await menuReady(page);
  await page.getByTestId("account-create-open").click();
  await expect(page.getByTestId("account-create")).toBeVisible();
  const createHome = page.getByTestId("account-create-home");
  await expect(createHome).toHaveAttribute("href", "/");
  await createHome.click();
  await expect(page.getByTestId("home-play")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/");

  // No logout ever fired — going home is not signing out.
  expect(logoutRequests).toBe(0);
  expect(failures, failures.join("\n")).toEqual([]);
});

test("plain local loads and ?autostart never touch the account API", async ({
  page,
}) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });

  // The loopback dev door (DEC-040): the local menu, no account gate, no
  // account section, no API traffic (DEC-036 custom-domain-only policy).
  await page.goto("/play/", { waitUntil: "networkidle" });
  await menuReady(page);
  await expect(page.getByTestId("main-menu-new-game")).toBeEnabled();
  await expect(page.getByTestId("main-menu-continue")).toBeVisible();
  await expect(page.getByTestId("account-required")).toHaveCount(0);
  await expect(page.getByTestId("account-select")).toHaveCount(0);

  // The automation path skips the menu and stays purely local too.
  await page.goto("/play/?autostart", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toHaveAttribute("data-app-state", "ready");
  await expect(page.getByTestId("main-menu")).toHaveCount(0);
  await expect(page.getByTestId("combat-zone")).toContainText("Hearthmere");

  expect(apiRequests).toEqual([]);
});

/**
 * Loot Divers homepage (TASK-708 / DEC-035).
 *
 * The "/" entry of the multi-page build: branding, news, auth forms, and
 * the Play link into "/play/". Deliberately light — no Phaser, no Preact,
 * no game code.
 *
 * TASK-721 (DEC-047): news renders from the public GET /news feed so the
 * admin panel's edits go live without a deploy; the repo-owned JSON file
 * remains the fallback when the API is unreachable or the feed is empty.
 * The session probe also carries `isAdmin`, which only toggles the admin
 * panel link's visibility — the server is the real gate on every admin
 * route.
 *
 * The auth forms target the Phase 8 v1 API contract
 * (docs/tasks/PHASE8-KICKOFF.md §2): POST /auth/login and /auth/signup
 * with JSON bodies and cookie credentials; e2e specs mock the endpoints
 * to prove the success and server-error paths.
 *
 * TASK-716 (DEC-042): an account is required to play, so the hero CTA is
 * session-aware. On load the page probes GET /auth/session; signed-out
 * visitors get account-first CTAs into the auth panel (no Play button that
 * would dead-end on the /play/ account-required screen), signed-in
 * visitors get Play plus a signed-in hint with logout, and a successful
 * login/signup switches the CTA in place without a reload. An unreachable
 * API degrades to the signed-out state — /play/ remains the backstop.
 */
import newsEntries from "./news.json";

import { apiBaseForHost } from "./api-base";

import "./home.css";

interface NewsEntry {
  readonly date: string;
  readonly title: string;
  readonly body: string;
}

type AuthMode = "login" | "signup";

const SERVER_UNAVAILABLE_MESSAGE =
  "The account server is unreachable right now. Try again in a moment — " +
  "an account is needed to dive.";

export { apiBaseForHost };

export function validateCredentials(
  email: string,
  password: string,
): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  if (password.length < 8) {
    return "Passwords must be at least 8 characters.";
  }
  return null;
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Homepage mount point "${selector}" is missing.`);
  }
  return element;
}

function isNewsEntry(value: unknown): value is NewsEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["date"] === "string" &&
    typeof entry["title"] === "string" &&
    typeof entry["body"] === "string"
  );
}

/**
 * TASK-721 (DEC-047): the live feed is the source of truth; the repo-owned
 * news.json is the fallback for an unreachable API, a malformed response,
 * or an empty feed (nothing has been published through the panel yet).
 */
async function loadNewsEntries(): Promise<readonly NewsEntry[]> {
  const fallback = newsEntries as readonly NewsEntry[];
  try {
    const response = await fetch(
      `${apiBaseForHost(window.location.hostname)}/news`,
    );
    if (!response.ok) return fallback;
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return fallback;
    const entries = body.filter((entry) => isNewsEntry(entry));
    return entries.length > 0 ? entries : fallback;
  } catch {
    return fallback;
  }
}

function renderNews(
  list: HTMLOListElement,
  source: readonly NewsEntry[],
): void {
  list.replaceChildren();
  const entries = [...source].sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "home-news-entry";

    const time = document.createElement("time");
    time.dateTime = entry.date;
    time.textContent = entry.date;

    const title = document.createElement("h3");
    title.textContent = entry.title;

    const body = document.createElement("p");
    body.textContent = entry.body;

    item.append(time, title, body);
    list.append(item);
  }
}

type StatusTone = "error" | "info" | "success";

function setStatus(
  status: HTMLParagraphElement,
  tone: StatusTone,
  message: string,
): void {
  status.dataset["tone"] = tone;
  status.textContent = message;
}

async function submitCredentials(
  mode: AuthMode,
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let response: Response;
  try {
    response = await fetch(
      `${apiBaseForHost(window.location.hostname)}/auth/${mode}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
    );
  } catch {
    return { ok: false, message: SERVER_UNAVAILABLE_MESSAGE };
  }
  if (response.ok) {
    return { ok: true };
  }
  // Contract errors carry { error: { code, message } }. Anything else
  // (static-host 404/405, gateway 5xx) means the API is not reachable.
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
    };
    const message = payload.error?.message;
    if (typeof message === "string" && message !== "") {
      return { ok: false, message };
    }
  } catch {
    // Non-JSON body: fall through to the unavailable message.
  }
  return { ok: false, message: SERVER_UNAVAILABLE_MESSAGE };
}

// TASK-716 (DEC-042) session-aware hero CTA. ------------------------------

interface HomeSession {
  readonly email: string;
  /** TASK-721: display gating only — every admin route 401/403s server-side. */
  readonly isAdmin: boolean;
}

/**
 * Probes the v1 session endpoint. Anything but a 200 with an email —
 * signed out, static-host 404, network failure — resolves null, which
 * leaves the page in its default signed-out state.
 */
async function probeSession(): Promise<HomeSession | null> {
  try {
    const response = await fetch(
      `${apiBaseForHost(window.location.hostname)}/auth/session`,
      { credentials: "include" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as {
      email?: unknown;
      isAdmin?: unknown;
    };
    return typeof body.email === "string" && body.email !== ""
      ? { email: body.email, isAdmin: body.isAdmin === true }
      : null;
  } catch {
    return null;
  }
}

/** Swaps the hero between the account-first and Play CTA states. */
function applySessionUi(session: HomeSession | null): void {
  requireElement<HTMLElement>(".home-cta-signed-out").hidden = session !== null;
  requireElement<HTMLElement>(".home-cta-signed-in").hidden = session === null;
  // The admin entry shows only for admin sessions (TASK-721, DEC-047); this
  // is pure display gating — the /admin/ page and every admin API route
  // re-check the session server-side.
  requireElement<HTMLAnchorElement>(".home-admin-link").hidden =
    session === null || !session.isAdmin;
  if (session !== null) {
    requireElement<HTMLSpanElement>(".home-session-email").textContent =
      session.email;
  }
}

/**
 * The signed-out CTAs select the matching auth tab and focus the email
 * field, which scrolls the account panel into view. The fragment href
 * stays as a no-JS fallback; with JS the default jump is suppressed so it
 * cannot steal the focus back.
 */
function wireHeroCta(setAuthMode: (mode: AuthMode) => void): void {
  const wire = (selector: string, mode: AuthMode): void => {
    requireElement<HTMLAnchorElement>(selector).addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        setAuthMode(mode);
      },
    );
  };
  wire(".home-create-account", "signup");
  wire(".home-login-link", "login");
}

/**
 * Logout ends the session server-side (the cookie is HttpOnly), then
 * returns the hero to the signed-out state. A network failure keeps the
 * session and surfaces the unavailable message in the auth status line.
 */
function wireLogout(): void {
  const button = requireElement<HTMLButtonElement>(".home-logout");
  button.addEventListener("click", () => {
    button.disabled = true;
    void (async () => {
      try {
        const response = await fetch(
          `${apiBaseForHost(window.location.hostname)}/auth/logout`,
          { method: "POST", credentials: "include" },
        );
        if (!response.ok) throw new Error(`status ${String(response.status)}`);
        applySessionUi(null);
      } catch {
        setStatus(
          requireElement<HTMLParagraphElement>(".home-auth-status"),
          "error",
          SERVER_UNAVAILABLE_MESSAGE,
        );
      } finally {
        button.disabled = false;
      }
    })();
  });
}

function wireAuthForms(
  onAuthenticated: (email: string) => void,
): (mode: AuthMode) => void {
  const form = requireElement<HTMLFormElement>(".home-auth-form");
  const email = requireElement<HTMLInputElement>("#home-auth-email");
  const password = requireElement<HTMLInputElement>("#home-auth-password");
  const submit = requireElement<HTMLButtonElement>(".home-auth-submit");
  const status = requireElement<HTMLParagraphElement>(".home-auth-status");
  const tabs = [
    ...document.querySelectorAll<HTMLButtonElement>(".home-auth-tab"),
  ];

  let mode: AuthMode = "login";
  const applyMode = (next: AuthMode): void => {
    mode = next;
    submit.textContent = next === "login" ? "Log in" : "Create account";
    password.autocomplete =
      next === "login" ? "current-password" : "new-password";
    for (const tab of tabs) {
      tab.setAttribute("aria-selected", String(tab.dataset["mode"] === next));
    }
    setStatus(status, "info", "");
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const requested = tab.dataset["mode"];
      if (requested === "login" || requested === "signup") {
        applyMode(requested);
      }
    });
  }
  applyMode("login");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const invalid = validateCredentials(email.value.trim(), password.value);
    if (invalid !== null) {
      setStatus(status, "error", invalid);
      return;
    }
    submit.disabled = true;
    setStatus(status, "info", "Contacting the account server…");
    const submittedEmail = email.value.trim();
    void submitCredentials(mode, submittedEmail, password.value).then(
      (result) => {
        submit.disabled = false;
        if (result.ok) {
          // TASK-716: no auto-navigation — the hero CTA switches to Play
          // in place and the visitor dives when ready.
          setStatus(status, "success", "You're signed in — dive when ready.");
          onAuthenticated(submittedEmail);
          return;
        }
        setStatus(status, "error", result.message);
      },
    );
  });

  return (next) => {
    applyMode(next);
    email.focus();
  };
}

void loadNewsEntries().then((entries) => {
  renderNews(requireElement<HTMLOListElement>(".home-news-list"), entries);
});
const setAuthMode = wireAuthForms((email) => {
  // Switch the hero immediately, then re-probe so an admin session also
  // reveals the admin entry without a reload.
  applySessionUi({ email, isAdmin: false });
  void probeSession().then((session) => {
    if (session !== null) applySessionUi(session);
  });
});
wireHeroCta(setAuthMode);
wireLogout();
void probeSession().then((session) => {
  if (session !== null) applySessionUi(session);
});

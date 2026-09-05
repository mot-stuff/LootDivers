/**
 * Loot Divers homepage (TASK-708 / DEC-035).
 *
 * The "/" entry of the multi-page build: branding, news, auth forms, and
 * the Play link into "/play/". Deliberately light — no Phaser, no Preact,
 * no game code. News is a repo-owned JSON file imported at build time, so
 * the owner publishes an entry by editing that file and pushing.
 *
 * The auth forms target the Phase 8 v1 API contract
 * (docs/tasks/PHASE8-KICKOFF.md §2): POST /auth/login and /auth/signup
 * with JSON bodies and cookie credentials. The API (TASK-707) is built in
 * parallel, so until it is live every real submission lands in the
 * graceful "server unavailable" state below; e2e specs mock the endpoints
 * to prove the success and server-error paths.
 */
import newsEntries from "./news.json";

import "./home.css";

interface NewsEntry {
  readonly date: string;
  readonly title: string;
  readonly body: string;
}

type AuthMode = "login" | "signup";

const SERVER_UNAVAILABLE_MESSAGE =
  "The account server isn't available yet. You can still play — your " +
  "progress saves locally in this browser.";

/**
 * Resolves the account API base URL (v1 contract: the API lives at
 * `api.<domain>` of the custom-domain origin). On localhost and
 * *.pages.dev there is no account API — the same-origin "/api" base fails
 * soft into the server-unavailable state and gives Playwright a stable
 * path to mock.
 */
export function apiBaseForHost(hostname: string): string {
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".pages.dev")
  ) {
    return "/api";
  }
  return `https://api.${hostname.replace(/^www\./, "")}`;
}

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

function renderNews(list: HTMLOListElement): void {
  const entries = [...(newsEntries as readonly NewsEntry[])].sort((a, b) =>
    b.date.localeCompare(a.date),
  );
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

function wireAuthForms(): void {
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
    void submitCredentials(mode, email.value.trim(), password.value).then(
      (result) => {
        submit.disabled = false;
        if (result.ok) {
          setStatus(status, "success", "Welcome back — loading the game…");
          window.location.assign("/play/");
          return;
        }
        setStatus(status, "error", result.message);
      },
    );
  });
}

renderNews(requireElement<HTMLOListElement>(".home-news-list"));
wireAuthForms();

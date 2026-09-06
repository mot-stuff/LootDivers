/**
 * Loot Divers admin panel (TASK-721, DEC-047): the "/admin/" entry of the
 * multi-page build. Owner tools over the TASK-720 (DEC-046) admin API —
 * account lookup, ban/unban, the save-rejection audit signal, and the
 * news manager behind the homepage's live feed.
 *
 * Access model: the page probes GET /auth/session and reveals the tools
 * only when `isAdmin` is true — but that is DISPLAY gating. The server is
 * the real gate: every /admin/* route re-checks the session and answers
 * 401/403 regardless of what this page shows.
 *
 * All admin-entered and API-returned text renders through `textContent`
 * (never innerHTML) — news bodies are plain text/markdown and injecting
 * them as HTML would be an XSS.
 */
import { apiBaseForHost } from "../home/api-base";

import "../home/home.css";
import "./admin.css";

const API_BASE = apiBaseForHost(window.location.hostname);

interface AccountCharacter {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly zoneId: string;
  readonly updatedAt: string;
}

interface AccountSummary {
  readonly id: string;
  readonly email: string;
  readonly createdAt: string;
  readonly bannedAt: string | null;
  readonly banReason: string | null;
  readonly isAdmin: boolean;
  readonly characters: readonly AccountCharacter[];
}

interface SaveRejectionRow {
  readonly userId: string;
  readonly email: string;
  readonly characterId: string;
  readonly code: string;
  readonly createdAt: string;
}

interface SaveRejectionCount {
  readonly userId: string;
  readonly email: string;
  readonly count: number;
}

interface NewsEntry {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly body: string;
  readonly author: string;
  readonly publishedAt: string;
}

type ApiResult<T> =
  | { readonly ok: true; readonly status: number; readonly body: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

const UNREACHABLE_MESSAGE =
  "The account server is unreachable right now. Try again in a moment.";

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const init: RequestInit = { method, credentials: "include" };
    if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    return { ok: false, status: 0, message: UNREACHABLE_MESSAGE };
  }
  if (response.ok) {
    if (response.status === 204) {
      return { ok: true, status: response.status, body: undefined as T };
    }
    return {
      ok: true,
      status: response.status,
      body: (await response.json()) as T,
    };
  }
  try {
    const payload = (await response.json()) as {
      error?: { message?: unknown };
    };
    const message = payload.error?.message;
    if (typeof message === "string" && message !== "") {
      return { ok: false, status: response.status, message };
    }
  } catch {
    // Non-JSON error body: fall through to the generic message.
  }
  return { ok: false, status: response.status, message: UNREACHABLE_MESSAGE };
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Admin mount point "${selector}" is missing.`);
  }
  return element;
}

function setStatus(
  element: HTMLParagraphElement,
  tone: "error" | "info" | "success",
  message: string,
): void {
  element.dataset["tone"] = tone;
  element.textContent = message;
}

function formatTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed)
    ? iso
    : new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}

function makeButton(
  label: string,
  testId: string,
  quiet = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = quiet ? "admin-button admin-button-quiet" : "admin-button";
  button.dataset["testid"] = testId;
  button.textContent = label;
  return button;
}

function definitionRow(term: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "admin-detail-row";
  const dt = document.createElement("span");
  dt.className = "admin-detail-term";
  dt.textContent = term;
  const dd = document.createElement("span");
  dd.className = "admin-detail-value";
  dd.textContent = value;
  row.append(dt, dd);
  return row;
}

// --- Account lookup, ban, unban -------------------------------------------

const lookupForm = requireElement<HTMLFormElement>(".admin-lookup-form");
const lookupEmail = requireElement<HTMLInputElement>("#admin-lookup-email");
const lookupStatus = requireElement<HTMLParagraphElement>(
  ".admin-lookup-status",
);
const accountCard = requireElement<HTMLDivElement>(
  '[data-testid="admin-account"]',
);

function renderAccount(account: AccountSummary): void {
  accountCard.replaceChildren();
  accountCard.hidden = false;

  const heading = document.createElement("h3");
  heading.className = "admin-account-email";
  heading.dataset["testid"] = "admin-account-email";
  heading.textContent = account.email;
  accountCard.append(heading);

  const banState = document.createElement("p");
  banState.className = "admin-ban-state";
  banState.dataset["testid"] = "admin-ban-state";
  if (account.bannedAt !== null) {
    banState.dataset["banned"] = "true";
    banState.textContent = `BANNED since ${formatTimestamp(account.bannedAt)} — ${account.banReason ?? "no reason recorded"}`;
  } else {
    banState.dataset["banned"] = "false";
    banState.textContent = "In good standing (not banned).";
  }
  accountCard.append(banState);

  accountCard.append(
    definitionRow("Account ID", account.id),
    definitionRow("Created", formatTimestamp(account.createdAt)),
    definitionRow("Role", account.isAdmin ? "Administrator" : "Player"),
  );

  const charactersHeading = document.createElement("h4");
  charactersHeading.textContent = `Characters (${String(account.characters.length)})`;
  accountCard.append(charactersHeading);
  const characterList = document.createElement("ul");
  characterList.className = "admin-character-list";
  characterList.dataset["testid"] = "admin-characters";
  for (const character of account.characters) {
    const item = document.createElement("li");
    item.textContent = `${character.name} — level ${String(character.level)}, ${character.zoneId}, last saved ${formatTimestamp(character.updatedAt)}`;
    characterList.append(item);
  }
  if (account.characters.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No characters.";
    characterList.append(item);
  }
  accountCard.append(characterList);

  const actionStatus = document.createElement("p");
  actionStatus.className = "admin-status";
  actionStatus.dataset["testid"] = "admin-action-status";
  actionStatus.setAttribute("role", "status");

  const actions = document.createElement("div");
  actions.className = "admin-account-actions";

  if (account.bannedAt !== null) {
    const unban = makeButton("Unban account", "admin-unban");
    const confirmRow = document.createElement("div");
    confirmRow.className = "admin-confirm-row";
    confirmRow.hidden = true;
    const confirmUnban = makeButton("Confirm unban", "admin-unban-confirm");
    const cancel = makeButton("Cancel", "admin-unban-cancel", true);
    confirmRow.append(confirmUnban, cancel);
    unban.addEventListener("click", () => {
      confirmRow.hidden = false;
    });
    cancel.addEventListener("click", () => {
      confirmRow.hidden = true;
    });
    confirmUnban.addEventListener("click", () => {
      confirmUnban.disabled = true;
      void api<{ id: string }>(
        "POST",
        `/admin/accounts/${account.id}/unban`,
      ).then((result) => {
        confirmUnban.disabled = false;
        if (result.ok) {
          setStatus(lookupStatus, "success", `${account.email} unbanned.`);
          void lookupAccount(account.email);
          return;
        }
        setStatus(actionStatus, "error", result.message);
      });
    });
    actions.append(unban, confirmRow);
  } else {
    const ban = makeButton("Ban account…", "admin-ban-open");
    const banForm = document.createElement("div");
    banForm.className = "admin-ban-form";
    banForm.hidden = true;
    const reasonLabel = document.createElement("label");
    reasonLabel.className = "admin-field-label";
    reasonLabel.htmlFor = "admin-ban-reason";
    reasonLabel.textContent =
      "Ban reason (required — shown in the audit trail)";
    const reason = document.createElement("input");
    reason.type = "text";
    reason.id = "admin-ban-reason";
    reason.dataset["testid"] = "admin-ban-reason";
    reason.maxLength = 500;
    const confirmBan = makeButton("Confirm ban", "admin-ban-confirm");
    const cancel = makeButton("Cancel", "admin-ban-cancel", true);
    const confirmRow = document.createElement("div");
    confirmRow.className = "admin-confirm-row";
    confirmRow.append(confirmBan, cancel);
    banForm.append(reasonLabel, reason, confirmRow);
    ban.addEventListener("click", () => {
      banForm.hidden = false;
      reason.focus();
    });
    cancel.addEventListener("click", () => {
      banForm.hidden = true;
    });
    confirmBan.addEventListener("click", () => {
      const trimmed = reason.value.trim();
      if (trimmed.length === 0) {
        setStatus(actionStatus, "error", "A ban reason is required.");
        return;
      }
      confirmBan.disabled = true;
      void api<{ id: string }>("POST", `/admin/accounts/${account.id}/ban`, {
        reason: trimmed,
      }).then((result) => {
        confirmBan.disabled = false;
        if (result.ok) {
          setStatus(lookupStatus, "success", `${account.email} banned.`);
          void lookupAccount(account.email);
          return;
        }
        // 409 target-is-admin arrives here with the server's message.
        setStatus(actionStatus, "error", result.message);
      });
    });
    actions.append(ban, banForm);
  }

  accountCard.append(actions, actionStatus);
}

async function lookupAccount(email: string): Promise<void> {
  setStatus(lookupStatus, "info", "Looking up…");
  const result = await api<AccountSummary>(
    "GET",
    `/admin/accounts?email=${encodeURIComponent(email)}`,
  );
  if (!result.ok) {
    accountCard.hidden = true;
    setStatus(lookupStatus, "error", result.message);
    return;
  }
  setStatus(lookupStatus, "info", "");
  renderAccount(result.body);
}

lookupForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = lookupEmail.value.trim();
  if (email === "") {
    setStatus(lookupStatus, "error", "Enter an account email.");
    return;
  }
  void lookupAccount(email);
});

// --- Save-rejection audit signal ------------------------------------------

const rejectionsHost = requireElement<HTMLDivElement>(
  '[data-testid="admin-rejections"]',
);

function rejectionTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  testId: string,
): HTMLTableElement {
  const table = document.createElement("table");
  table.className = "admin-table";
  table.dataset["testid"] = testId;
  const head = table.createTHead().insertRow();
  for (const header of headers) {
    const cell = document.createElement("th");
    cell.textContent = header;
    head.append(cell);
  }
  const body = table.createTBody();
  for (const row of rows) {
    const tableRow = body.insertRow();
    for (const value of row) {
      tableRow.insertCell().textContent = value;
    }
  }
  return table;
}

async function loadRejections(): Promise<void> {
  rejectionsHost.replaceChildren();
  const note = document.createElement("p");
  note.className = "admin-status";
  note.textContent = "Loading…";
  rejectionsHost.append(note);
  const result = await api<{
    recent: readonly SaveRejectionRow[];
    counts: readonly SaveRejectionCount[];
  }>("GET", "/admin/save-rejections?limit=100");
  rejectionsHost.replaceChildren();
  if (!result.ok) {
    const error = document.createElement("p");
    error.className = "admin-status";
    error.dataset["tone"] = "error";
    error.textContent = result.message;
    rejectionsHost.append(error);
    return;
  }
  const { recent, counts } = result.body;
  if (recent.length === 0) {
    const empty = document.createElement("p");
    empty.className = "admin-status";
    empty.dataset["testid"] = "admin-rejections-empty";
    empty.textContent = "No save rejections recorded — all clean.";
    rejectionsHost.append(empty);
    return;
  }
  const countsHeading = document.createElement("h3");
  countsHeading.textContent = "Rejections per account";
  rejectionsHost.append(
    countsHeading,
    rejectionTable(
      ["Email", "Rejections"],
      counts.map((entry) => [entry.email, String(entry.count)]),
      "admin-rejections-counts",
    ),
  );
  const recentHeading = document.createElement("h3");
  recentHeading.textContent = `Most recent (${String(recent.length)})`;
  rejectionsHost.append(
    recentHeading,
    rejectionTable(
      ["When", "Email", "Code", "Character"],
      recent.map((entry) => [
        formatTimestamp(entry.createdAt),
        entry.email,
        entry.code,
        entry.characterId,
      ]),
      "admin-rejections-recent",
    ),
  );
}

requireElement<HTMLButtonElement>(".admin-rejections-refresh").addEventListener(
  "click",
  () => {
    void loadRejections();
  },
);

// --- News manager ----------------------------------------------------------

const newsForm = requireElement<HTMLFormElement>(".admin-news-form");
const newsId = requireElement<HTMLInputElement>(".admin-news-id");
const newsTitle = requireElement<HTMLInputElement>("#admin-news-title");
const newsBody = requireElement<HTMLTextAreaElement>("#admin-news-body");
const newsAuthor = requireElement<HTMLInputElement>("#admin-news-author");
const newsSubmit = requireElement<HTMLButtonElement>(
  '[data-testid="admin-news-submit"]',
);
const newsCancel = requireElement<HTMLButtonElement>(".admin-news-cancel");
const newsStatus = requireElement<HTMLParagraphElement>(".admin-news-status");
const newsList = requireElement<HTMLOListElement>(".admin-news-list");

function resetNewsForm(): void {
  newsId.value = "";
  newsTitle.value = "";
  newsBody.value = "";
  newsAuthor.value = "";
  newsSubmit.textContent = "Publish entry";
  newsCancel.hidden = true;
}

function renderNewsList(entries: readonly NewsEntry[]): void {
  newsList.replaceChildren();
  if (entries.length === 0) {
    const empty = document.createElement("li");
    empty.className = "admin-news-empty";
    empty.dataset["testid"] = "admin-news-empty";
    empty.textContent =
      "No published entries — the homepage shows the built-in fallback news.";
    newsList.append(empty);
    return;
  }
  for (const entry of entries) {
    const item = document.createElement("li");
    item.className = "admin-news-entry";
    item.dataset["testid"] = "admin-news-entry";

    const title = document.createElement("h3");
    title.textContent = entry.title;
    const meta = document.createElement("p");
    meta.className = "admin-news-meta";
    meta.textContent = `${entry.date} · ${entry.author}`;
    const body = document.createElement("p");
    body.className = "admin-news-body";
    body.textContent = entry.body;

    const edit = makeButton("Edit", "admin-news-edit", true);
    edit.addEventListener("click", () => {
      newsId.value = entry.id;
      newsTitle.value = entry.title;
      newsBody.value = entry.body;
      newsAuthor.value = entry.author;
      newsSubmit.textContent = "Save changes";
      newsCancel.hidden = false;
      newsTitle.focus();
    });

    const del = makeButton("Delete", "admin-news-delete", true);
    const confirmRow = document.createElement("div");
    confirmRow.className = "admin-confirm-row";
    confirmRow.hidden = true;
    const confirmDelete = makeButton(
      "Confirm delete",
      "admin-news-delete-confirm",
    );
    const cancelDelete = makeButton("Cancel", "admin-news-delete-cancel", true);
    confirmRow.append(confirmDelete, cancelDelete);
    del.addEventListener("click", () => {
      confirmRow.hidden = false;
    });
    cancelDelete.addEventListener("click", () => {
      confirmRow.hidden = true;
    });
    confirmDelete.addEventListener("click", () => {
      confirmDelete.disabled = true;
      void api<undefined>("DELETE", `/admin/news/${entry.id}`).then(
        (result) => {
          confirmDelete.disabled = false;
          if (result.ok) {
            setStatus(newsStatus, "success", `Deleted "${entry.title}".`);
            void loadNews();
            return;
          }
          setStatus(newsStatus, "error", result.message);
        },
      );
    });

    const actions = document.createElement("div");
    actions.className = "admin-news-actions";
    actions.append(edit, del);

    item.append(title, meta, body, actions, confirmRow);
    newsList.append(item);
  }
}

async function loadNews(): Promise<void> {
  const result = await api<readonly NewsEntry[]>("GET", "/news");
  if (!result.ok) {
    setStatus(newsStatus, "error", result.message);
    return;
  }
  renderNewsList(result.body);
}

newsCancel.addEventListener("click", () => {
  resetNewsForm();
  setStatus(newsStatus, "info", "");
});

newsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = newsTitle.value.trim();
  const body = newsBody.value.trim();
  if (title === "" || body === "") {
    setStatus(newsStatus, "error", "A title and body are both required.");
    return;
  }
  const payload: { title: string; body: string; author?: string } = {
    title,
    body,
  };
  const author = newsAuthor.value.trim();
  if (author !== "") payload.author = author;
  const editingId = newsId.value;
  newsSubmit.disabled = true;
  const request =
    editingId === ""
      ? api<NewsEntry>("POST", "/admin/news", payload)
      : api<NewsEntry>("PUT", `/admin/news/${editingId}`, payload);
  void request.then((result) => {
    newsSubmit.disabled = false;
    if (result.ok) {
      setStatus(
        newsStatus,
        "success",
        editingId === "" ? "Entry published." : "Entry updated.",
      );
      resetNewsForm();
      void loadNews();
      return;
    }
    setStatus(newsStatus, "error", result.message);
  });
});

// --- Access gate -----------------------------------------------------------

const gate = requireElement<HTMLElement>('[data-testid="admin-gate"]');
const gateHeading = requireElement<HTMLHeadingElement>("#admin-gate-heading");
const gateCopy = requireElement<HTMLParagraphElement>(
  '[data-testid="admin-gate-copy"]',
);
const panel = requireElement<HTMLDivElement>('[data-testid="admin-panel"]');

function denyAccess(copy: string): void {
  gateHeading.textContent = "Admin access required";
  gateCopy.textContent = copy;
  gate.hidden = false;
  panel.hidden = true;
}

async function boot(): Promise<void> {
  const result = await api<{ email?: unknown; isAdmin?: unknown }>(
    "GET",
    "/auth/session",
  );
  if (!result.ok) {
    denyAccess(
      result.status === 0
        ? UNREACHABLE_MESSAGE
        : "You are not signed in. Log in on the homepage with an administrator account to use these tools.",
    );
    return;
  }
  const email =
    typeof result.body.email === "string" ? result.body.email : null;
  if (email === null) {
    denyAccess(
      "You are not signed in. Log in on the homepage with an administrator account to use these tools.",
    );
    return;
  }
  if (result.body.isAdmin !== true) {
    denyAccess(
      "This area is for the Loot Divers team. Your account does not have administrator access.",
    );
    return;
  }
  requireElement<HTMLSpanElement>(".admin-session-email").textContent =
    `Signed in as ${email}`;
  gate.hidden = true;
  panel.hidden = false;
  await Promise.all([loadRejections(), loadNews()]);
}

void boot();

/**
 * TASK-720 (DEC-046): public news route and the admin API surface behind
 * the owner-mandated homepage admin panel (TASK-721 builds the UI).
 *
 * Kept out of app.ts so parallel work on the core routes rebases cleanly.
 * Every /admin/* handler starts with the injected `requireAdmin` guard —
 * the role lives server-side on the user row (users.is_admin, granted by
 * CLI only) and is never read from anything the client sends.
 *
 * News bodies are plain text/markdown. The server never renders them;
 * every consumer (the homepage, the panel) must escape on display —
 * injecting a body as HTML is an XSS.
 */
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { sendError, UUID_PATTERN } from "./http.js";
import { isValidEmail, normalizeEmail } from "./validation.js";
import type {
  DataStore,
  NewsEntryRecord,
  UserRecord,
} from "./store.js";

/** What the admin routes need from the session guard: pass, or replied. */
export interface AdminSession {
  readonly userId: string;
  readonly user: UserRecord;
}

export type AdminGuard = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<AdminSession | null>;

export interface AdminRouteDependencies {
  readonly store: DataStore;
  readonly requireAdmin: AdminGuard;
}

const NEWS_TITLE_MAX = 200;
const NEWS_BODY_MAX = 20_000;
const NEWS_AUTHOR_MAX = 100;
export const NEWS_DEFAULT_AUTHOR = "Loot Divers Team";

const BAN_REASON_MAX = 500;

const REJECTIONS_DEFAULT_LIMIT = 100;
const REJECTIONS_MAX_LIMIT = 500;

/**
 * The public news shape: the DB record plus the `date` (YYYY-MM-DD) field
 * the static news.json homepage renderer already understands (DEC-035).
 */
function newsResponse(entry: NewsEntryRecord): Record<string, unknown> {
  return {
    id: entry.id,
    date: entry.publishedAt.slice(0, 10),
    title: entry.title,
    body: entry.body,
    author: entry.author,
    publishedAt: entry.publishedAt,
  };
}

function parseUuidParam(
  request: FastifyRequest,
  reply: FastifyReply,
  noun: string,
): string | null {
  const { id } = request.params as { id?: string };
  if (id === undefined || !UUID_PATTERN.test(id)) {
    void sendError(reply, 404, "not-found", `No such ${noun}.`);
    return null;
  }
  return id;
}

interface NewsBody {
  readonly title?: unknown;
  readonly body?: unknown;
  readonly author?: unknown;
  readonly publishedAt?: unknown;
}

interface ParsedNews {
  readonly title: string;
  readonly body: string;
  /** Null when the request omitted it (create defaults, update keeps). */
  readonly author: string | null;
  readonly publishedAt: string | null;
}

/** Validates a news create/update body; replies 422 and returns null on error. */
function parseNewsBody(raw: unknown, reply: FastifyReply): ParsedNews | null {
  const body = (raw ?? {}) as NewsBody;
  if (typeof body.title !== "string" || typeof body.body !== "string") {
    void sendError(
      reply,
      422,
      "invalid-news",
      "Body must be { title, body, author?, publishedAt? }.",
    );
    return null;
  }
  const title = body.title.trim();
  if (title.length === 0 || title.length > NEWS_TITLE_MAX) {
    void sendError(
      reply,
      422,
      "invalid-news-title",
      `title must be 1 to ${String(NEWS_TITLE_MAX)} characters.`,
    );
    return null;
  }
  const text = body.body.trim();
  if (text.length === 0 || text.length > NEWS_BODY_MAX) {
    void sendError(
      reply,
      422,
      "invalid-news-body",
      `body must be 1 to ${String(NEWS_BODY_MAX)} characters of plain text/markdown.`,
    );
    return null;
  }
  let author: string | null = null;
  if (body.author !== undefined) {
    if (typeof body.author !== "string") {
      void sendError(reply, 422, "invalid-news-author", "author must be a string.");
      return null;
    }
    author = body.author.trim();
    if (author.length === 0 || author.length > NEWS_AUTHOR_MAX) {
      void sendError(
        reply,
        422,
        "invalid-news-author",
        `author must be 1 to ${String(NEWS_AUTHOR_MAX)} characters.`,
      );
      return null;
    }
  }
  let publishedAt: string | null = null;
  if (body.publishedAt !== undefined) {
    const parsed =
      typeof body.publishedAt === "string"
        ? Date.parse(body.publishedAt)
        : Number.NaN;
    if (Number.isNaN(parsed)) {
      void sendError(
        reply,
        422,
        "invalid-news-published-at",
        "publishedAt must be an ISO-8601 timestamp.",
      );
      return null;
    }
    publishedAt = new Date(parsed).toISOString();
  }
  return { title, body: text, author, publishedAt };
}

/** Public, unauthenticated routes: the homepage's news feed. */
export function registerNewsRoutes(
  app: FastifyInstance,
  store: DataStore,
): void {
  app.get("/news", async (_request, reply) => {
    const entries = await store.listNews();
    return reply.status(200).send(entries.map((entry) => newsResponse(entry)));
  });
}

/** Admin-gated routes. Registration order inside app.ts does not matter. */
export function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRouteDependencies,
): void {
  const { store, requireAdmin } = dependencies;

  // --- Accounts -----------------------------------------------------------

  app.get("/admin/accounts", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const { email } = request.query as { email?: string };
    const normalized = normalizeEmail(email ?? "");
    if (!isValidEmail(normalized)) {
      return sendError(
        reply,
        422,
        "invalid-email",
        "Query parameter email is required and must be an email address.",
      );
    }
    const summary = await store.getAccountSummary(normalized);
    if (summary === null) {
      return sendError(reply, 404, "not-found", "No account with this email.");
    }
    return reply.status(200).send(summary);
  });

  interface BanBody {
    readonly reason?: unknown;
  }

  app.post("/admin/accounts/:id/ban", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const accountId = parseUuidParam(request, reply, "account");
    if (accountId === null) {
      return reply;
    }
    const { reason } = (request.body ?? {}) as BanBody;
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (trimmed.length === 0 || trimmed.length > BAN_REASON_MAX) {
      return sendError(
        reply,
        422,
        "invalid-ban-reason",
        `Body must be { reason } with 1 to ${String(BAN_REASON_MAX)} characters.`,
      );
    }
    const target = await store.findUserById(accountId);
    if (target === null) {
      return sendError(reply, 404, "not-found", "No such account.");
    }
    // Admins (including yourself) cannot be banned over HTTP: demote first
    // via the CLI. Keeps a stolen admin session from locking the owner out.
    if (target.isAdmin) {
      return sendError(
        reply,
        409,
        "target-is-admin",
        "Admin accounts cannot be banned via the API; demote via CLI first.",
      );
    }
    await store.banUser(target.id, trimmed);
    const banned = await store.findUserById(target.id);
    return reply.status(200).send({
      id: target.id,
      email: target.email,
      bannedAt: banned?.bannedAt ?? null,
      banReason: banned?.banReason ?? trimmed,
    });
  });

  app.post("/admin/accounts/:id/unban", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const accountId = parseUuidParam(request, reply, "account");
    if (accountId === null) {
      return reply;
    }
    const target = await store.findUserById(accountId);
    if (target === null) {
      return sendError(reply, 404, "not-found", "No such account.");
    }
    await store.unbanUser(target.id);
    return reply.status(200).send({
      id: target.id,
      email: target.email,
      bannedAt: null,
      banReason: null,
    });
  });

  // --- Save-rejection audit signal (DEC-044) ------------------------------

  app.get("/admin/save-rejections", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const { limit } = request.query as { limit?: string };
    let capped = REJECTIONS_DEFAULT_LIMIT;
    if (limit !== undefined) {
      const parsed = Number.parseInt(limit, 10);
      if (
        !Number.isInteger(parsed) ||
        parsed < 1 ||
        parsed > REJECTIONS_MAX_LIMIT ||
        String(parsed) !== limit
      ) {
        return sendError(
          reply,
          422,
          "invalid-limit",
          `limit must be an integer between 1 and ${String(REJECTIONS_MAX_LIMIT)}.`,
        );
      }
      capped = parsed;
    }
    const [recent, counts] = await Promise.all([
      store.listRecentSaveRejections(capped),
      store.listSaveRejectionCounts(),
    ]);
    return reply.status(200).send({ recent, counts });
  });

  // --- News management -----------------------------------------------------

  app.post("/admin/news", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const parsed = parseNewsBody(request.body, reply);
    if (parsed === null) {
      return reply;
    }
    const created = await store.createNews({
      title: parsed.title,
      body: parsed.body,
      author: parsed.author ?? NEWS_DEFAULT_AUTHOR,
      publishedAt: parsed.publishedAt,
    });
    return reply.status(201).send(newsResponse(created));
  });

  app.put("/admin/news/:id", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const newsId = parseUuidParam(request, reply, "news entry");
    if (newsId === null) {
      return reply;
    }
    const parsed = parseNewsBody(request.body, reply);
    if (parsed === null) {
      return reply;
    }
    const updated = await store.updateNews(newsId, {
      title: parsed.title,
      body: parsed.body,
      author: parsed.author,
      publishedAt: parsed.publishedAt,
    });
    if (updated === null) {
      return sendError(reply, 404, "not-found", "No such news entry.");
    }
    return reply.status(200).send(newsResponse(updated));
  });

  app.delete("/admin/news/:id", async (request, reply) => {
    if ((await requireAdmin(request, reply)) === null) {
      return reply;
    }
    const newsId = parseUuidParam(request, reply, "news entry");
    if (newsId === null) {
      return reply;
    }
    const deleted = await store.deleteNews(newsId);
    if (!deleted) {
      return sendError(reply, 404, "not-found", "No such news entry.");
    }
    return reply.status(204).send();
  });
}

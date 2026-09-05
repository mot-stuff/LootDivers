import fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyRateLimit from "@fastify/rate-limit";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./auth.js";
import type { ServerConfig } from "./config.js";
import type { DataStore } from "./store.js";
import {
  CHARACTER_SLOT_LIMIT,
  ENVELOPE_MAX_BYTES,
  inspectEnvelopeShape,
  isValidCharacterClass,
  isValidEmail,
  isValidLevel,
  isValidPassword,
  normalizeEmail,
  validateCharacterName,
} from "./validation.js";

export const SESSION_COOKIE = "sid";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /characters/:id/save carries the enveloped character (≤ 1 MB by
 * contract) plus a small JSON wrapper; anything past this hard limit is
 * rejected by Fastify before buffering more.
 */
const SAVE_ROUTE_BODY_LIMIT = ENVELOPE_MAX_BYTES + 64 * 1024;

export interface AppDependencies {
  readonly store: DataStore;
  readonly config: ServerConfig;
  /** Injectable clock for session-expiry tests. */
  readonly now?: () => number;
  /** Disables rate limiting in unit tests that hammer auth routes. */
  readonly rateLimits?: boolean;
  /** Defaults to true; tests pass false to keep output readable. */
  readonly logger?: boolean;
}

interface SessionInfo {
  readonly userId: string;
  readonly tokenHash: string;
}

function sendError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
): FastifyReply {
  return reply.status(status).send({ error: { code, message } });
}

/**
 * Builds the API exactly per the Phase 8 kickoff §2 contract. Pure function
 * of its dependencies: tests inject a `MemoryStore` or a Postgres-backed
 * store and drive the instance with `app.inject()`.
 */
export async function buildApp(
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const { store, config } = dependencies;
  const now = dependencies.now ?? (() => Date.now());
  const app = fastify({
    logger: dependencies.logger ?? true,
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: [...config.corsOrigins],
    credentials: true,
  });
  if (dependencies.rateLimits !== false) {
    await app.register(fastifyRateLimit, {
      global: false,
      max: 10,
      timeWindow: "1 minute",
    });
  }

  // Contract error shape for everything Fastify raises itself (body too
  // large, malformed JSON, rate limit, uncaught).
  app.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (status === 413) {
      return sendError(
        reply,
        413,
        "envelope-too-large",
        `Request body exceeds the ${String(ENVELOPE_MAX_BYTES)}-byte envelope cap.`,
      );
    }
    if (status === 429) {
      return sendError(
        reply,
        429,
        "rate-limited",
        "Too many attempts; retry shortly.",
      );
    }
    if (status === 400) {
      return sendError(reply, 400, "bad-request", "Malformed request body.");
    }
    request.log.error(error);
    return sendError(reply, 500, "internal", "Internal server error.");
  });

  const authRateLimit =
    dependencies.rateLimits === false
      ? {}
      : { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

  function sessionCookieOptions(maxAgeSeconds: number) {
    return {
      path: "/",
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: "lax" as const,
      maxAge: maxAgeSeconds,
    };
  }

  async function establishSession(
    reply: FastifyReply,
    userId: string,
  ): Promise<void> {
    const token = generateSessionToken();
    const expiresAt = now() + config.sessionTtlMs;
    await store.createSession({
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
    });
    void reply.setCookie(
      SESSION_COOKIE,
      token,
      sessionCookieOptions(Math.floor(config.sessionTtlMs / 1000)),
    );
  }

  async function requireSession(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<SessionInfo | null> {
    const token = request.cookies[SESSION_COOKIE];
    if (token === undefined || token === "") {
      await sendError(reply, 401, "unauthorized", "Not signed in.");
      return null;
    }
    const tokenHash = hashSessionToken(token);
    const session = await store.findSession(tokenHash, now());
    if (session === null) {
      await sendError(
        reply,
        401,
        "unauthorized",
        "Session expired or invalid.",
      );
      return null;
    }
    return { userId: session.userId, tokenHash };
  }

  interface CredentialsBody {
    readonly email?: unknown;
    readonly password?: unknown;
  }

  function parseCredentials(
    body: unknown,
    reply: FastifyReply,
  ): { email: string; password: string } | null {
    const record = (body ?? {}) as CredentialsBody;
    if (
      typeof record.email !== "string" ||
      typeof record.password !== "string"
    ) {
      void sendError(
        reply,
        422,
        "invalid-credentials-shape",
        "Body must be { email, password }.",
      );
      return null;
    }
    const email = normalizeEmail(record.email);
    if (!isValidEmail(email)) {
      void sendError(
        reply,
        422,
        "invalid-email",
        "Email address is not valid.",
      );
      return null;
    }
    if (!isValidPassword(record.password)) {
      void sendError(
        reply,
        422,
        "invalid-password",
        "Password must be 8 to 200 characters.",
      );
      return null;
    }
    return { email, password: record.password };
  }

  app.post("/auth/signup", authRateLimit, async (request, reply) => {
    const credentials = parseCredentials(request.body, reply);
    if (credentials === null) {
      return reply;
    }
    const passwordHash = await hashPassword(credentials.password);
    const user = await store.createUser(credentials.email, passwordHash);
    if (user === "email-taken") {
      return sendError(
        reply,
        409,
        "email-taken",
        "An account with this email already exists.",
      );
    }
    await establishSession(reply, user.id);
    return reply.status(201).send({ userId: user.id });
  });

  app.post("/auth/login", authRateLimit, async (request, reply) => {
    const credentials = parseCredentials(request.body, reply);
    if (credentials === null) {
      return reply;
    }
    const user = await store.findUserByEmail(credentials.email);
    const valid =
      user !== null &&
      (await verifyPassword(user.passwordHash, credentials.password));
    if (!valid || user === null) {
      return sendError(
        reply,
        401,
        "invalid-credentials",
        "Email or password is incorrect.",
      );
    }
    await establishSession(reply, user.id);
    return reply.status(200).send({ userId: user.id });
  });

  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token !== undefined && token !== "") {
      await store.deleteSession(hashSessionToken(token));
    }
    void reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/auth/session", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (session === null) {
      return reply;
    }
    const user = await store.findUserById(session.userId);
    if (user === null) {
      return sendError(reply, 401, "unauthorized", "Account no longer exists.");
    }
    return reply.status(200).send({ userId: user.id, email: user.email });
  });

  app.get("/characters", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (session === null) {
      return reply;
    }
    const characters = await store.listCharacters(session.userId);
    return reply.status(200).send(characters);
  });

  interface CreateCharacterBody {
    readonly name?: unknown;
    readonly class?: unknown;
  }

  app.post("/characters", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (session === null) {
      return reply;
    }
    const body = (request.body ?? {}) as CreateCharacterBody;
    if (typeof body.name !== "string" || typeof body.class !== "string") {
      return sendError(
        reply,
        422,
        "invalid-name",
        'Body must be { name, class: "barbarian" }.',
      );
    }
    const name = validateCharacterName(body.name);
    if (name === null) {
      return sendError(
        reply,
        422,
        "invalid-name",
        "Names are 3-16 characters, start with a letter, use only letters, digits, apostrophes, hyphens, and spaces, with no consecutive separators.",
      );
    }
    if (!isValidCharacterClass(body.class)) {
      return sendError(
        reply,
        422,
        "invalid-class",
        'Class must be "barbarian".',
      );
    }
    const created = await store.createCharacter(
      session.userId,
      name,
      body.class,
      CHARACTER_SLOT_LIMIT,
    );
    if (created === "slot-limit") {
      return sendError(
        reply,
        403,
        "slot-limit",
        `Accounts hold at most ${String(CHARACTER_SLOT_LIMIT)} characters.`,
      );
    }
    if (created === "name-taken") {
      return sendError(
        reply,
        409,
        "duplicate-name",
        "You already have a character with this name.",
      );
    }
    return reply.status(201).send({ id: created.id });
  });

  function parseCharacterId(
    request: FastifyRequest,
    reply: FastifyReply,
  ): string | null {
    const { id } = request.params as { id?: string };
    if (id === undefined || !UUID_PATTERN.test(id)) {
      void sendError(reply, 404, "not-found", "No such character.");
      return null;
    }
    return id;
  }

  app.get("/characters/:id", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (session === null) {
      return reply;
    }
    const characterId = parseCharacterId(request, reply);
    if (characterId === null) {
      return reply;
    }
    const character = await store.getCharacter(session.userId, characterId);
    if (character === null) {
      return sendError(reply, 404, "not-found", "No such character.");
    }
    return reply.status(200).send({
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level,
      envelope: character.envelope,
    });
  });

  interface SaveBody {
    readonly envelope?: unknown;
    readonly level?: unknown;
  }

  app.put(
    "/characters/:id/save",
    { bodyLimit: SAVE_ROUTE_BODY_LIMIT },
    async (request, reply) => {
      const session = await requireSession(request, reply);
      if (session === null) {
        return reply;
      }
      const characterId = parseCharacterId(request, reply);
      if (characterId === null) {
        return reply;
      }
      const body = (request.body ?? {}) as SaveBody;
      if (body.envelope === undefined) {
        return sendError(
          reply,
          422,
          "invalid-envelope",
          "Body must be { envelope, level }.",
        );
      }
      if (!isValidLevel(body.level)) {
        return sendError(
          reply,
          422,
          "invalid-level",
          "level must be an integer between 1 and 1000.",
        );
      }
      const shape = inspectEnvelopeShape(body.envelope);
      if (shape === null) {
        return sendError(
          reply,
          422,
          "invalid-envelope",
          "envelope is not a recognizable save envelope (shape check only; contents are never parsed).",
        );
      }
      if (shape.serializedBytes > ENVELOPE_MAX_BYTES) {
        return sendError(
          reply,
          413,
          "envelope-too-large",
          `Serialized envelope exceeds ${String(ENVELOPE_MAX_BYTES)} bytes.`,
        );
      }
      const saved = await store.saveCharacter(
        session.userId,
        characterId,
        body.envelope,
        body.level,
        shape.formatVersion,
        shape.checksum,
      );
      if (saved === null) {
        return sendError(reply, 404, "not-found", "No such character.");
      }
      return reply.status(200).send({ revision: saved.revision });
    },
  );

  app.delete("/characters/:id", async (request, reply) => {
    const session = await requireSession(request, reply);
    if (session === null) {
      return reply;
    }
    const characterId = parseCharacterId(request, reply);
    if (characterId === null) {
      return reply;
    }
    const deleted = await store.deleteCharacter(session.userId, characterId);
    if (!deleted) {
      return sendError(reply, 404, "not-found", "No such character.");
    }
    return reply.status(204).send();
  });

  app.get("/healthz", async (_request, reply) => {
    await store.ping();
    return reply.status(200).send({ status: "ok" });
  });

  return app;
}

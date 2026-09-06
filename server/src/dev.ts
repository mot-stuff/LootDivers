import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryStore } from "./memory-store.js";

/**
 * Local development entry point (TASK-719): the full API app on the
 * in-memory store — no Postgres, no Docker — exactly the composition the
 * contract suite exercises. State lives for the process lifetime only.
 *
 * Usage: `npm run dev:memory` (defaults to 127.0.0.1:8790; PORT overrides).
 * Development config (no NODE_ENV=production) serves non-Secure cookies and
 * localhost CORS so a local client can talk to it over plain HTTP.
 */
async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    NODE_ENV: undefined,
    DATABASE_URL: "postgres://unused-memory-store",
    PORT: process.env.PORT ?? "8790",
    HOST: process.env.HOST ?? "127.0.0.1",
  });
  const store = new MemoryStore();
  const app = await buildApp({
    store,
    config,
    rateLimits: false,
  });
  // TASK-721: dev-only admin promotion seam. In production admin is granted
  // exclusively via the CLI (DEC-046); this route exists only in this
  // memory-store entry point — buildApp never registers it — so the e2e
  // admin-journey spec can promote a freshly signed-up user.
  app.post("/dev/promote", async (request, reply) => {
    const { email } = (request.body ?? {}) as { email?: unknown };
    const user =
      typeof email === "string"
        ? await store.findUserByEmail(email.trim().toLowerCase())
        : null;
    if (user === null) {
      return reply
        .status(404)
        .send({ error: { code: "not-found", message: "No such account." } });
    }
    await store.setAdmin(user.id, true);
    return reply.status(200).send({ id: user.id, isAdmin: true });
  });
  await app.listen({ port: config.port, host: config.host });
  console.log(
    `memory-store dev API listening on ${config.host}:${String(config.port)}`,
  );
}

main().catch((error: unknown) => {
  console.error("Fatal dev startup error:", error);
  process.exit(1);
});

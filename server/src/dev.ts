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
  const app = await buildApp({
    store: new MemoryStore(),
    config,
    rateLimits: false,
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

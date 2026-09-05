import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, runMigrations } from "./db.js";
import { PgStore } from "./pg-store.js";

/**
 * Production entry point. Migrations run automatically before the API
 * accepts traffic (runbook Part B step 13 greps the boot log for
 * "migrations applied" and "listening").
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const pool = createPool(config.databaseUrl);

  const applied = await runMigrations(pool);
  console.log(
    `migrations applied: ${applied.length === 0 ? "none pending" : applied.join(", ")}`,
  );

  const app = await buildApp({ store: new PgStore(pool), config });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`${signal} received; shutting down.`);
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: config.port, host: config.host });
  console.log(`listening on ${config.host}:${String(config.port)}`);
}

main().catch((error: unknown) => {
  console.error("Fatal startup error:", error);
  process.exit(1);
});

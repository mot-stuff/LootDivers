import { describe } from "vitest";
import { createPool, runMigrations } from "../src/db.js";
import { PgStore } from "../src/pg-store.js";
import { runContractSuite } from "./contract-suite.js";

/**
 * The identical §2 contract suite against real Postgres.
 *
 * Requires TEST_DATABASE_URL pointing at a DISPOSABLE database (the suite
 * truncates it). Locally:
 *
 *   docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine
 *   TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/postgres npm test
 *
 * CI provides a Postgres service container, so this suite always runs there.
 * Skipped silently when the variable is absent (e.g. Docker-less dev
 * machines — the MemoryStore suite still covers the contract).
 */
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(databaseUrl === undefined)("postgres-backed contract", () => {
  runContractSuite("v1 API contract (PgStore)", async () => {
    if (databaseUrl === undefined) {
      throw new Error(
        "unreachable: suite is skipped without TEST_DATABASE_URL",
      );
    }
    const pool = createPool(databaseUrl);
    await runMigrations(pool);
    await pool.query(
      "truncate save_rejections, characters, sessions, users cascade",
    );
    return {
      store: new PgStore(pool),
      cleanup: async () => {
        await pool.end();
      },
    };
  });
});

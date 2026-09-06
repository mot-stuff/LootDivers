/**
 * DEC-044 audit sweep CLI (TASK-718).
 *
 * Re-validates every stored save blob against the DEC-043 validator and
 * prints a per-character report plus per-account write-time rejection
 * counts. Exits 1 when any stored save is invalid, 0 when all pass.
 *
 * On the droplet (runs inside the api container, DATABASE_URL is set):
 *   docker compose --env-file /opt/lootdivers/.env exec api npm run audit
 * Locally (after `npm run build`):
 *   DATABASE_URL=postgres://... npm run audit
 */
import { createPool } from "./db.js";
import { PgStore } from "./pg-store.js";
import { auditStoredSaves, renderAuditReport } from "./save-audit.js";

async function main(): Promise<number> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    console.error("Usage: DATABASE_URL=postgres://... npm run audit");
    return 2;
  }
  const pool = createPool(databaseUrl);
  try {
    const report = await auditStoredSaves(new PgStore(pool));
    console.log(renderAuditReport(report));
    return report.invalidFindings.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error("Audit failed:", error);
    process.exitCode = 2;
  },
);

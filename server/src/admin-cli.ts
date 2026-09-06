/**
 * Shared plumbing for the admin CLIs (ban/unban per DEC-044,
 * promote-admin/demote-admin per DEC-046).
 *
 * Since TASK-720 (DEC-046, amending DEC-044) ban/unban also exist as
 * admin-gated HTTP endpoints for the owner's web panel — but GRANTING the
 * admin role itself stays CLI-only, forever: these scripts run over SSH on
 * infrastructure the owner controls, so a compromised admin session can
 * never mint more admins.
 */
import { createPool } from "./db.js";
import { PgStore } from "./pg-store.js";
import type { UserRecord } from "./store.js";
import { normalizeEmail } from "./validation.js";
import { UUID_PATTERN } from "./http.js";
import type pg from "pg";

export interface AdminContext {
  readonly pool: pg.Pool;
  readonly store: PgStore;
}

export function openAdminContext(): AdminContext | null {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl === undefined || databaseUrl === "") {
    return null;
  }
  const pool = createPool(databaseUrl);
  return { pool, store: new PgStore(pool) };
}

/** Accepts an account UUID or an email address (case-insensitive). */
export async function resolveUser(
  store: PgStore,
  identifier: string,
): Promise<UserRecord | null> {
  if (UUID_PATTERN.test(identifier)) {
    return store.findUserById(identifier);
  }
  return store.findUserByEmail(normalizeEmail(identifier));
}

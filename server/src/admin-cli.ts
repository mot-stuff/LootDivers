/**
 * Shared plumbing for the DEC-044 admin scripts (ban/unban). Scripts only —
 * there are deliberately NO admin HTTP endpoints, so banning adds zero
 * network attack surface (TASK-718).
 */
import { createPool } from "./db.js";
import { PgStore } from "./pg-store.js";
import type { UserRecord } from "./store.js";
import { normalizeEmail } from "./validation.js";
import type pg from "pg";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

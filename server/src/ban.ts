/**
 * DEC-044 manual ban CLI (TASK-718).
 *
 *   npm run ban -- <accountEmailOrId> "<reason>"
 *
 * Sets users.banned_at/ban_reason. Enforcement is immediate: every
 * authenticated request checks the flag, so existing sessions are rejected
 * on their next request and login answers 403 account-banned. Reversible
 * with `npm run unban -- <accountEmailOrId>`.
 *
 * On the droplet:
 *   docker compose --env-file /opt/lootdivers/.env exec api \
 *     npm run ban -- cheater@example.com "audit 2026-09-05: forged gold"
 *
 * Deleting a banned account's characters stays a MANUAL, deliberate act
 * (DEC-044) — never automated here. When the owner decides to delete, run
 * against Postgres (docker compose exec postgres psql -U lootdivers):
 *   select id, name, level from characters
 *     where user_id = '<account uuid>';
 *   delete from characters where id = '<character uuid>';
 * The save_rejections audit trail intentionally survives such deletes.
 */
import { openAdminContext, resolveUser } from "./admin-cli.js";

async function main(): Promise<number> {
  const [identifier, ...reasonParts] = process.argv.slice(2);
  const reason = reasonParts.join(" ").trim();
  if (identifier === undefined || identifier === "" || reason === "") {
    console.error('Usage: npm run ban -- <accountEmailOrId> "<reason>"');
    return 2;
  }
  const context = openAdminContext();
  if (context === null) {
    console.error("DATABASE_URL is required.");
    return 2;
  }
  try {
    const user = await resolveUser(context.store, identifier);
    if (user === null) {
      console.error(`No account matches "${identifier}".`);
      return 1;
    }
    if (user.bannedAt !== null) {
      console.log(
        `Note: ${user.email} was already banned at ${user.bannedAt} (${user.banReason ?? "no reason recorded"}); overwriting.`,
      );
    }
    await context.store.banUser(user.id, reason);
    console.log(`BANNED ${user.email} (${user.id}): ${reason}`);
    console.log(
      "Sessions are rejected from their next request; login answers 403.",
    );
    return 0;
  } finally {
    await context.pool.end();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error("Ban failed:", error);
    process.exitCode = 2;
  },
);

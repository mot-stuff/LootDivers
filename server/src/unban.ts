/**
 * DEC-044 unban CLI (TASK-718): reverses `npm run ban`.
 *
 *   npm run unban -- <accountEmailOrId>
 *
 * Clears users.banned_at/ban_reason; the account logs in normally again
 * (existing sessions were never deleted, so they resume working too).
 */
import { openAdminContext, resolveUser } from "./admin-cli.js";

async function main(): Promise<number> {
  const [identifier] = process.argv.slice(2);
  if (identifier === undefined || identifier === "") {
    console.error("Usage: npm run unban -- <accountEmailOrId>");
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
    if (user.bannedAt === null) {
      console.log(`${user.email} (${user.id}) is not banned; nothing to do.`);
      return 0;
    }
    await context.store.unbanUser(user.id);
    console.log(`UNBANNED ${user.email} (${user.id}).`);
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
    console.error("Unban failed:", error);
    process.exitCode = 2;
  },
);

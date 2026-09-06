/**
 * DEC-046 admin demotion CLI (TASK-720): reverses `npm run promote-admin`.
 *
 *   npm run demote-admin -- <accountEmailOrId>
 *
 * Clears users.is_admin; the account keeps working as a normal player but
 * /admin/* answers 403 from its next request (the role is re-read from the
 * user row on every authenticated request).
 */
import { openAdminContext, resolveUser } from "./admin-cli.js";

async function main(): Promise<number> {
  const [identifier] = process.argv.slice(2);
  if (identifier === undefined || identifier === "") {
    console.error("Usage: npm run demote-admin -- <accountEmailOrId>");
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
    if (!user.isAdmin) {
      console.log(`${user.email} (${user.id}) is not an admin; nothing to do.`);
      return 0;
    }
    await context.store.setAdmin(user.id, false);
    console.log(`DEMOTED ${user.email} (${user.id}); admin routes now answer 403.`);
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
    console.error("Demote failed:", error);
    process.exitCode = 2;
  },
);

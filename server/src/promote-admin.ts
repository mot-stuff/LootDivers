/**
 * DEC-046 admin promotion CLI (TASK-720).
 *
 *   npm run promote-admin -- <accountEmailOrId>
 *
 * Sets users.is_admin. This CLI is the ONLY way to grant the admin role —
 * no HTTP endpoint may ever set it (DEC-046), so a compromised admin
 * session cannot mint more admins. Reversible with
 * `npm run demote-admin -- <accountEmailOrId>`.
 *
 * On the droplet:
 *   docker compose --env-file /opt/lootdivers/.env exec api \
 *     npm run promote-admin -- owner@example.com
 */
import { openAdminContext, resolveUser } from "./admin-cli.js";

async function main(): Promise<number> {
  const [identifier] = process.argv.slice(2);
  if (identifier === undefined || identifier === "") {
    console.error("Usage: npm run promote-admin -- <accountEmailOrId>");
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
    if (user.isAdmin) {
      console.log(`${user.email} (${user.id}) is already an admin; nothing to do.`);
      return 0;
    }
    await context.store.setAdmin(user.id, true);
    console.log(`PROMOTED ${user.email} (${user.id}) to admin.`);
    console.log(
      "Their /auth/session now reports isAdmin and /admin/* routes accept them.",
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
    console.error("Promote failed:", error);
    process.exitCode = 2;
  },
);

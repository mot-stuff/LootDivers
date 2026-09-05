import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/**
 * Ordered plain-SQL migrations, applied automatically at API startup
 * (runbook Part B: the owner never runs migrations by hand). Each
 * `NNNN_name.sql` file runs once, inside a transaction, recorded in
 * `schema_migrations`. Files must never be edited after shipping — add a
 * new numbered file instead (same discipline as the DEC-014 client chain).
 */
export async function runMigrations(
  pool: pg.Pool,
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<readonly string[]> {
  await pool.query(
    `create table if not exists schema_migrations (
       name       text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const appliedResult = await pool.query<{ name: string }>(
    "select name from schema_migrations",
  );
  const applied = new Set(appliedResult.rows.map((row) => row.name));

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [
        file,
      ]);
      await client.query("commit");
      newlyApplied.push(file);
    } catch (error) {
      await client.query("rollback");
      throw new Error(`Migration ${file} failed.`, { cause: error });
    } finally {
      client.release();
    }
  }
  return newlyApplied;
}

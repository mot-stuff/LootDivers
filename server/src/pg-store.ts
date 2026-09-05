import type pg from "pg";
import type {
  CharacterListRow,
  CharacterRecord,
  DataStore,
  SaveResult,
  SessionRecord,
  UserRecord,
} from "./store.js";

const UNIQUE_VIOLATION = "23505";

interface CharacterRow {
  readonly id: string;
  readonly user_id: string;
  readonly name: string;
  readonly class: string;
  readonly level: number;
  readonly revision: number;
  readonly blob: unknown;
  readonly updated_at: Date;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Production `DataStore` on Postgres. Ownership filtering happens in SQL. */
export class PgStore implements DataStore {
  readonly #pool: pg.Pool;

  public constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  public async createUser(
    email: string,
    passwordHash: string,
  ): Promise<UserRecord | "email-taken"> {
    try {
      const result = await this.#pool.query<{ id: string }>(
        `insert into users (email, password_hash) values ($1, $2) returning id`,
        [email, passwordHash],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new Error("Insert returned no row.");
      }
      return { id: row.id, email, passwordHash };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "email-taken";
      }
      throw error;
    }
  }

  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.#pool.query<{
      id: string;
      email: string;
      password_hash: string;
    }>(`select id, email, password_hash from users where email = $1`, [email]);
    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, email: row.email, passwordHash: row.password_hash };
  }

  public async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.#pool.query<{
      id: string;
      email: string;
      password_hash: string;
    }>(`select id, email, password_hash from users where id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined
      ? null
      : { id: row.id, email: row.email, passwordHash: row.password_hash };
  }

  public async createSession(session: SessionRecord): Promise<void> {
    await this.#pool.query(
      `insert into sessions (token_hash, user_id, expires_at)
       values ($1, $2, to_timestamp($3 / 1000.0))`,
      [session.tokenHash, session.userId, session.expiresAt],
    );
  }

  public async findSession(
    tokenHash: string,
    nowMs: number,
  ): Promise<SessionRecord | null> {
    // Lazy expiry: delete-and-miss instead of a background sweeper.
    await this.#pool.query(
      `delete from sessions where token_hash = $1 and expires_at <= to_timestamp($2 / 1000.0)`,
      [tokenHash, nowMs],
    );
    const result = await this.#pool.query<{
      token_hash: string;
      user_id: string;
      expires_at: Date;
    }>(
      `select token_hash, user_id, expires_at from sessions where token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row === undefined
      ? null
      : {
          tokenHash: row.token_hash,
          userId: row.user_id,
          expiresAt: row.expires_at.getTime(),
        };
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.#pool.query(`delete from sessions where token_hash = $1`, [
      tokenHash,
    ]);
  }

  public async listCharacters(
    userId: string,
  ): Promise<readonly CharacterListRow[]> {
    const result = await this.#pool.query<CharacterRow>(
      `select id, user_id, name, class, level, revision, null as blob, updated_at
       from characters where user_id = $1 order by lower(name)`,
      [userId],
    );
    return result.rows.map((row) => toListRow(row));
  }

  public async createCharacter(
    userId: string,
    name: string,
    characterClass: string,
    slotLimit: number,
  ): Promise<CharacterRecord | "name-taken" | "slot-limit"> {
    const client = await this.#pool.connect();
    try {
      await client.query("begin");
      // Serialize slot counting per account: lock the user row so two
      // concurrent creates cannot both pass the count check.
      await client.query(`select id from users where id = $1 for update`, [
        userId,
      ]);
      const countResult = await client.query<{ count: string }>(
        `select count(*)::text as count from characters where user_id = $1`,
        [userId],
      );
      const count = Number.parseInt(countResult.rows[0]?.count ?? "0", 10);
      if (count >= slotLimit) {
        await client.query("rollback");
        return "slot-limit";
      }
      const insertResult = await client.query<CharacterRow>(
        `insert into characters (user_id, name, class)
         values ($1, $2, $3)
         returning id, user_id, name, class, level, revision, blob, updated_at`,
        [userId, name, characterClass],
      );
      await client.query("commit");
      const row = insertResult.rows[0];
      if (row === undefined) {
        throw new Error("Insert returned no row.");
      }
      return toRecord(row);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      if (isUniqueViolation(error)) {
        return "name-taken";
      }
      throw error;
    } finally {
      client.release();
    }
  }

  public async getCharacter(
    userId: string,
    characterId: string,
  ): Promise<CharacterRecord | null> {
    const result = await this.#pool.query<CharacterRow>(
      `select id, user_id, name, class, level, revision, blob, updated_at
       from characters where id = $1 and user_id = $2`,
      [characterId, userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRecord(row);
  }

  public async saveCharacter(
    userId: string,
    characterId: string,
    envelope: unknown,
    level: number,
    formatVersion: number,
    checksum: string,
  ): Promise<SaveResult | null> {
    const result = await this.#pool.query<{ revision: number }>(
      `update characters set
         previous_blob     = blob,
         previous_revision = case when blob is null then null else revision end,
         blob              = $3::jsonb,
         revision          = revision + 1,
         level             = $4,
         format_version    = $5,
         checksum          = $6,
         updated_at        = now()
       where id = $1 and user_id = $2
       returning revision`,
      [
        characterId,
        userId,
        JSON.stringify(envelope),
        level,
        formatVersion,
        checksum,
      ],
    );
    const row = result.rows[0];
    return row === undefined ? null : { revision: row.revision };
  }

  public async deleteCharacter(
    userId: string,
    characterId: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `delete from characters where id = $1 and user_id = $2`,
      [characterId, userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async ping(): Promise<void> {
    await this.#pool.query("select 1");
  }
}

function toListRow(row: CharacterRow): CharacterListRow {
  return {
    id: row.id,
    name: row.name,
    class: row.class,
    level: row.level,
    updatedAt: row.updated_at.toISOString(),
  };
}

function toRecord(row: CharacterRow): CharacterRecord {
  return {
    ...toListRow(row),
    userId: row.user_id,
    envelope: row.blob,
    revision: row.revision,
  };
}

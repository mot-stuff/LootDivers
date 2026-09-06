import type pg from "pg";
import type {
  AuditableCharacter,
  CharacterListRow,
  CharacterRecord,
  DataStore,
  SaveRejectionCount,
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

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly banned_at: Date | null;
  readonly ban_reason: string | null;
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    bannedAt: row.banned_at === null ? null : row.banned_at.toISOString(),
    banReason: row.ban_reason,
  };
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
      return {
        id: row.id,
        email,
        passwordHash,
        bannedAt: null,
        banReason: null,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        return "email-taken";
      }
      throw error;
    }
  }

  public async findUserByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.#pool.query<UserRow>(
      `select id, email, password_hash, banned_at, ban_reason
       from users where email = $1`,
      [email],
    );
    const row = result.rows[0];
    return row === undefined ? null : toUserRecord(row);
  }

  public async findUserById(id: string): Promise<UserRecord | null> {
    const result = await this.#pool.query<UserRow>(
      `select id, email, password_hash, banned_at, ban_reason
       from users where id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : toUserRecord(row);
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
    envelopeRevision: number,
  ): Promise<SaveResult | "stale-revision" | null> {
    // DEC-043 monotonicity guard: the stored blob's own envelope `revision`
    // must be strictly below the incoming one. Enforced inside the UPDATE
    // predicate so concurrent writers race atomically; every stored blob
    // passed route validation, so `blob->>'revision'` is always an integer.
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
         and (blob is null or (blob->>'revision')::integer < $7)
       returning revision`,
      [
        characterId,
        userId,
        JSON.stringify(envelope),
        level,
        formatVersion,
        checksum,
        envelopeRevision,
      ],
    );
    const row = result.rows[0];
    if (row !== undefined) {
      return { revision: row.revision };
    }
    // Distinguish "not yours / missing" (404) from "yours but stale" (409).
    const owned = await this.#pool.query(
      `select 1 from characters where id = $1 and user_id = $2`,
      [characterId, userId],
    );
    return (owned.rowCount ?? 0) > 0 ? "stale-revision" : null;
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

  public async banUser(userId: string, reason: string): Promise<boolean> {
    const result = await this.#pool.query(
      `update users set banned_at = now(), ban_reason = $2 where id = $1`,
      [userId, reason],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async unbanUser(userId: string): Promise<boolean> {
    const result = await this.#pool.query(
      `update users set banned_at = null, ban_reason = null where id = $1`,
      [userId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  public async recordSaveRejection(
    userId: string,
    characterId: string,
    code: string,
  ): Promise<void> {
    await this.#pool.query(
      `insert into save_rejections (user_id, character_id, code)
       values ($1, $2, $3)`,
      [userId, characterId, code],
    );
  }

  public async listSaveRejectionCounts(): Promise<
    readonly SaveRejectionCount[]
  > {
    const result = await this.#pool.query<{
      user_id: string;
      email: string;
      count: string;
    }>(
      `select r.user_id, u.email, count(*)::text as count
       from save_rejections r
       join users u on u.id = r.user_id
       group by r.user_id, u.email
       order by u.email`,
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      count: Number.parseInt(row.count, 10),
    }));
  }

  public async listCharactersForAudit(): Promise<
    readonly AuditableCharacter[]
  > {
    const result = await this.#pool.query<{
      user_id: string;
      email: string;
      character_id: string;
      name: string;
      level: number;
      blob: unknown;
    }>(
      `select c.user_id, u.email, c.id as character_id, c.name, c.level, c.blob
       from characters c
       join users u on u.id = c.user_id
       where c.blob is not null
       order by u.email, lower(c.name)`,
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      characterId: row.character_id,
      characterName: row.name,
      level: row.level,
      envelope: row.blob,
    }));
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

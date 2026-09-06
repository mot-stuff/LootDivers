/**
 * Persistence port for the accounts API (TASK-707).
 *
 * Two implementations: `PgStore` (production, Postgres) and `MemoryStore`
 * (unit tests and Docker-less development). The API layer owns every rule
 * that is not a storage concern; the store owns uniqueness (email global,
 * character name per-account case-insensitive), the slot limit check, and
 * the one-deep previous-revision retention on save (DEC-032 last-write-wins
 * with recoverable overwrite).
 */

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  /** ISO-8601 when the account is banned (TASK-718/DEC-044); null otherwise. */
  readonly bannedAt: string | null;
  readonly banReason: string | null;
}

/** One account's total 4xx save-rejection count (DEC-044 audit signal). */
export interface SaveRejectionCount {
  readonly userId: string;
  readonly email: string;
  readonly count: number;
}

/** A stored character blob plus the identity the audit report prints. */
export interface AuditableCharacter {
  readonly userId: string;
  readonly email: string;
  readonly characterId: string;
  readonly characterName: string;
  /** The server-side list-metadata level column. */
  readonly level: number;
  /** The verbatim stored envelope; never null (audit skips unsaved rows). */
  readonly envelope: unknown;
}

export interface SessionRecord {
  readonly tokenHash: string;
  readonly userId: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export interface CharacterListRow {
  readonly id: string;
  readonly name: string;
  readonly class: string;
  readonly level: number;
  /** ISO-8601. */
  readonly updatedAt: string;
}

export interface CharacterRecord extends CharacterListRow {
  readonly userId: string;
  /** The verbatim envelope blob; null until the first save (contract §2). */
  readonly envelope: unknown;
  readonly revision: number;
}

export interface SaveResult {
  readonly revision: number;
}

export interface DataStore {
  /** Returns "email-taken" when the (lowercased) email already exists. */
  createUser(
    email: string,
    passwordHash: string,
  ): Promise<UserRecord | "email-taken">;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(id: string): Promise<UserRecord | null>;

  createSession(session: SessionRecord): Promise<void>;
  /** Never returns expired sessions (implementations may also delete them). */
  findSession(tokenHash: string, nowMs: number): Promise<SessionRecord | null>;
  deleteSession(tokenHash: string): Promise<void>;

  listCharacters(userId: string): Promise<readonly CharacterListRow[]>;
  /**
   * Returns "name-taken" on a per-account case-insensitive duplicate and
   * "slot-limit" when the account already has `slotLimit` characters.
   */
  createCharacter(
    userId: string,
    name: string,
    characterClass: string,
    slotLimit: number,
  ): Promise<CharacterRecord | "name-taken" | "slot-limit">;
  /** Ownership filter built in: returns null unless the row belongs to userId. */
  getCharacter(
    userId: string,
    characterId: string,
  ): Promise<CharacterRecord | null>;
  /**
   * Last-write-wins save with a monotonicity guard (TASK-717/DEC-043):
   * when the stored blob already carries an envelope `revision` greater
   * than or equal to `envelopeRevision`, the write is refused with
   * "stale-revision" and nothing changes. Otherwise rotates the current
   * blob into the one-deep previous slot, stores the new envelope
   * verbatim, bumps the server revision. Returns null when the character
   * does not exist or is not owned by userId.
   */
  saveCharacter(
    userId: string,
    characterId: string,
    envelope: unknown,
    level: number,
    formatVersion: number,
    checksum: string,
    envelopeRevision: number,
  ): Promise<SaveResult | "stale-revision" | null>;
  /** Returns false when the character does not exist or is not owned. */
  deleteCharacter(userId: string, characterId: string): Promise<boolean>;

  // --- TASK-718 (DEC-044): audit trail and manual bans -------------------

  /**
   * Sets (or overwrites) the ban flag. Returns false when no such user.
   * Enforcement happens in the API's auth paths, so existing sessions stop
   * working on their next request without being deleted.
   */
  banUser(userId: string, reason: string): Promise<boolean>;
  /** Clears the ban flag. Returns false when no such user. Idempotent. */
  unbanUser(userId: string): Promise<boolean>;

  /**
   * Appends one row to the save-rejection audit trail. `characterId` is the
   * id the request targeted — it may not exist or belong to the user
   * (content validation runs before the ownership lookup); the log judges
   * the ACCOUNT, so that is deliberate.
   */
  recordSaveRejection(
    userId: string,
    characterId: string,
    code: string,
  ): Promise<void>;
  /** Per-account rejection totals for the audit report, ordered by email. */
  listSaveRejectionCounts(): Promise<readonly SaveRejectionCount[]>;

  /**
   * Every character with a stored blob, across all accounts, for the
   * DEC-044 retroactive audit sweep. Ordered by email then name.
   */
  listCharactersForAudit(): Promise<readonly AuditableCharacter[]>;

  /** Health probe: resolves when the backing storage answers. */
  ping(): Promise<void>;
}

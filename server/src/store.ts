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

  /** Health probe: resolves when the backing storage answers. */
  ping(): Promise<void>;
}

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
  /** Admin role (TASK-720/DEC-046); granted/revoked by CLI only. */
  readonly isAdmin: boolean;
}

/** One account's total 4xx save-rejection count (DEC-044 audit signal). */
export interface SaveRejectionCount {
  readonly userId: string;
  readonly email: string;
  readonly count: number;
}

/** One save-rejection audit row (TASK-720 admin panel view of DEC-044). */
export interface SaveRejectionRow {
  readonly userId: string;
  readonly email: string;
  readonly characterId: string;
  readonly code: string;
  /** ISO-8601. */
  readonly createdAt: string;
}

/** Character line of the admin account lookup (TASK-720/DEC-046). */
export interface AdminCharacterInfo {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  /** From the stored blob's payload.character.zoneId; null before a save. */
  readonly zoneId: string | null;
  /** ISO-8601. */
  readonly updatedAt: string;
}

/** Minimal account view for the admin panel — never carries the hash. */
export interface AccountSummary {
  readonly id: string;
  readonly email: string;
  /** ISO-8601. */
  readonly createdAt: string;
  readonly bannedAt: string | null;
  readonly banReason: string | null;
  readonly isAdmin: boolean;
  readonly characters: readonly AdminCharacterInfo[];
}

/** One homepage news entry (TASK-720/DEC-046; replaces static news.json). */
export interface NewsEntryRecord {
  readonly id: string;
  readonly title: string;
  /** Plain text/markdown — renderers must escape, never inject as HTML. */
  readonly body: string;
  readonly author: string;
  /** ISO-8601; the public list orders newest-first on this. */
  readonly publishedAt: string;
}

export interface NewsDraft {
  readonly title: string;
  readonly body: string;
  readonly author: string;
  /** ISO-8601, or null to publish "now" (store clock). */
  readonly publishedAt: string | null;
}

export interface NewsPatch {
  readonly title: string;
  readonly body: string;
  /** Null keeps the stored value. */
  readonly author: string | null;
  /** Null keeps the stored value. */
  readonly publishedAt: string | null;
}

/** One character eligible for the public highscores board (DEC-048). */
export interface HighscoreCandidate {
  readonly name: string;
  readonly class: string;
  readonly level: number;
  /** Verbatim envelope blob; null until the first save. */
  readonly envelope: unknown;
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

  // --- TASK-720 (DEC-046): admin role, panel lookups, news ---------------

  /**
   * Grants or revokes the admin role. Returns false when no such user.
   * Called ONLY by the promote-admin/demote-admin CLIs — no HTTP path may
   * reach this method.
   */
  setAdmin(userId: string, isAdmin: boolean): Promise<boolean>;

  /** Newest-first save-rejection rows for the admin panel, capped at limit. */
  listRecentSaveRejections(limit: number): Promise<readonly SaveRejectionRow[]>;

  /**
   * The admin panel's account lookup: account flags plus its characters
   * (name sort, zone read from the stored blob). Null when the email is
   * unknown. Never exposes the password hash.
   */
  getAccountSummary(email: string): Promise<AccountSummary | null>;

  /** All news entries, newest-first by publishedAt. */
  listNews(): Promise<readonly NewsEntryRecord[]>;
  createNews(draft: NewsDraft): Promise<NewsEntryRecord>;
  /** Full-replace of title/body; author/publishedAt kept when patch is null. */
  updateNews(id: string, patch: NewsPatch): Promise<NewsEntryRecord | null>;
  /** Returns false when no such entry. */
  deleteNews(id: string): Promise<boolean>;

  /**
   * Every character with a stored blob, across all accounts, for the
   * DEC-044 retroactive audit sweep. Ordered by email then name.
   */
  listCharactersForAudit(): Promise<readonly AuditableCharacter[]>;

  /**
   * Every non-banned account's characters for the public highscores
   * board (DEC-048). Includes never-saved rows (envelope null) so a
   * freshly created hero still appears at level 1 / base damage.
   */
  listHighscoreCandidates(): Promise<readonly HighscoreCandidate[]>;

  /** Health probe: resolves when the backing storage answers. */
  ping(): Promise<void>;
}

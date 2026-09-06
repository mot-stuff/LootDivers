import { randomUUID } from "node:crypto";
import type {
  AccountSummary,
  AdminCharacterInfo,
  AuditableCharacter,
  CharacterListRow,
  CharacterRecord,
  DataStore,
  HighscoreCandidate,
  NewsDraft,
  NewsEntryRecord,
  NewsPatch,
  SaveRejectionCount,
  SaveRejectionRow,
  SaveResult,
  SessionRecord,
  UserRecord,
} from "./store.js";

/**
 * Reads the envelope's client-side generation counter from a stored blob.
 * Every stored blob passed the save route's validation (integer `revision`),
 * so a null here only means "no save yet".
 */
function envelopeRevisionOf(envelope: unknown): number | null {
  if (typeof envelope !== "object" || envelope === null) {
    return null;
  }
  const revision = (envelope as Record<string, unknown>).revision;
  return typeof revision === "number" && Number.isInteger(revision)
    ? revision
    : null;
}

/**
 * Reads payload.character.zoneId out of a stored blob for the admin account
 * lookup — same navigation PgStore does with a jsonb path expression.
 */
function envelopeZoneOf(envelope: unknown): string | null {
  if (typeof envelope !== "object" || envelope === null) {
    return null;
  }
  const payload = (envelope as Record<string, unknown>).payload;
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const character = (payload as Record<string, unknown>).character;
  if (typeof character !== "object" || character === null) {
    return null;
  }
  const zoneId = (character as Record<string, unknown>).zoneId;
  return typeof zoneId === "string" ? zoneId : null;
}

interface MemoryCharacter {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly class: string;
  level: number;
  revision: number;
  envelope: unknown;
  previousEnvelope: unknown;
  previousRevision: number | null;
  updatedAt: string;
}

/**
 * In-memory `DataStore` with the same observable semantics as `PgStore`
 * (documented decision per the TASK-707 packet: unit tests run the full
 * Fastify app against this fake because Docker/Postgres is not available on
 * every dev machine; the same contract suite also runs against real
 * Postgres when TEST_DATABASE_URL is set — see test/README note).
 */
interface MemorySaveRejection {
  readonly userId: string;
  readonly characterId: string;
  readonly code: string;
  readonly createdAt: string;
}

interface MemoryUser extends UserRecord {
  readonly createdAt: string;
}

interface MemoryNewsEntry extends NewsEntryRecord {
  /** Insertion counter breaking publishedAt ties deterministically. */
  readonly sequence: number;
}

export class MemoryStore implements DataStore {
  readonly #users = new Map<string, MemoryUser>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #characters = new Map<string, MemoryCharacter>();
  readonly #saveRejections: MemorySaveRejection[] = [];
  readonly #news = new Map<string, MemoryNewsEntry>();
  #newsSequence = 0;
  #now: () => string;

  public constructor(now: () => string = () => new Date().toISOString()) {
    this.#now = now;
  }

  public createUser(
    email: string,
    passwordHash: string,
  ): Promise<UserRecord | "email-taken"> {
    for (const user of this.#users.values()) {
      if (user.email === email) {
        return Promise.resolve("email-taken");
      }
    }
    const record: MemoryUser = {
      id: randomUUID(),
      email,
      passwordHash,
      bannedAt: null,
      banReason: null,
      isAdmin: false,
      createdAt: this.#now(),
    };
    this.#users.set(record.id, record);
    return Promise.resolve(record);
  }

  public findUserByEmail(email: string): Promise<UserRecord | null> {
    for (const user of this.#users.values()) {
      if (user.email === email) {
        return Promise.resolve(user);
      }
    }
    return Promise.resolve(null);
  }

  public findUserById(id: string): Promise<UserRecord | null> {
    return Promise.resolve(this.#users.get(id) ?? null);
  }

  public createSession(session: SessionRecord): Promise<void> {
    this.#sessions.set(session.tokenHash, session);
    return Promise.resolve();
  }

  public findSession(
    tokenHash: string,
    nowMs: number,
  ): Promise<SessionRecord | null> {
    const session = this.#sessions.get(tokenHash);
    if (session === undefined) {
      return Promise.resolve(null);
    }
    if (session.expiresAt <= nowMs) {
      this.#sessions.delete(tokenHash);
      return Promise.resolve(null);
    }
    return Promise.resolve(session);
  }

  public deleteSession(tokenHash: string): Promise<void> {
    this.#sessions.delete(tokenHash);
    return Promise.resolve();
  }

  public listCharacters(userId: string): Promise<readonly CharacterListRow[]> {
    const rows = [...this.#characters.values()]
      .filter((character) => character.userId === userId)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((character) => this.#toListRow(character));
    return Promise.resolve(rows);
  }

  public createCharacter(
    userId: string,
    name: string,
    characterClass: string,
    slotLimit: number,
  ): Promise<CharacterRecord | "name-taken" | "slot-limit"> {
    const owned = [...this.#characters.values()].filter(
      (character) => character.userId === userId,
    );
    if (owned.length >= slotLimit) {
      return Promise.resolve("slot-limit");
    }
    const lowered = name.toLowerCase();
    if (owned.some((character) => character.name.toLowerCase() === lowered)) {
      return Promise.resolve("name-taken");
    }
    const character: MemoryCharacter = {
      id: randomUUID(),
      userId,
      name,
      class: characterClass,
      level: 1,
      revision: 0,
      envelope: null,
      previousEnvelope: null,
      previousRevision: null,
      updatedAt: this.#now(),
    };
    this.#characters.set(character.id, character);
    return Promise.resolve(this.#toRecord(character));
  }

  public getCharacter(
    userId: string,
    characterId: string,
  ): Promise<CharacterRecord | null> {
    const character = this.#characters.get(characterId);
    if (character === undefined || character.userId !== userId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(this.#toRecord(character));
  }

  public saveCharacter(
    userId: string,
    characterId: string,
    envelope: unknown,
    level: number,
    _formatVersion: number,
    _checksum: string,
    envelopeRevision: number,
  ): Promise<SaveResult | "stale-revision" | null> {
    const character = this.#characters.get(characterId);
    if (character === undefined || character.userId !== userId) {
      return Promise.resolve(null);
    }
    // DEC-043 monotonicity guard, mirroring PgStore's SQL predicate: the
    // stored blob's own `revision` field must be strictly below the new one.
    const storedRevision = envelopeRevisionOf(character.envelope);
    if (storedRevision !== null && envelopeRevision <= storedRevision) {
      return Promise.resolve("stale-revision");
    }
    character.previousEnvelope = character.envelope;
    character.previousRevision =
      character.envelope === null ? null : character.revision;
    character.envelope = envelope;
    character.revision += 1;
    character.level = level;
    character.updatedAt = this.#now();
    return Promise.resolve({ revision: character.revision });
  }

  public deleteCharacter(
    userId: string,
    characterId: string,
  ): Promise<boolean> {
    const character = this.#characters.get(characterId);
    if (character === undefined || character.userId !== userId) {
      return Promise.resolve(false);
    }
    this.#characters.delete(characterId);
    return Promise.resolve(true);
  }

  public banUser(userId: string, reason: string): Promise<boolean> {
    const user = this.#users.get(userId);
    if (user === undefined) {
      return Promise.resolve(false);
    }
    this.#users.set(userId, {
      ...user,
      bannedAt: this.#now(),
      banReason: reason,
    });
    return Promise.resolve(true);
  }

  public unbanUser(userId: string): Promise<boolean> {
    const user = this.#users.get(userId);
    if (user === undefined) {
      return Promise.resolve(false);
    }
    this.#users.set(userId, { ...user, bannedAt: null, banReason: null });
    return Promise.resolve(true);
  }

  public recordSaveRejection(
    userId: string,
    characterId: string,
    code: string,
  ): Promise<void> {
    this.#saveRejections.push({
      userId,
      characterId,
      code,
      createdAt: this.#now(),
    });
    return Promise.resolve();
  }

  public listSaveRejectionCounts(): Promise<readonly SaveRejectionCount[]> {
    const counts = new Map<string, number>();
    for (const rejection of this.#saveRejections) {
      counts.set(rejection.userId, (counts.get(rejection.userId) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([userId, count]) => ({
        userId,
        email: this.#users.get(userId)?.email ?? "(deleted account)",
        count,
      }))
      .sort((a, b) => a.email.localeCompare(b.email));
    return Promise.resolve(rows);
  }

  public setAdmin(userId: string, isAdmin: boolean): Promise<boolean> {
    const user = this.#users.get(userId);
    if (user === undefined) {
      return Promise.resolve(false);
    }
    this.#users.set(userId, { ...user, isAdmin });
    return Promise.resolve(true);
  }

  public listRecentSaveRejections(
    limit: number,
  ): Promise<readonly SaveRejectionRow[]> {
    const rows = [...this.#saveRejections]
      .reverse()
      .slice(0, limit)
      .map((rejection) => ({
        userId: rejection.userId,
        email: this.#users.get(rejection.userId)?.email ?? "(deleted account)",
        characterId: rejection.characterId,
        code: rejection.code,
        createdAt: rejection.createdAt,
      }));
    return Promise.resolve(rows);
  }

  public getAccountSummary(email: string): Promise<AccountSummary | null> {
    for (const user of this.#users.values()) {
      if (user.email !== email) {
        continue;
      }
      const characters: AdminCharacterInfo[] = [...this.#characters.values()]
        .filter((character) => character.userId === user.id)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((character) => ({
          id: character.id,
          name: character.name,
          level: character.level,
          zoneId: envelopeZoneOf(character.envelope),
          updatedAt: character.updatedAt,
        }));
      return Promise.resolve({
        id: user.id,
        email: user.email,
        createdAt: user.createdAt,
        bannedAt: user.bannedAt,
        banReason: user.banReason,
        isAdmin: user.isAdmin,
        characters,
      });
    }
    return Promise.resolve(null);
  }

  public listNews(): Promise<readonly NewsEntryRecord[]> {
    const rows = [...this.#news.values()]
      .sort(
        (a, b) =>
          b.publishedAt.localeCompare(a.publishedAt) || b.sequence - a.sequence,
      )
      .map((entry) => this.#toNewsRecord(entry));
    return Promise.resolve(rows);
  }

  public createNews(draft: NewsDraft): Promise<NewsEntryRecord> {
    this.#newsSequence += 1;
    const entry: MemoryNewsEntry = {
      id: randomUUID(),
      title: draft.title,
      body: draft.body,
      author: draft.author,
      publishedAt: draft.publishedAt ?? this.#now(),
      sequence: this.#newsSequence,
    };
    this.#news.set(entry.id, entry);
    return Promise.resolve(this.#toNewsRecord(entry));
  }

  public updateNews(
    id: string,
    patch: NewsPatch,
  ): Promise<NewsEntryRecord | null> {
    const entry = this.#news.get(id);
    if (entry === undefined) {
      return Promise.resolve(null);
    }
    const updated: MemoryNewsEntry = {
      ...entry,
      title: patch.title,
      body: patch.body,
      author: patch.author ?? entry.author,
      publishedAt: patch.publishedAt ?? entry.publishedAt,
    };
    this.#news.set(id, updated);
    return Promise.resolve(this.#toNewsRecord(updated));
  }

  public deleteNews(id: string): Promise<boolean> {
    return Promise.resolve(this.#news.delete(id));
  }

  public listHighscoreCandidates(): Promise<readonly HighscoreCandidate[]> {
    const rows = [...this.#characters.values()]
      .filter((character) => {
        const owner = this.#users.get(character.userId);
        return owner !== undefined && owner.bannedAt === null;
      })
      .map((character) => ({
        name: character.name,
        class: character.class,
        level: character.level,
        envelope: character.envelope,
      }));
    return Promise.resolve(rows);
  }

  public listCharactersForAudit(): Promise<readonly AuditableCharacter[]> {
    const rows = [...this.#characters.values()]
      .filter((character) => character.envelope !== null)
      .map((character) => ({
        userId: character.userId,
        email: this.#users.get(character.userId)?.email ?? "(deleted account)",
        characterId: character.id,
        characterName: character.name,
        level: character.level,
        envelope: character.envelope,
      }))
      .sort(
        (a, b) =>
          a.email.localeCompare(b.email) ||
          a.characterName.localeCompare(b.characterName),
      );
    return Promise.resolve(rows);
  }

  public ping(): Promise<void> {
    return Promise.resolve();
  }

  #toListRow(character: MemoryCharacter): CharacterListRow {
    return {
      id: character.id,
      name: character.name,
      class: character.class,
      level: character.level,
      updatedAt: character.updatedAt,
    };
  }

  #toRecord(character: MemoryCharacter): CharacterRecord {
    return {
      ...this.#toListRow(character),
      userId: character.userId,
      envelope: character.envelope,
      revision: character.revision,
    };
  }

  #toNewsRecord(entry: MemoryNewsEntry): NewsEntryRecord {
    return {
      id: entry.id,
      title: entry.title,
      body: entry.body,
      author: entry.author,
      publishedAt: entry.publishedAt,
    };
  }
}

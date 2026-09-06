import { randomUUID } from "node:crypto";
import type {
  CharacterListRow,
  CharacterRecord,
  DataStore,
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
export class MemoryStore implements DataStore {
  readonly #users = new Map<string, UserRecord>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #characters = new Map<string, MemoryCharacter>();
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
    const record: UserRecord = { id: randomUUID(), email, passwordHash };
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
}

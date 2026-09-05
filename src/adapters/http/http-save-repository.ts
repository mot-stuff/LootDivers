import type { CharacterSave } from "../../core";
import type { CharacterSaveEnvelope } from "../../persistence/character-save-codec";
import {
  PersistenceError,
  type ChecksumProvider,
  type SaveClock,
  type SaveEnvelopeCodec,
  type SaveLoadResult,
  type SaveRepository,
} from "../../persistence/contracts";
import { ApiClient, ApiError } from "./api-client";

export interface HttpSaveRepositoryOptions {
  readonly client: ApiClient;
  /** Server-side character row id (UUID from POST /characters). */
  readonly characterId: string;
  readonly codec: SaveEnvelopeCodec<CharacterSave, CharacterSaveEnvelope>;
  readonly checksumProvider: ChecksumProvider;
  readonly clock: SaveClock;
  readonly build: string;
  readonly contentSchemaVersion: number;
}

function mapApiError(error: unknown, operation: string): PersistenceError {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return new PersistenceError("not-found", error.message, { cause: error });
    }
    if (error.status === 401) {
      return new PersistenceError(
        "blocked",
        `Character save ${operation} requires a signed-in session.`,
        { cause: error },
      );
    }
    if (error.status === 413) {
      return new PersistenceError("quota", error.message, { cause: error });
    }
    if (error.status === 422) {
      return new PersistenceError("corrupt", error.message, { cause: error });
    }
  }
  return new PersistenceError(
    "storage-unavailable",
    `Character save ${operation} failed: the save service is unreachable.`,
    { cause: error },
  );
}

/**
 * The DEC-032 HTTP sibling of `IndexedDbSaveRepository`: same
 * `SaveRepository` port, same codec, but the envelope lives in the
 * `characters.blob` column on the droplet (stored verbatim; validated,
 * checksummed, and migrated exclusively client-side by the injected codec).
 *
 * One instance binds to one server character row. `CharacterSaveService`
 * accepts this in place of the IndexedDB adapter unchanged — that swap (on
 * login/character select) is TASK-709's flow wiring.
 */
export class HttpSaveRepository implements SaveRepository<
  CharacterSave,
  CharacterSaveEnvelope
> {
  readonly #options: HttpSaveRepositoryOptions;
  #lastEnvelope: CharacterSaveEnvelope | null = null;

  public constructor(options: HttpSaveRepositoryOptions) {
    this.#options = options;
  }

  public async save(state: CharacterSave): Promise<CharacterSaveEnvelope> {
    const { client, characterId, codec, checksumProvider, clock } =
      this.#options;
    const previous = this.#lastEnvelope;
    const nowIso = clock.nowIso();
    const envelope = await codec.create(
      state,
      {
        saveId: `character:${characterId}`,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? nowIso,
        updatedAt: nowIso,
        build: this.#options.build,
        contentSchemaVersion: this.#options.contentSchemaVersion,
        migrationProvenance: previous?.migrationProvenance ?? [],
      },
      checksumProvider,
    );
    try {
      await client.saveCharacter(
        characterId,
        envelope,
        state.progression.level,
      );
    } catch (error) {
      throw mapApiError(error, "write");
    }
    this.#lastEnvelope = envelope;
    return envelope;
  }

  public async load(): Promise<
    SaveLoadResult<CharacterSave, CharacterSaveEnvelope>
  > {
    const { client, characterId, codec, checksumProvider, clock } =
      this.#options;
    let raw: unknown;
    try {
      const detail = await client.getCharacter(characterId);
      raw = detail.envelope;
    } catch (error) {
      throw mapApiError(error, "read");
    }
    if (raw === null || raw === undefined) {
      throw new PersistenceError(
        "not-found",
        "This character has never saved.",
      );
    }
    // Client-side validation and migration (DEC-032: the server stores the
    // blob verbatim and never migrates). Checksum or shape failures throw
    // PersistenceError, which CharacterSaveService treats as no-save.
    const decoded = await codec.decode(raw, checksumProvider, clock);
    this.#lastEnvelope = decoded.envelope;
    return {
      state: decoded.state,
      envelope: decoded.envelope,
      source: "active",
      recoveredFromInvalidGeneration: false,
    };
  }

  public async exportJson(): Promise<string> {
    const result = await this.load();
    return this.#options.codec.serialize(result.envelope);
  }

  public async importJson(
    serializedEnvelope: string,
  ): Promise<CharacterSaveEnvelope> {
    const { client, characterId, codec, checksumProvider, clock } =
      this.#options;
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedEnvelope);
    } catch (error) {
      throw new PersistenceError(
        "invalid-import",
        "Import is not valid JSON.",
        { cause: error },
      );
    }
    const decoded = await codec.decode(parsed, checksumProvider, clock);
    try {
      await client.saveCharacter(
        characterId,
        decoded.envelope,
        decoded.state.progression.level,
      );
    } catch (error) {
      throw mapApiError(error, "import");
    }
    this.#lastEnvelope = decoded.envelope;
    return decoded.envelope;
  }
}

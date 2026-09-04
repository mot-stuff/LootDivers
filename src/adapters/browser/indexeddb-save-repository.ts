import {
  PersistenceError,
  createSaveEnvelope,
  decodeSaveEnvelope,
  parseSaveJson,
  serializeSaveEnvelope,
  type ChecksumProvider,
  type FixtureSaveState,
  type SaveClock,
  type SaveEnvelopeV2,
  type SaveLoadResult,
  type SaveRepository,
} from "../../persistence";

const DATABASE_VERSION = 2;
const GENERATIONS_STORE = "generations";
const METADATA_STORE = "metadata";
const POINTERS_KEY = "fixture-pointers";

interface GenerationRecord {
  readonly generation: number;
  readonly envelope: unknown;
}

interface PointerRecord {
  readonly key: typeof POINTERS_KEY;
  readonly activeGeneration: number | null;
  readonly backupGeneration: number | null;
  readonly nextGeneration: number;
}

interface LoadedGeneration extends SaveLoadResult {
  readonly generation: number;
}

export type PersistenceFault = "quota" | "write-aborted";

/**
 * Deterministic failure seam for browser verification. Production code never
 * arms it; it avoids trying to exhaust a user's real quota in tests.
 */
export class PersistenceFaultInjector {
  private nextFault: PersistenceFault | null = null;

  arm(fault: PersistenceFault): void {
    this.nextFault = fault;
  }

  consume(fault: PersistenceFault): boolean {
    if (this.nextFault !== fault) {
      return false;
    }

    this.nextFault = null;
    return true;
  }
}

export interface IndexedDbSaveRepositoryOptions {
  readonly databaseName: string;
  readonly saveId: string;
  readonly build: string;
  readonly contentSchemaVersion: number;
  readonly checksumProvider: ChecksumProvider;
  readonly clock: SaveClock;
  readonly faultInjector?: PersistenceFaultInjector;
}

function mapStorageError(error: unknown, operation: string): PersistenceError {
  if (error instanceof PersistenceError) {
    return error;
  }

  if (error instanceof DOMException) {
    if (error.name === "QuotaExceededError") {
      return new PersistenceError(
        "quota",
        `The browser storage quota was exceeded while ${operation}. Export a backup or free site storage.`,
        { cause: error },
      );
    }

    if (error.name === "AbortError") {
      return new PersistenceError(
        "write-aborted",
        `The browser aborted the save transaction while ${operation}. The previous validated save remains active.`,
        { cause: error },
      );
    }
  }

  return new PersistenceError(
    "storage-unavailable",
    `Browser storage is unavailable while ${operation}. Private browsing, storage policy, or origin changes may be responsible.`,
    { cause: error },
  );
}

function idbError(error: DOMException | null, fallback: string): Error {
  return error ?? new Error(fallback);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(idbError(request.error, "IndexedDB request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(idbError(transaction.error, "IndexedDB transaction aborted."));
    transaction.onerror = () => {
      // The abort event carries the final transaction error.
    };
  });
}

function defaultPointers(): PointerRecord {
  return {
    key: POINTERS_KEY,
    activeGeneration: null,
    backupGeneration: null,
    nextGeneration: 1,
  };
}

export class IndexedDbSaveRepository implements SaveRepository {
  private readonly options: IndexedDbSaveRepositoryOptions;
  private debugHeldDatabase: IDBDatabase | undefined;

  constructor(options: IndexedDbSaveRepositoryOptions) {
    this.options = options;
  }

  private async open(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(
        this.options.databaseName,
        DATABASE_VERSION,
      );
      let settled = false;

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains(GENERATIONS_STORE)) {
          database.createObjectStore(GENERATIONS_STORE, {
            keyPath: "generation",
          });
        }

        if (!database.objectStoreNames.contains(METADATA_STORE)) {
          database.createObjectStore(METADATA_STORE, { keyPath: "key" });
        }
      };
      request.onblocked = () => {
        settled = true;
        reject(
          new PersistenceError(
            "blocked",
            "Browser storage is blocked by another open tab or pending database upgrade. Close other tabs and retry.",
          ),
        );
      };
      request.onerror = () => {
        settled = true;
        reject(
          idbError(request.error, "IndexedDB could not open the database."),
        );
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }

        settled = true;
        resolve(request.result);
      };
    });
  }

  private async readPointers(database: IDBDatabase): Promise<PointerRecord> {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const record: unknown = await requestResult<unknown>(
      transaction.objectStore(METADATA_STORE).get(POINTERS_KEY),
    );
    await completion;
    return (record as PointerRecord | undefined) ?? defaultPointers();
  }

  private async readGeneration(
    database: IDBDatabase,
    generation: number,
  ): Promise<GenerationRecord | undefined> {
    const transaction = database.transaction(GENERATIONS_STORE, "readonly");
    const completion = transactionComplete(transaction);
    const record: unknown = await requestResult<unknown>(
      transaction.objectStore(GENERATIONS_STORE).get(generation),
    );
    await completion;
    return record as GenerationRecord | undefined;
  }

  private async loadGeneration(
    database: IDBDatabase,
    generation: number,
    source: "active" | "backup",
    recoveredFromInvalidGeneration: boolean,
  ): Promise<LoadedGeneration> {
    const record = await this.readGeneration(database, generation);

    if (record === undefined) {
      throw new PersistenceError(
        "corrupt",
        `Save generation ${generation} is missing.`,
      );
    }

    const decoded = await decodeSaveEnvelope(
      record.envelope,
      this.options.checksumProvider,
      this.options.clock,
    );
    return {
      generation,
      source,
      recoveredFromInvalidGeneration,
      envelope: decoded.envelope,
      state: decoded.envelope.payload.fixture,
    };
  }

  private async loadInternal(database: IDBDatabase): Promise<LoadedGeneration> {
    const pointers = await this.readPointers(database);
    const candidates = [
      { generation: pointers.activeGeneration, source: "active" as const },
      { generation: pointers.backupGeneration, source: "backup" as const },
    ];
    let invalidNewest = false;

    for (const candidate of candidates) {
      if (candidate.generation === null) {
        continue;
      }

      try {
        return await this.loadGeneration(
          database,
          candidate.generation,
          candidate.source,
          invalidNewest,
        );
      } catch (error) {
        if (
          error instanceof PersistenceError &&
          (error.code === "checksum" ||
            error.code === "corrupt" ||
            error.code === "unsupported-version")
        ) {
          invalidNewest = true;
          continue;
        }

        throw error;
      }
    }

    if (invalidNewest) {
      throw new PersistenceError(
        "corrupt",
        "No validated save generation is available.",
      );
    }

    throw new PersistenceError("not-found", "No local fixture save exists.");
  }

  async load(): Promise<SaveLoadResult> {
    let database: IDBDatabase | undefined;

    try {
      database = await this.open();
      const loaded = await this.loadInternal(database);
      return {
        source: loaded.source,
        recoveredFromInvalidGeneration: loaded.recoveredFromInvalidGeneration,
        envelope: loaded.envelope,
        state: loaded.state,
      };
    } catch (error) {
      throw mapStorageError(error, "loading the local save");
    } finally {
      database?.close();
    }
  }

  private async stageGeneration(
    database: IDBDatabase,
    envelope: SaveEnvelopeV2,
  ): Promise<number> {
    if (this.options.faultInjector?.consume("quota") === true) {
      throw new DOMException("Synthetic quota failure.", "QuotaExceededError");
    }

    const transaction = database.transaction(
      [GENERATIONS_STORE, METADATA_STORE],
      "readwrite",
    );
    const completion = transactionComplete(transaction);

    try {
      const metadataStore = transaction.objectStore(METADATA_STORE);
      const current =
        ((await requestResult(metadataStore.get(POINTERS_KEY))) as
          PointerRecord | undefined) ?? defaultPointers();
      const generation = current.nextGeneration;
      transaction.objectStore(GENERATIONS_STORE).put({
        generation,
        envelope,
      } satisfies GenerationRecord);
      metadataStore.put({
        ...current,
        nextGeneration: generation + 1,
      } satisfies PointerRecord);
      await completion;
      return generation;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // A failed request may already have completed the transaction abort.
      }
      throw error;
    }
  }

  private async promoteGeneration(
    database: IDBDatabase,
    generation: number,
    backupGeneration: number | null,
  ): Promise<void> {
    if (this.options.faultInjector?.consume("write-aborted") === true) {
      throw new DOMException("Synthetic interrupted write.", "AbortError");
    }

    const transaction = database.transaction(METADATA_STORE, "readwrite");
    const completion = transactionComplete(transaction);
    const metadataStore = transaction.objectStore(METADATA_STORE);
    const current =
      ((await requestResult(metadataStore.get(POINTERS_KEY))) as
        PointerRecord | undefined) ?? defaultPointers();
    metadataStore.put({
      ...current,
      activeGeneration: generation,
      backupGeneration,
    } satisfies PointerRecord);
    await completion;
  }

  private async persistEnvelope(
    database: IDBDatabase,
    envelope: SaveEnvelopeV2,
    previousValidGeneration: number | null,
  ): Promise<SaveEnvelopeV2> {
    const generation = await this.stageGeneration(database, envelope);

    // A completed write is not trusted until it is read back, structurally
    // validated, and checksum-verified.
    await this.loadGeneration(database, generation, "active", false);
    await this.promoteGeneration(database, generation, previousValidGeneration);
    return envelope;
  }

  async save(state: FixtureSaveState): Promise<SaveEnvelopeV2> {
    let database: IDBDatabase | undefined;

    try {
      database = await this.open();
      let previous: LoadedGeneration | undefined;

      try {
        previous = await this.loadInternal(database);
      } catch (error) {
        if (
          !(error instanceof PersistenceError) ||
          error.code !== "not-found"
        ) {
          throw error;
        }
      }

      const now = this.options.clock.nowIso();
      const envelope = await createSaveEnvelope(
        state,
        {
          saveId: this.options.saveId,
          revision: (previous?.envelope.revision ?? 0) + 1,
          createdAt: previous?.envelope.createdAt ?? now,
          updatedAt: now,
          build: this.options.build,
          contentSchemaVersion: this.options.contentSchemaVersion,
        },
        this.options.checksumProvider,
      );
      return await this.persistEnvelope(
        database,
        envelope,
        previous?.generation ?? null,
      );
    } catch (error) {
      throw mapStorageError(error, "saving the local fixture");
    } finally {
      database?.close();
    }
  }

  async exportJson(): Promise<string> {
    const loaded = await this.load();
    return serializeSaveEnvelope(loaded.envelope);
  }

  async importJson(serializedEnvelope: string): Promise<SaveEnvelopeV2> {
    let decoded;

    try {
      decoded = await decodeSaveEnvelope(
        parseSaveJson(serializedEnvelope),
        this.options.checksumProvider,
        this.options.clock,
      );
    } catch (error) {
      throw new PersistenceError(
        "invalid-import",
        "Imported save failed format, fixture-state, migration, or checksum validation. The current save was not changed.",
        { cause: error },
      );
    }

    let database: IDBDatabase | undefined;

    try {
      database = await this.open();
      let previous: LoadedGeneration | undefined;

      try {
        previous = await this.loadInternal(database);
      } catch (error) {
        if (
          !(error instanceof PersistenceError) ||
          error.code !== "not-found"
        ) {
          throw error;
        }
      }

      const now = this.options.clock.nowIso();
      const importedEnvelope = await createSaveEnvelope(
        decoded.envelope.payload.fixture,
        {
          saveId: this.options.saveId,
          revision: (previous?.envelope.revision ?? 0) + 1,
          createdAt: previous?.envelope.createdAt ?? decoded.envelope.createdAt,
          updatedAt: now,
          build: this.options.build,
          contentSchemaVersion: this.options.contentSchemaVersion,
        },
        this.options.checksumProvider,
      );
      return await this.persistEnvelope(
        database,
        importedEnvelope,
        previous?.generation ?? null,
      );
    } catch (error) {
      throw mapStorageError(error, "importing the local fixture");
    } finally {
      database?.close();
    }
  }

  async debugCorruptActiveGeneration(): Promise<void> {
    let database: IDBDatabase | undefined;

    try {
      database = await this.open();
      const pointers = await this.readPointers(database);

      if (pointers.activeGeneration === null) {
        throw new PersistenceError("not-found", "No active generation exists.");
      }

      const transaction = database.transaction(GENERATIONS_STORE, "readwrite");
      const completion = transactionComplete(transaction);
      const store = transaction.objectStore(GENERATIONS_STORE);
      const current = (await requestResult(
        store.get(pointers.activeGeneration),
      )) as GenerationRecord | undefined;

      if (current === undefined) {
        throw new PersistenceError("corrupt", "Active generation is missing.");
      }

      const envelope = current.envelope as Record<string, unknown>;
      store.put({
        ...current,
        envelope: { ...envelope, revision: -1 },
      } satisfies GenerationRecord);
      await completion;
    } finally {
      database?.close();
    }
  }

  async debugPrepareBlockedUpgrade(): Promise<void> {
    this.debugHeldDatabase?.close();
    this.debugHeldDatabase = undefined;

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(this.options.databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () =>
        reject(idbError(request.error, "Could not reset the test database."));
      request.onblocked = () =>
        reject(new Error("Test database deletion was unexpectedly blocked."));
    });

    this.debugHeldDatabase = await new Promise<IDBDatabase>(
      (resolve, reject) => {
        const request = indexedDB.open(this.options.databaseName, 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(
            idbError(request.error, "Could not open the legacy test database."),
          );
      },
    );
  }

  debugReleaseBlockedUpgrade(): void {
    this.debugHeldDatabase?.close();
    this.debugHeldDatabase = undefined;
  }

  async debugReset(): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(
      [GENERATIONS_STORE, METADATA_STORE],
      "readwrite",
    );
    const completion = transactionComplete(transaction);
    transaction.objectStore(GENERATIONS_STORE).clear();
    transaction.objectStore(METADATA_STORE).clear();
    await completion;
    database.close();
  }
}

import {
  PersistenceError,
  type FixtureSaveState,
  type PersistenceStatusSink,
  type SaveEnvelopeV2,
  type SaveLoadResult,
  type SaveRepository,
} from "./contracts";

export class PersistenceFixtureService {
  private readonly repository: SaveRepository;
  private readonly statusSink: PersistenceStatusSink;

  constructor(repository: SaveRepository, statusSink: PersistenceStatusSink) {
    this.repository = repository;
    this.statusSink = statusSink;
  }

  private publishError(error: unknown): void {
    const persistenceError =
      error instanceof PersistenceError
        ? error
        : new PersistenceError(
            "storage-unavailable",
            "An unexpected local persistence error occurred.",
            { cause: error },
          );
    this.statusSink.publish({
      kind: "error",
      code: persistenceError.code,
      message: persistenceError.message,
    });
  }

  async save(state: FixtureSaveState): Promise<SaveEnvelopeV2> {
    this.statusSink.publish({
      kind: "working",
      message: "Saving a validated generation…",
    });

    try {
      const envelope = await this.repository.save(state);
      this.statusSink.publish({
        kind: "saved",
        message: `Validated revision ${envelope.revision} is active; the previous generation is retained as backup.`,
      });
      return envelope;
    } catch (error) {
      this.publishError(error);
      throw error;
    }
  }

  async load(): Promise<SaveLoadResult> {
    this.statusSink.publish({
      kind: "working",
      message: "Loading and validating local generations…",
    });

    try {
      const result = await this.repository.load();
      this.statusSink.publish(
        result.recoveredFromInvalidGeneration
          ? {
              kind: "recovered",
              message:
                "The newest generation was invalid. Loaded the last-known-good backup safely.",
            }
          : {
              kind: "loaded",
              message: `Loaded validated revision ${result.envelope.revision}.`,
            },
      );
      return result;
    } catch (error) {
      this.publishError(error);
      throw error;
    }
  }

  async exportJson(): Promise<string> {
    this.statusSink.publish({
      kind: "working",
      message: "Validating save before export…",
    });

    try {
      const serialized = await this.repository.exportJson();
      this.statusSink.publish({
        kind: "loaded",
        message: "Validated JSON export is ready.",
      });
      return serialized;
    } catch (error) {
      this.publishError(error);
      throw error;
    }
  }

  async importJson(serializedEnvelope: string): Promise<SaveEnvelopeV2> {
    this.statusSink.publish({
      kind: "working",
      message: "Validating import before replacement…",
    });

    try {
      const envelope = await this.repository.importJson(serializedEnvelope);
      this.statusSink.publish({
        kind: "saved",
        message: `Imported and activated validated revision ${envelope.revision}.`,
      });
      return envelope;
    } catch (error) {
      this.publishError(error);
      throw error;
    }
  }
}

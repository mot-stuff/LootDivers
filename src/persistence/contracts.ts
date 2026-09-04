export const SAVE_FORMAT = "rarpg-local-fixture-save";
export const CURRENT_SAVE_VERSION = 2;
export const CHECKSUM_ALGORITHM = "SHA-256";

export interface FixtureMarker {
  readonly id: string;
  readonly value: number;
}

/**
 * Synthetic Phase 0 state only. Production character and world DTOs are
 * intentionally not implied by this fixture.
 */
export interface FixtureSaveState {
  readonly label: string;
  readonly counter: number;
  readonly markers: readonly FixtureMarker[];
}

export interface SaveCompatibility {
  readonly build: string;
  readonly contentSchemaVersion: number;
}

export interface MigrationRecord {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly migratedAt: string;
}

export interface SaveChecksum {
  readonly algorithm: typeof CHECKSUM_ALGORITHM;
  readonly value: string;
}

export interface SaveEnvelopeV2 {
  readonly format: typeof SAVE_FORMAT;
  readonly formatVersion: typeof CURRENT_SAVE_VERSION;
  readonly saveId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly compatibility: SaveCompatibility;
  readonly migrationProvenance: readonly MigrationRecord[];
  readonly payload: {
    readonly fixture: FixtureSaveState;
  };
  readonly checksum: SaveChecksum;
}

export interface SaveEnvelopeV1 {
  readonly format: typeof SAVE_FORMAT;
  readonly formatVersion: 1;
  readonly saveId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly compatibility: SaveCompatibility;
  readonly payload: {
    readonly fixtureName: string;
    readonly fixtureCount: number;
    readonly markerValues: Readonly<Record<string, number>>;
  };
  readonly checksum: SaveChecksum;
}

export type SupportedSaveEnvelope = SaveEnvelopeV1 | SaveEnvelopeV2;

export interface SaveMetadata {
  readonly saveId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly build: string;
  readonly contentSchemaVersion: number;
  readonly migrationProvenance?: readonly MigrationRecord[];
}

export interface ChecksumProvider {
  digest(canonicalValue: string): Promise<string>;
}

export interface SaveClock {
  nowIso(): string;
}

export type PersistenceErrorCode =
  | "blocked"
  | "checksum"
  | "corrupt"
  | "invalid-import"
  | "not-found"
  | "quota"
  | "storage-unavailable"
  | "unsupported-version"
  | "write-aborted";

export class PersistenceError extends Error {
  readonly code: PersistenceErrorCode;

  constructor(
    code: PersistenceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PersistenceError";
    this.code = code;
  }
}

export interface SaveLoadResult {
  readonly state: FixtureSaveState;
  readonly envelope: SaveEnvelopeV2;
  readonly source: "active" | "backup";
  readonly recoveredFromInvalidGeneration: boolean;
}

export interface SaveRepository {
  save(state: FixtureSaveState): Promise<SaveEnvelopeV2>;
  load(): Promise<SaveLoadResult>;
  exportJson(): Promise<string>;
  importJson(serializedEnvelope: string): Promise<SaveEnvelopeV2>;
}

export type PersistenceStatus =
  | { readonly kind: "idle"; readonly message: string }
  | { readonly kind: "working"; readonly message: string }
  | { readonly kind: "saved"; readonly message: string }
  | { readonly kind: "loaded"; readonly message: string }
  | { readonly kind: "recovered"; readonly message: string }
  | {
      readonly kind: "error";
      readonly code: PersistenceErrorCode;
      readonly message: string;
    };

export interface PersistenceStatusSink {
  publish(status: PersistenceStatus): void;
}

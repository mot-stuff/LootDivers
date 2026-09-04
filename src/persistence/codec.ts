import { canonicalJson, withoutChecksum } from "./canonical-json";
import {
  CHECKSUM_ALGORITHM,
  CURRENT_SAVE_VERSION,
  PersistenceError,
  SAVE_FORMAT,
  type ChecksumProvider,
  type FixtureSaveState,
  type SaveClock,
  type SaveEnvelopeV1,
  type SaveEnvelopeV2,
  type SaveMetadata,
} from "./contracts";
import { validateEnvelopeStructure, validateFixtureState } from "./validation";

export interface DecodedSave {
  readonly envelope: SaveEnvelopeV2;
  readonly migratedFromVersion: number | null;
}

async function checksumEnvelope(
  value: unknown,
  checksumProvider: ChecksumProvider,
): Promise<void> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new PersistenceError("corrupt", "Save envelope must be an object.");
  }

  const rawEnvelope = value as Record<string, unknown>;
  const checksum = rawEnvelope.checksum;

  if (
    checksum === null ||
    typeof checksum !== "object" ||
    Array.isArray(checksum) ||
    typeof (checksum as Record<string, unknown>).value !== "string"
  ) {
    throw new PersistenceError(
      "corrupt",
      "Save envelope checksum is missing or malformed.",
    );
  }

  const unsigned = withoutChecksum(rawEnvelope);
  const actual = await checksumProvider.digest(canonicalJson(unsigned));
  const expected = (checksum as Record<string, unknown>).value;

  if (actual !== expected) {
    throw new PersistenceError(
      "checksum",
      "Save checksum validation failed. The generation may be incomplete or corrupt.",
    );
  }
}

async function signV2(
  unsigned: Omit<SaveEnvelopeV2, "checksum">,
  checksumProvider: ChecksumProvider,
): Promise<SaveEnvelopeV2> {
  const digest = await checksumProvider.digest(canonicalJson(unsigned));
  const signed: SaveEnvelopeV2 = {
    ...unsigned,
    checksum: { algorithm: CHECKSUM_ALGORITHM, value: digest },
  };
  const validated = validateEnvelopeStructure(signed);

  if (validated.formatVersion !== CURRENT_SAVE_VERSION) {
    throw new PersistenceError(
      "corrupt",
      "Internal save signing produced an unexpected format version.",
    );
  }

  return validated;
}

export async function createSaveEnvelope(
  state: FixtureSaveState,
  metadata: SaveMetadata,
  checksumProvider: ChecksumProvider,
): Promise<SaveEnvelopeV2> {
  const fixture = validateFixtureState(state);
  return signV2(
    {
      format: SAVE_FORMAT,
      formatVersion: CURRENT_SAVE_VERSION,
      saveId: metadata.saveId,
      revision: metadata.revision,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      compatibility: {
        build: metadata.build,
        contentSchemaVersion: metadata.contentSchemaVersion,
      },
      migrationProvenance: metadata.migrationProvenance ?? [],
      payload: { fixture },
    },
    checksumProvider,
  );
}

async function migrateV1ToV2(
  envelope: SaveEnvelopeV1,
  checksumProvider: ChecksumProvider,
  clock: SaveClock,
): Promise<SaveEnvelopeV2> {
  const migratedAt = clock.nowIso();
  const markers = Object.entries(envelope.payload.markerValues)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, value]) => ({ id, value }));

  return signV2(
    {
      format: SAVE_FORMAT,
      formatVersion: CURRENT_SAVE_VERSION,
      saveId: envelope.saveId,
      revision: envelope.revision,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      compatibility: envelope.compatibility,
      migrationProvenance: [{ fromVersion: 1, toVersion: 2, migratedAt }],
      payload: {
        fixture: {
          label: envelope.payload.fixtureName,
          counter: envelope.payload.fixtureCount,
          markers,
        },
      },
    },
    checksumProvider,
  );
}

export async function decodeSaveEnvelope(
  value: unknown,
  checksumProvider: ChecksumProvider,
  clock: SaveClock,
): Promise<DecodedSave> {
  await checksumEnvelope(value, checksumProvider);
  const envelope = validateEnvelopeStructure(value);

  if (envelope.formatVersion === CURRENT_SAVE_VERSION) {
    return { envelope, migratedFromVersion: null };
  }

  return {
    envelope: await migrateV1ToV2(envelope, checksumProvider, clock),
    migratedFromVersion: envelope.formatVersion,
  };
}

export function parseSaveJson(serializedEnvelope: string): unknown {
  try {
    return JSON.parse(serializedEnvelope) as unknown;
  } catch (error) {
    throw new PersistenceError(
      "invalid-import",
      "Imported save is not valid JSON.",
      { cause: error },
    );
  }
}

export function serializeSaveEnvelope(envelope: SaveEnvelopeV2): string {
  return `${canonicalJson(envelope)}\n`;
}

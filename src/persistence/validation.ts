import {
  CHECKSUM_ALGORITHM,
  CURRENT_SAVE_VERSION,
  PersistenceError,
  SAVE_FORMAT,
  type FixtureMarker,
  type FixtureSaveState,
  type MigrationRecord,
  type SaveCompatibility,
  type SaveEnvelopeV1,
  type SaveEnvelopeV2,
  type SaveChecksum,
  type SupportedSaveEnvelope,
} from "./contracts";

const STABLE_ID_PATTERN = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._/-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function invalid(message: string): never {
  throw new PersistenceError("corrupt", message);
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${path} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function exactKeysAt(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
): void {
  const expected = new Set(expectedKeys);
  const unknownKeys = Object.keys(value).filter((key) => !expected.has(key));

  if (unknownKeys.length > 0) {
    invalid(`${path} contains unknown field "${unknownKeys.sort()[0]}".`);
  }

  const missingKeys = expectedKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(value, key),
  );

  if (missingKeys.length > 0) {
    invalid(`${path} is missing required field "${missingKeys[0]}".`);
  }
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") {
    return invalid(`${path} must be a string.`);
  }

  return value;
}

function integerAt(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return invalid(`${path} must be a safe integer >= ${minimum}.`);
  }

  return value as number;
}

function finiteNumberAt(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(`${path} must be a finite number.`);
  }

  return value;
}

function isoDateAt(value: unknown, path: string): string {
  const date = stringAt(value, path);

  if (Number.isNaN(Date.parse(date)) || new Date(date).toISOString() !== date) {
    return invalid(`${path} must be an ISO-8601 UTC timestamp.`);
  }

  return date;
}

function stableIdAt(value: unknown, path: string): string {
  const id = stringAt(value, path);

  if (!STABLE_ID_PATTERN.test(id)) {
    return invalid(`${path} must be a lowercase namespaced stable ID.`);
  }

  return id;
}

function compatibilityAt(value: unknown): SaveCompatibility {
  const compatibility = objectAt(value, "compatibility");
  exactKeysAt(
    compatibility,
    ["build", "contentSchemaVersion"],
    "compatibility",
  );
  const build = stringAt(compatibility.build, "compatibility.build");

  if (build.length === 0) {
    return invalid("compatibility.build must not be empty.");
  }

  return {
    build,
    contentSchemaVersion: integerAt(
      compatibility.contentSchemaVersion,
      "compatibility.contentSchemaVersion",
      1,
    ),
  };
}

function checksumAt(value: unknown): SaveChecksum {
  const checksum = objectAt(value, "checksum");
  exactKeysAt(checksum, ["algorithm", "value"], "checksum");

  if (checksum.algorithm !== CHECKSUM_ALGORITHM) {
    return invalid(`checksum.algorithm must be "${CHECKSUM_ALGORITHM}".`);
  }

  const digest = stringAt(checksum.value, "checksum.value");

  if (!SHA256_PATTERN.test(digest)) {
    return invalid("checksum.value must be a lowercase SHA-256 digest.");
  }

  return { algorithm: CHECKSUM_ALGORITHM, value: digest };
}

function markerAt(value: unknown, index: number): FixtureMarker {
  const marker = objectAt(value, `payload.fixture.markers[${index}]`);
  exactKeysAt(marker, ["id", "value"], `payload.fixture.markers[${index}]`);
  return {
    id: stableIdAt(marker.id, `payload.fixture.markers[${index}].id`),
    value: finiteNumberAt(
      marker.value,
      `payload.fixture.markers[${index}].value`,
    ),
  };
}

export function validateFixtureState(value: unknown): FixtureSaveState {
  const fixture = objectAt(value, "payload.fixture");
  exactKeysAt(fixture, ["label", "counter", "markers"], "payload.fixture");
  const label = stringAt(fixture.label, "payload.fixture.label");

  if (label.length === 0 || label.length > 128) {
    return invalid("payload.fixture.label must contain 1-128 characters.");
  }

  const markerValues = fixture.markers;

  if (!Array.isArray(markerValues) || markerValues.length > 128) {
    return invalid(
      "payload.fixture.markers must be an array of at most 128 entries.",
    );
  }

  const markers = markerValues.map(markerAt);
  const markerIds = new Set(markers.map((marker) => marker.id));

  if (markerIds.size !== markers.length) {
    return invalid("payload.fixture.markers contains duplicate IDs.");
  }

  return {
    label,
    counter: integerAt(fixture.counter, "payload.fixture.counter"),
    markers,
  };
}

function migrationRecordAt(value: unknown, index: number): MigrationRecord {
  const record = objectAt(value, `migrationProvenance[${index}]`);
  exactKeysAt(
    record,
    ["fromVersion", "toVersion", "migratedAt"],
    `migrationProvenance[${index}]`,
  );
  const fromVersion = integerAt(
    record.fromVersion,
    `migrationProvenance[${index}].fromVersion`,
    1,
  );
  const toVersion = integerAt(
    record.toVersion,
    `migrationProvenance[${index}].toVersion`,
    2,
  );

  if (toVersion !== fromVersion + 1) {
    return invalid(
      "Migration provenance must contain consecutive version steps.",
    );
  }

  return {
    fromVersion,
    toVersion,
    migratedAt: isoDateAt(
      record.migratedAt,
      `migrationProvenance[${index}].migratedAt`,
    ),
  };
}

function sharedFields(value: Record<string, unknown>) {
  if (value.format !== SAVE_FORMAT) {
    return invalid(`format must be "${SAVE_FORMAT}".`);
  }

  return {
    saveId: stableIdAt(value.saveId, "saveId"),
    revision: integerAt(value.revision, "revision", 1),
    createdAt: isoDateAt(value.createdAt, "createdAt"),
    updatedAt: isoDateAt(value.updatedAt, "updatedAt"),
    compatibility: compatibilityAt(value.compatibility),
    checksum: checksumAt(value.checksum),
  };
}

function validateV1(value: Record<string, unknown>): SaveEnvelopeV1 {
  exactKeysAt(
    value,
    [
      "format",
      "formatVersion",
      "saveId",
      "revision",
      "createdAt",
      "updatedAt",
      "compatibility",
      "payload",
      "checksum",
    ],
    "save envelope",
  );
  const shared = sharedFields(value);
  const payload = objectAt(value.payload, "payload");
  exactKeysAt(
    payload,
    ["fixtureName", "fixtureCount", "markerValues"],
    "payload",
  );
  const markerValues = objectAt(payload.markerValues, "payload.markerValues");
  const checkedMarkerValues: Record<string, number> = {};

  for (const [id, markerValue] of Object.entries(markerValues)) {
    checkedMarkerValues[stableIdAt(id, "payload.markerValues key")] =
      finiteNumberAt(markerValue, `payload.markerValues.${id}`);
  }

  return {
    format: SAVE_FORMAT,
    formatVersion: 1,
    ...shared,
    payload: {
      fixtureName: stringAt(payload.fixtureName, "payload.fixtureName"),
      fixtureCount: integerAt(payload.fixtureCount, "payload.fixtureCount"),
      markerValues: checkedMarkerValues,
    },
  };
}

function validateV2(value: Record<string, unknown>): SaveEnvelopeV2 {
  exactKeysAt(
    value,
    [
      "format",
      "formatVersion",
      "saveId",
      "revision",
      "createdAt",
      "updatedAt",
      "compatibility",
      "migrationProvenance",
      "payload",
      "checksum",
    ],
    "save envelope",
  );
  const shared = sharedFields(value);
  const payload = objectAt(value.payload, "payload");
  exactKeysAt(payload, ["fixture"], "payload");

  if (!Array.isArray(value.migrationProvenance)) {
    return invalid("migrationProvenance must be an array.");
  }

  const migrationProvenance = value.migrationProvenance.map(migrationRecordAt);

  for (let index = 1; index < migrationProvenance.length; index += 1) {
    const previous = migrationProvenance[index - 1];
    const current = migrationProvenance[index];

    if (
      previous === undefined ||
      current === undefined ||
      current.fromVersion !== previous.toVersion
    ) {
      return invalid(
        "Migration provenance steps must be ordered and contiguous.",
      );
    }
  }

  if (migrationProvenance.length > 0) {
    const first = migrationProvenance[0];
    const last = migrationProvenance[migrationProvenance.length - 1];

    if (first?.fromVersion !== 1 || last?.toVersion !== CURRENT_SAVE_VERSION) {
      return invalid(
        "Migration provenance must start at version 1 and end at the current version.",
      );
    }
  }

  return {
    format: SAVE_FORMAT,
    formatVersion: CURRENT_SAVE_VERSION,
    ...shared,
    migrationProvenance,
    payload: { fixture: validateFixtureState(payload.fixture) },
  };
}

/**
 * Shared primitive field validators for sibling envelope formats
 * (TASK-705: the character save codec builds its shell validation from
 * these instead of forking them). Each throws `PersistenceError("corrupt")`
 * with a field path on failure.
 */
export const envelopeFieldValidators = {
  objectAt,
  exactKeysAt,
  stringAt,
  integerAt,
  finiteNumberAt,
  isoDateAt,
  stableIdAt,
  compatibilityAt,
  checksumAt,
  migrationRecordAt,
} as const;

export function validateEnvelopeStructure(
  value: unknown,
): SupportedSaveEnvelope {
  const envelope = objectAt(value, "save envelope");

  if (envelope.formatVersion === 1) {
    return validateV1(envelope);
  }

  if (envelope.formatVersion === CURRENT_SAVE_VERSION) {
    return validateV2(envelope);
  }

  throw new PersistenceError(
    "unsupported-version",
    `Save format version ${String(envelope.formatVersion)} is not supported.`,
  );
}

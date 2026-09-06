/**
 * Request validation for the v1 contract (Phase 8 kickoff §2, DEC-036 draft).
 *
 * The envelope check here is shape-and-size only; since TASK-717 (DEC-043)
 * the save route additionally decodes and validates envelope CONTENTS via
 * `save-validation.ts` before storage. Stored blobs are still returned
 * verbatim on load, and migrations still run client-side (DEC-032).
 */

/** DEC-036 draft naming rule, shared client/server. */
export const CHARACTER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9'\- ]{2,15}$/;
const CONSECUTIVE_SEPARATORS = /[' -]{2}/;

export const CHARACTER_CLASSES = ["barbarian"] as const;
export const CHARACTER_SLOT_LIMIT = 4;

/** Envelope size cap in bytes of serialized JSON (contract §2: 413 above it). */
export const ENVELOPE_MAX_BYTES = 1_048_576;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

/** Pragmatic email shape check — real verification is explicitly not in v1. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);
}

export function isValidPassword(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

/**
 * Validates a character name after trimming: the DEC-036 regex (3–16 chars,
 * letter first, letters/digits/apostrophe/hyphen/space after) plus the
 * no-consecutive-separators rule.
 */
export function validateCharacterName(raw: string): string | null {
  const name = raw.trim();
  if (!CHARACTER_NAME_PATTERN.test(name)) {
    return null;
  }
  if (CONSECUTIVE_SEPARATORS.test(name)) {
    return null;
  }
  return name;
}

export function isValidCharacterClass(value: string): boolean {
  return (CHARACTER_CLASSES as readonly string[]).includes(value);
}

/** Client-supplied list metadata; bounded but deliberately loose. */
export function isValidLevel(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 1000
  );
}

export interface EnvelopeShape {
  readonly formatVersion: number;
  readonly checksum: string;
  readonly serializedBytes: number;
}

/**
 * Shape sanity for the DEC-014 envelope without reading the payload:
 * the metadata fields every envelope format shares must be present and
 * plausibly typed. Returns the fields the server stores as opaque
 * observability columns, or null when the shape is wrong.
 */
export function inspectEnvelopeShape(envelope: unknown): EnvelopeShape | null {
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    return null;
  }
  const record = envelope as Record<string, unknown>;
  if (typeof record.format !== "string" || record.format.length === 0) {
    return null;
  }
  if (
    typeof record.formatVersion !== "number" ||
    !Number.isInteger(record.formatVersion) ||
    record.formatVersion < 1
  ) {
    return null;
  }
  if (typeof record.saveId !== "string" || record.saveId.length === 0) {
    return null;
  }
  if (
    typeof record.revision !== "number" ||
    !Number.isInteger(record.revision)
  ) {
    return null;
  }
  if (
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    return null;
  }
  if (!Array.isArray(record.migrationProvenance)) {
    return null;
  }
  const checksum = record.checksum;
  if (typeof checksum !== "object" || checksum === null) {
    return null;
  }
  const checksumRecord = checksum as Record<string, unknown>;
  if (
    typeof checksumRecord.algorithm !== "string" ||
    typeof checksumRecord.value !== "string" ||
    checksumRecord.value.length === 0
  ) {
    return null;
  }
  if (typeof record.payload !== "object" || record.payload === null) {
    return null;
  }
  return {
    formatVersion: record.formatVersion,
    checksum: checksumRecord.value,
    serializedBytes: Buffer.byteLength(JSON.stringify(envelope), "utf8"),
  };
}

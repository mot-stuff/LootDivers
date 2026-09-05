import { parseCharacterSave, type CharacterSave } from "../core";
import { canonicalJson } from "./canonical-json";
import { signEnvelope, verifyEnvelopeChecksum } from "./codec";
import {
  PersistenceError,
  type MigrationRecord,
  type SaveChecksum,
  type SaveCompatibility,
  type SaveEnvelopeCodec,
} from "./contracts";
import { envelopeFieldValidators as field } from "./validation";

export const CHARACTER_SAVE_FORMAT = "rarpg-character-save";
export const CURRENT_CHARACTER_SAVE_VERSION = 1;

/**
 * The versioned envelope wrapping the TASK-705 character DTO. Shares the
 * DEC-014 metadata shape (and therefore the generation/backup repository)
 * with the Phase 0 fixture envelope; only the format id and payload differ.
 * Per DEC-032 §2.1 this envelope is the exact blob a future backend stores
 * verbatim.
 */
export interface CharacterSaveEnvelope {
  readonly format: typeof CHARACTER_SAVE_FORMAT;
  readonly formatVersion: number;
  readonly saveId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly compatibility: SaveCompatibility;
  readonly migrationProvenance: readonly MigrationRecord[];
  readonly payload: { readonly character: CharacterSave };
  readonly checksum: SaveChecksum;
}

/**
 * One ordered step in the character save migration chain. Migrations
 * transform the raw (unvalidated) `payload.character` value of version
 * `fromVersion` into the shape expected by `fromVersion + 1`; the final
 * result is validated by `parseCharacterSave`, exactly mirroring the
 * fixture envelope's DEC-014 migration semantics.
 */
export interface CharacterSaveMigration {
  readonly fromVersion: number;
  migrate(character: unknown): unknown;
}

/**
 * Version 1 is the first character save format, so the production chain is
 * empty. The ordered hook is exercised by unit tests through
 * `createCharacterSaveCodec` with an injected chain.
 */
export const CHARACTER_SAVE_MIGRATIONS: readonly CharacterSaveMigration[] = [];

export interface CharacterSaveCodecOptions {
  readonly currentVersion?: number;
  readonly migrations?: readonly CharacterSaveMigration[];
}

interface EnvelopeShell {
  readonly formatVersion: number;
  readonly saveId: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly compatibility: CharacterSaveEnvelope["compatibility"];
  readonly migrationProvenance: readonly MigrationRecord[];
  readonly characterValue: unknown;
}

function invalid(message: string): never {
  throw new PersistenceError("corrupt", message);
}

/**
 * Builds the `rarpg-character-save` envelope codec. Production code uses
 * {@link CHARACTER_SAVE_CODEC}; tests may inject a synthetic version and
 * migration chain to exercise the ordered-migration machinery before a
 * real version 2 exists.
 */
export function createCharacterSaveCodec(
  options: CharacterSaveCodecOptions = {},
): SaveEnvelopeCodec<CharacterSave, CharacterSaveEnvelope> {
  const currentVersion =
    options.currentVersion ?? CURRENT_CHARACTER_SAVE_VERSION;
  const migrations = options.migrations ?? CHARACTER_SAVE_MIGRATIONS;

  function validateCharacterState(value: unknown): CharacterSave {
    try {
      return parseCharacterSave(value);
    } catch (error) {
      throw new PersistenceError(
        "corrupt",
        error instanceof Error
          ? error.message
          : "Character save payload is invalid.",
        { cause: error },
      );
    }
  }

  function validateShell(value: unknown): EnvelopeShell {
    const envelope = field.objectAt(value, "character save envelope");
    field.exactKeysAt(
      envelope,
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
      "character save envelope",
    );
    if (envelope.format !== CHARACTER_SAVE_FORMAT) {
      invalid(`format must be "${CHARACTER_SAVE_FORMAT}".`);
    }
    const formatVersion = field.integerAt(
      envelope.formatVersion,
      "formatVersion",
      1,
    );
    if (formatVersion > currentVersion) {
      throw new PersistenceError(
        "unsupported-version",
        `Character save version ${formatVersion} is newer than this build supports. Update the game and retry.`,
      );
    }
    field.checksumAt(envelope.checksum);

    if (!Array.isArray(envelope.migrationProvenance)) {
      invalid("migrationProvenance must be an array.");
    }
    const migrationProvenance = envelope.migrationProvenance.map(
      (record, index) => field.migrationRecordAt(record, index),
    );
    for (let index = 1; index < migrationProvenance.length; index += 1) {
      if (
        migrationProvenance[index]?.fromVersion !==
        migrationProvenance[index - 1]?.toVersion
      ) {
        invalid("Migration provenance steps must be ordered and contiguous.");
      }
    }
    const lastRecord = migrationProvenance[migrationProvenance.length - 1];
    if (lastRecord !== undefined && lastRecord.toVersion !== formatVersion) {
      invalid("Migration provenance must end at the envelope's version.");
    }

    const payload = field.objectAt(envelope.payload, "payload");
    field.exactKeysAt(payload, ["character"], "payload");

    return {
      formatVersion,
      saveId: field.stableIdAt(envelope.saveId, "saveId"),
      revision: field.integerAt(envelope.revision, "revision", 1),
      createdAt: field.isoDateAt(envelope.createdAt, "createdAt"),
      updatedAt: field.isoDateAt(envelope.updatedAt, "updatedAt"),
      compatibility: field.compatibilityAt(envelope.compatibility),
      migrationProvenance,
      characterValue: payload.character,
    };
  }

  return {
    async create(state, metadata, checksumProvider) {
      const character = validateCharacterState(state);
      const unsigned = {
        format: CHARACTER_SAVE_FORMAT,
        formatVersion: currentVersion,
        saveId: metadata.saveId,
        revision: metadata.revision,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        compatibility: {
          build: metadata.build,
          contentSchemaVersion: metadata.contentSchemaVersion,
        },
        migrationProvenance: metadata.migrationProvenance ?? [],
        payload: { character },
      } satisfies Omit<CharacterSaveEnvelope, "checksum">;
      return signEnvelope(unsigned, checksumProvider);
    },

    async decode(value, checksumProvider, clock) {
      await verifyEnvelopeChecksum(value, checksumProvider);
      const shell = validateShell(value);
      let characterValue = shell.characterValue;
      let version = shell.formatVersion;
      const migratedFromVersion = version < currentVersion ? version : null;
      const migrationProvenance = [...shell.migrationProvenance];
      while (version < currentVersion) {
        const migration = migrations.find(
          (candidate) => candidate.fromVersion === version,
        );
        if (migration === undefined) {
          throw new PersistenceError(
            "unsupported-version",
            `No migration exists from character save version ${version}.`,
          );
        }
        characterValue = migration.migrate(characterValue);
        migrationProvenance.push({
          fromVersion: version,
          toVersion: version + 1,
          migratedAt: clock.nowIso(),
        });
        version += 1;
      }
      const character = validateCharacterState(characterValue);
      const unsigned = {
        format: CHARACTER_SAVE_FORMAT,
        formatVersion: currentVersion,
        saveId: shell.saveId,
        revision: shell.revision,
        createdAt: shell.createdAt,
        updatedAt: shell.updatedAt,
        compatibility: shell.compatibility,
        migrationProvenance,
        payload: { character },
      } satisfies Omit<CharacterSaveEnvelope, "checksum">;
      const envelope = await signEnvelope(unsigned, checksumProvider);
      return { envelope, state: character, migratedFromVersion };
    },

    serialize: (envelope) => `${canonicalJson(envelope)}\n`,
  };
}

/** The production character save codec: format version 1, no migrations. */
export const CHARACTER_SAVE_CODEC = createCharacterSaveCodec();

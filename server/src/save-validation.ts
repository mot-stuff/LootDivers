/**
 * Server-side save validation (TASK-717, DEC-043).
 *
 * The server reuses the client's own validation stack instead of duplicating
 * it: the DEC-034 character envelope codec (canonical-JSON SHA-256 checksum,
 * envelope shell validation, ordered migrations) and core's
 * `parseCharacterSave` (field-by-field type, bound, and content-catalog
 * validation). Both live in the repo's `src/core` and `src/persistence`
 * layers, whose freedom from browser dependencies is CI-enforced by the root
 * `tsconfig.core.json` / `tsconfig.persistence.json` purity gates; the server
 * build bundles them via esbuild (see DEC-043 for the seam decision).
 *
 * On top of the shared parse, this module enforces one plausibility
 * invariant the client-side parser deliberately leaves open: the progression
 * points a save holds (allocated + unspent) cannot exceed the points its
 * recorded level has earned under the core progression formulas.
 *
 * v1 anti-cheat boundary (DEC-043): this validates state PLAUSIBILITY, not
 * gameplay authenticity. A client that simulates legal play can still submit
 * any reachable state; full server authority is explicitly deferred.
 */
import { createHash } from "node:crypto";
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_POINTS_PER_LEVEL,
  PASSIVE_POINTS_PER_LEVEL,
  STARTING_ATTRIBUTE_POINTS,
  STARTING_PASSIVE_POINTS,
  type CharacterSave,
} from "../../src/core";
import {
  CHARACTER_SAVE_CODEC,
  PersistenceError,
  type ChecksumProvider,
  type SaveClock,
} from "../../src/persistence";

/**
 * SHA-256 over the codec's canonical JSON — byte-identical output to the
 * client's `WebCryptoSha256` provider (lowercase hex), so every envelope the
 * client signs verifies here and vice versa.
 */
export const NODE_SHA256: ChecksumProvider = {
  digest: (canonicalValue) =>
    Promise.resolve(
      createHash("sha256").update(canonicalValue, "utf8").digest("hex"),
    ),
};

/** Real clock: only consulted for migration provenance timestamps. */
const CLOCK: SaveClock = { nowIso: () => new Date().toISOString() };

export type SaveRejectionCode =
  "checksum-mismatch" | "unsupported-version" | "invalid-save";

export interface SaveRejection {
  readonly ok: false;
  readonly code: SaveRejectionCode;
  readonly message: string;
}

export interface ValidatedSave {
  readonly ok: true;
  /** The decoded, fully validated character state. */
  readonly save: CharacterSave;
  /**
   * The envelope's client-side generation counter, used for the DEC-043
   * revision monotonicity check against the stored blob.
   */
  readonly envelopeRevision: number;
}

/**
 * DEC-043 plausibility invariant: every attribute/passive point a save holds
 * must have been earned by its recorded level. The core `CharacterProgression`
 * conserves points exactly (level-ups grant, allocate/respec move them), so
 * any legitimately captured save satisfies `held <= earned`; a forged save
 * with unearned points cannot.
 */
function pointsInvariantFailure(save: CharacterSave): string | null {
  const progression = save.progression;
  const earnedAttribute =
    STARTING_ATTRIBUTE_POINTS +
    (progression.level - 1) * ATTRIBUTE_POINTS_PER_LEVEL;
  const heldAttribute =
    ATTRIBUTE_IDS.reduce((sum, id) => sum + progression.attributes[id], 0) +
    progression.unspentAttributePoints;
  if (heldAttribute > earnedAttribute) {
    return `progression holds ${String(heldAttribute)} attribute points but level ${String(progression.level)} has earned only ${String(earnedAttribute)}.`;
  }
  const earnedPassive =
    STARTING_PASSIVE_POINTS +
    (progression.level - 1) * PASSIVE_POINTS_PER_LEVEL;
  const heldPassive =
    progression.passiveRanks.reduce((sum, entry) => sum + entry.rank, 0) +
    progression.unspentPassivePoints;
  if (heldPassive > earnedPassive) {
    return `progression holds ${String(heldPassive)} passive points but level ${String(progression.level)} has earned only ${String(earnedPassive)}.`;
  }
  return null;
}

/**
 * Decodes and validates an untrusted save envelope exactly as the client
 * would (checksum, shell, version/migrations, `parseCharacterSave`), then
 * applies the server-only plausibility invariant. Returns the validated
 * state or a contract-shaped rejection; never mutates or re-serializes the
 * envelope the caller stores (DEC-032 verbatim storage is unchanged).
 */
export async function validateSaveEnvelope(
  envelope: unknown,
): Promise<ValidatedSave | SaveRejection> {
  let decoded;
  try {
    decoded = await CHARACTER_SAVE_CODEC.decode(envelope, NODE_SHA256, CLOCK);
  } catch (error) {
    if (error instanceof PersistenceError) {
      if (error.code === "checksum") {
        return {
          ok: false,
          code: "checksum-mismatch",
          message: `Save rejected: ${error.message}`,
        };
      }
      if (error.code === "unsupported-version") {
        return {
          ok: false,
          code: "unsupported-version",
          message: `Save rejected: ${error.message}`,
        };
      }
      return {
        ok: false,
        code: "invalid-save",
        message: `Save rejected: ${error.message}`,
      };
    }
    throw error;
  }
  const failure = pointsInvariantFailure(decoded.state);
  if (failure !== null) {
    return {
      ok: false,
      code: "invalid-save",
      message: `Save rejected: ${failure}`,
    };
  }
  return {
    ok: true,
    save: decoded.state,
    envelopeRevision: decoded.envelope.revision,
  };
}

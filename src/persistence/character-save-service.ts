import type { CharacterSave } from "../core";
import type { CharacterSaveEnvelope } from "./character-save-codec";
import { PersistenceError, type SaveRepository } from "./contracts";

/**
 * Boot-time load outcome for the main menu's Continue button (TASK-705).
 * `save` is null whenever no restorable character exists — including
 * corrupt, checksum-failing, or unsupported-version slots, which are
 * treated as absent rather than crashing the shell.
 */
export interface CharacterSaveBootResult {
  readonly save: CharacterSave | null;
  /**
   * True when the active generation failed validation and the repository
   * recovered the character from the backup generation (DEC-014).
   */
  readonly recovered: boolean;
  /** Diagnostic detail when loading failed for a reason other than "no save". */
  readonly failure: string | null;
}

/**
 * Thin single-slot facade over the character `SaveRepository`: swallow
 * "no save" and corruption into a Continue-disabling boot result, and pass
 * writes through. Deliberately free of UI and storage concerns so the
 * TASK-707 backend adapter can sit behind the same `SaveRepository` port.
 */
export class CharacterSaveService {
  readonly #repository: SaveRepository<CharacterSave, CharacterSaveEnvelope>;

  public constructor(
    repository: SaveRepository<CharacterSave, CharacterSaveEnvelope>,
  ) {
    this.#repository = repository;
  }

  public async loadForBoot(): Promise<CharacterSaveBootResult> {
    try {
      const result = await this.#repository.load();
      return {
        save: result.state,
        recovered:
          result.recoveredFromInvalidGeneration || result.source === "backup",
        failure: null,
      };
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "not-found") {
        return { save: null, recovered: false, failure: null };
      }
      return {
        save: null,
        recovered: false,
        failure: error instanceof Error ? error.message : String(error),
      };
    }
  }

  public async save(state: CharacterSave): Promise<void> {
    await this.#repository.save(state);
  }
}

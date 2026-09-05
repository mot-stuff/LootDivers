/**
 * Core-owned tutorial progression for Wakeshore Landing (TASK-702, DEC-030).
 *
 * Follows the quest-stage pattern: the step list is plain core data (prompt
 * copy included, like `QuestDefinition.summary`), and a small tracker owns
 * the mutable stage. Steps advance strictly in order; actions performed out
 * of order neither advance nor break the sequence. The exit portal always
 * works — walking out IS the skip mechanism — so the tracker never gates
 * any simulation behavior; it only observes it.
 */

export const TUTORIAL_STEP_IDS = [
  "move",
  "attack",
  "dodge",
  "loot",
  "gather",
  "travel",
] as const;

export type TutorialStepId = (typeof TUTORIAL_STEP_IDS)[number];

export interface TutorialStepDefinition {
  readonly id: TutorialStepId;
  /** Player-facing prompt copy. Core owns this text; JSX must not. */
  readonly prompt: string;
}

export const TUTORIAL_STEPS: readonly TutorialStepDefinition[] = [
  { id: "move", prompt: "Move with W, A, S, and D." },
  {
    id: "attack",
    prompt: "Slay the Wakeshore Scuttler with Left Click.",
  },
  { id: "dodge", prompt: "Dodge roll with Space." },
  { id: "loot", prompt: "Stand over the dropped loot and press F." },
  {
    id: "gather",
    prompt: "Press F at the Veinshard Outcrop and stand still to mine.",
  },
  {
    id: "travel",
    prompt: "Press F at the Hearthmere Road portal to finish.",
  },
];

export interface TutorialReadModel {
  /** True only while a prompt should be visible (in zone, not completed). */
  readonly active: boolean;
  readonly completed: boolean;
  readonly stepId: TutorialStepId | null;
  readonly prompt: string | null;
  readonly stepsCompleted: number;
  readonly totalSteps: number;
}

/**
 * Observes simulation verbs and advances the ordered step list. The tracker
 * is only receptive while the tutorial zone is the current zone; leaving the
 * zone hides prompts but keeps progress, and re-entry after completion shows
 * nothing.
 */
export class TutorialTracker {
  #stepsCompleted = 0;
  #inZone = false;

  public setInZone(inZone: boolean): void {
    this.#inZone = inZone;
  }

  public completed(): boolean {
    return this.#stepsCompleted >= TUTORIAL_STEPS.length;
  }

  /**
   * Reports a performed verb. Advances only when the tracker is receptive
   * and the verb matches the current step; anything else is a silent no-op.
   */
  public notify(action: TutorialStepId): boolean {
    if (!this.#inZone || this.completed()) {
      return false;
    }
    const current = TUTORIAL_STEPS[this.#stepsCompleted];
    if (current === undefined || current.id !== action) {
      return false;
    }
    this.#stepsCompleted += 1;
    return true;
  }

  public reset(): void {
    this.#stepsCompleted = 0;
    this.#inZone = false;
  }

  public readModel(): TutorialReadModel {
    const current =
      this.#inZone && !this.completed()
        ? TUTORIAL_STEPS[this.#stepsCompleted]
        : undefined;
    return {
      active: current !== undefined,
      completed: this.completed(),
      stepId: current?.id ?? null,
      prompt: current?.prompt ?? null,
      stepsCompleted: this.#stepsCompleted,
      totalSteps: TUTORIAL_STEPS.length,
    };
  }
}

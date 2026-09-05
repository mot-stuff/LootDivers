/**
 * Core-owned tutorial progression for Wakeshore Landing (TASK-702, DEC-030
 * as amended by TASK-702B).
 *
 * Follows the quest-stage pattern: the step list is plain core data (prompt
 * copy included, like `QuestDefinition.summary`), and a small tracker owns
 * the mutable stage. Completion is BANKED: every verb checks off its own
 * step whenever it is performed, regardless of order, while the prompt
 * always displays the first incomplete step in the canonical order
 * (move → attack → dodge → loot → gather → travel). The Hearthmere exit
 * portal is hidden and non-interactable until the five non-travel steps are
 * banked (`exitUnlocked`); it appears exactly when `travel` becomes the
 * active prompt, and immediately on re-entry after full completion.
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
  /** Canonical 1-based position of the displayed step; null when inactive. */
  readonly stepNumber: number | null;
  /** Count of banked steps (order-independent). */
  readonly stepsCompleted: number;
  readonly totalSteps: number;
  /** True once move/attack/dodge/loot/gather are all banked. */
  readonly exitUnlocked: boolean;
}

/**
 * Observes simulation verbs and banks completed steps. The tracker is only
 * receptive while the tutorial zone is the current zone: entering shows the
 * first incomplete step, leaving hides prompts but keeps progress, and
 * re-entry after completion shows nothing. Because completion is banked,
 * no sequence of in-zone actions can strand a step (see DEC-030 amendment).
 */
export class TutorialTracker {
  readonly #banked = new Set<TutorialStepId>();
  #inZone = false;

  public setInZone(inZone: boolean): void {
    this.#inZone = inZone;
  }

  public completed(): boolean {
    return this.#banked.size >= TUTORIAL_STEPS.length;
  }

  /**
   * True once every non-travel step is banked. The combat arena hides the
   * tutorial zone's exit portal (interactables, minimap, and F-interaction)
   * until this is true.
   */
  public exitUnlocked(): boolean {
    return TUTORIAL_STEPS.every(
      (step) => step.id === "travel" || this.#banked.has(step.id),
    );
  }

  /**
   * Reports a performed verb. Banks the matching step whenever the tracker
   * is receptive, regardless of prompt order; repeats are silent no-ops.
   * `travel` additionally requires the exit to be unlocked, mirroring the
   * gated portal (unreachable otherwise, kept as a core invariant).
   */
  public notify(action: TutorialStepId): boolean {
    if (!this.#inZone || this.#banked.has(action)) {
      return false;
    }
    if (action === "travel" && !this.exitUnlocked()) {
      return false;
    }
    this.#banked.add(action);
    return true;
  }

  public reset(): void {
    this.#banked.clear();
    this.#inZone = false;
  }

  public readModel(): TutorialReadModel {
    const currentIndex = TUTORIAL_STEPS.findIndex(
      (step) => !this.#banked.has(step.id),
    );
    const current =
      this.#inZone && currentIndex >= 0
        ? TUTORIAL_STEPS[currentIndex]
        : undefined;
    return {
      active: current !== undefined,
      completed: this.completed(),
      stepId: current?.id ?? null,
      prompt: current?.prompt ?? null,
      stepNumber: current === undefined ? null : currentIndex + 1,
      stepsCompleted: this.#banked.size,
      totalSteps: TUTORIAL_STEPS.length,
      exitUnlocked: this.exitUnlocked(),
    };
  }
}

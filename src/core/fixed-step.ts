import type { Clock } from "./clock";

export const FIXED_TICKS_PER_SECOND = 60;
export const FIXED_STEP_SECONDS = 1 / FIXED_TICKS_PER_SECOND;
export const FIXED_STEP_MILLISECONDS = 1000 / FIXED_TICKS_PER_SECOND;

export interface FixedStep {
  readonly tick: number;
  readonly deltaSeconds: typeof FIXED_STEP_SECONDS;
}

export interface FixedStepRunnerOptions {
  readonly maxCatchUpSteps?: number;
}

export interface AdvanceResult {
  readonly stepsRun: number;
  readonly tick: number;
  readonly interpolationAlpha: number;
  readonly droppedMilliseconds: number;
}

export type FixedStepCallback = (step: FixedStep) => void;

const DEFAULT_MAX_CATCH_UP_STEPS = 5;
const STEP_EPSILON_MILLISECONDS = 1e-9;

/**
 * Drives a fixed 60 Hz simulation from an injected monotonic clock.
 *
 * The runner starts paused. resume() anchors the clock without simulating time
 * spent paused. While running, one advance() executes at most maxCatchUpSteps;
 * elapsed time beyond that window is explicitly discarded. A partial step is
 * retained across pause/resume, but paused wall time never enters it.
 * Callback and advance-result records are reused; consumers must copy values
 * they need to retain across calls.
 */
export class FixedStepRunner {
  private readonly maxCatchUpSteps: number;
  private accumulatorMilliseconds = 0;
  private lastClockMilliseconds = 0;
  private nextTick = 0;
  private running = false;
  private readonly stepValue = {
    tick: 0,
    deltaSeconds: FIXED_STEP_SECONDS,
  };
  private readonly resultValue = {
    stepsRun: 0,
    tick: 0,
    interpolationAlpha: 0,
    droppedMilliseconds: 0,
  };

  constructor(
    private readonly clock: Clock,
    private readonly runStep: FixedStepCallback,
    options: FixedStepRunnerOptions = {},
  ) {
    const maxCatchUpSteps =
      options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;

    if (!Number.isSafeInteger(maxCatchUpSteps) || maxCatchUpSteps < 1) {
      throw new RangeError("maxCatchUpSteps must be a positive safe integer.");
    }

    this.maxCatchUpSteps = maxCatchUpSteps;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get tick(): number {
    return this.nextTick;
  }

  pause(): void {
    this.running = false;
  }

  reset(): void {
    this.accumulatorMilliseconds = 0;
    this.nextTick = 0;
    if (this.running) {
      this.lastClockMilliseconds = this.readClock();
    }
  }

  resume(): void {
    if (this.running) {
      return;
    }

    this.lastClockMilliseconds = this.readClock();
    this.running = true;
  }

  advance(): AdvanceResult {
    if (!this.running) {
      return this.result(0, 0);
    }

    const now = this.readClock();
    const elapsedMilliseconds = now - this.lastClockMilliseconds;

    if (elapsedMilliseconds < 0) {
      throw new RangeError(
        "Clock moved backwards while the runner was active.",
      );
    }

    this.lastClockMilliseconds = now;

    const catchUpWindowMilliseconds =
      this.maxCatchUpSteps * FIXED_STEP_MILLISECONDS;
    const acceptedMilliseconds = Math.min(
      elapsedMilliseconds,
      catchUpWindowMilliseconds,
    );
    const droppedMilliseconds = elapsedMilliseconds - acceptedMilliseconds;
    this.accumulatorMilliseconds += acceptedMilliseconds;

    let stepsRun = 0;

    while (
      stepsRun < this.maxCatchUpSteps &&
      this.accumulatorMilliseconds + STEP_EPSILON_MILLISECONDS >=
        FIXED_STEP_MILLISECONDS
    ) {
      this.accumulatorMilliseconds -= FIXED_STEP_MILLISECONDS;

      if (this.accumulatorMilliseconds < 0) {
        this.accumulatorMilliseconds = 0;
      }

      this.stepValue.tick = this.nextTick;
      this.runStep(this.stepValue);
      this.nextTick += 1;
      stepsRun += 1;
    }

    return this.result(stepsRun, droppedMilliseconds);
  }

  private readClock(): number {
    const value = this.clock.nowMilliseconds();

    if (!Number.isFinite(value)) {
      throw new TypeError("Clock must return a finite millisecond value.");
    }

    return value;
  }

  private result(stepsRun: number, droppedMilliseconds: number): AdvanceResult {
    this.resultValue.stepsRun = stepsRun;
    this.resultValue.tick = this.nextTick;
    this.resultValue.interpolationAlpha =
      this.accumulatorMilliseconds / FIXED_STEP_MILLISECONDS;
    this.resultValue.droppedMilliseconds = droppedMilliseconds;
    return this.resultValue;
  }
}

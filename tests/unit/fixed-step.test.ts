import { describe, expect, it } from "vitest";

import {
  FIXED_STEP_MILLISECONDS,
  FixedStepRunner,
  type Clock,
} from "../../src/core";

class ManualClock implements Clock {
  constructor(public milliseconds = 0) {}

  nowMilliseconds(): number {
    return this.milliseconds;
  }

  advance(milliseconds: number): void {
    this.milliseconds += milliseconds;
  }
}

describe("FixedStepRunner", () => {
  it("runs exactly 60 fixed ticks for one accepted second", () => {
    const clock = new ManualClock();
    const ticks: number[] = [];
    const runner = new FixedStepRunner(clock, ({ tick }) => ticks.push(tick), {
      maxCatchUpSteps: 60,
    });

    runner.resume();
    clock.advance(1000);
    const result = runner.advance();

    expect(result.stepsRun).toBe(60);
    expect(result.tick).toBe(60);
    expect(result.interpolationAlpha).toBeCloseTo(0, 10);
    expect(ticks).toEqual(Array.from({ length: 60 }, (_, index) => index));
  });

  it("starts paused and never advances while paused", () => {
    const clock = new ManualClock();
    const runner = new FixedStepRunner(clock, () => undefined);

    clock.advance(5000);

    expect(runner.advance()).toMatchObject({ stepsRun: 0, tick: 0 });
    expect(runner.isRunning).toBe(false);
  });

  it("bounds catch-up and discards a running background gap", () => {
    const clock = new ManualClock();
    const runner = new FixedStepRunner(clock, () => undefined, {
      maxCatchUpSteps: 4,
    });

    runner.resume();
    clock.advance(10_000);
    const afterGap = runner.advance();

    expect(afterGap.stepsRun).toBe(4);
    expect(afterGap.tick).toBe(4);
    expect(afterGap.droppedMilliseconds).toBeCloseTo(
      10_000 - 4 * FIXED_STEP_MILLISECONDS,
      10,
    );

    expect(runner.advance()).toMatchObject({
      stepsRun: 0,
      tick: 4,
      droppedMilliseconds: 0,
    });
  });

  it("does not simulate paused time and retains a partial fixed step", () => {
    const clock = new ManualClock();
    const runner = new FixedStepRunner(clock, () => undefined);

    runner.resume();
    clock.advance(10);
    expect(runner.advance().stepsRun).toBe(0);

    runner.pause();
    clock.advance(60_000);
    expect(runner.advance().stepsRun).toBe(0);

    runner.resume();
    clock.advance(FIXED_STEP_MILLISECONDS - 10);

    expect(runner.advance()).toMatchObject({
      stepsRun: 1,
      tick: 1,
      droppedMilliseconds: 0,
    });
  });

  it("resets tick and partial timing without stopping a running runner", () => {
    const clock = new ManualClock();
    const ticks: number[] = [];
    const runner = new FixedStepRunner(clock, ({ tick }) => ticks.push(tick));
    runner.resume();
    clock.advance(FIXED_STEP_MILLISECONDS * 2.5);
    expect(runner.advance().tick).toBe(2);

    runner.reset();
    expect(runner.isRunning).toBe(true);
    expect(runner.tick).toBe(0);
    clock.advance(FIXED_STEP_MILLISECONDS);
    const afterReset = runner.advance();
    expect(afterReset).toMatchObject({
      stepsRun: 1,
      tick: 1,
    });
    expect(afterReset.interpolationAlpha).toBeCloseTo(0, 10);
    expect(ticks).toEqual([0, 1, 0]);
  });

  it("rejects invalid or backwards clock values", () => {
    const clock = new ManualClock();
    const runner = new FixedStepRunner(clock, () => undefined);

    runner.resume();
    clock.advance(-1);
    expect(() => runner.advance()).toThrow(/backwards/);

    clock.milliseconds = Number.NaN;
    expect(() => runner.advance()).toThrow(/finite/);
  });

  it("reuses callback and result records without hot-loop allocation", () => {
    const clock = new ManualClock();
    const steps: object[] = [];
    const runner = new FixedStepRunner(clock, (step) => steps.push(step));
    runner.resume();
    clock.advance(FIXED_STEP_MILLISECONDS);
    const first = runner.advance();
    clock.advance(FIXED_STEP_MILLISECONDS);
    const second = runner.advance();

    expect(first).toBe(second);
    expect(steps[0]).toBe(steps[1]);
    expect(second).toMatchObject({ stepsRun: 1, tick: 2 });
  });
});

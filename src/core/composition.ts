import type { Clock } from "./clock";
import {
  FixedStepRunner,
  type AdvanceResult,
  type FixedStepRunnerOptions,
} from "./fixed-step";
import type { CommandSource, EventSink } from "./messages";
import type { RandomSource } from "./random";

export interface SimulationStepContext<TCommand, TEvent> {
  readonly tick: number;
  readonly deltaSeconds: number;
  readonly commands: readonly TCommand[];
  readonly random: RandomSource;
  readonly events: EventSink<TEvent>;
}

export interface SimulationSystem<TCommand, TEvent> {
  step(context: SimulationStepContext<TCommand, TEvent>): void;
}

export interface CoreDependencies<TCommand, TEvent> {
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly commands: CommandSource<TCommand>;
  readonly events: EventSink<TEvent>;
  readonly simulation: SimulationSystem<TCommand, TEvent>;
}

export interface CoreRuntime {
  readonly isRunning: boolean;
  readonly tick: number;
  pause(): void;
  resume(): void;
  advance(): AdvanceResult;
}

/**
 * Explicit composition root for the framework-independent simulation.
 *
 * Browser clocks, input adapters, presentation, persistence, and framework
 * objects are supplied by outer layers through these narrow dependencies.
 */
export function createCoreRuntime<TCommand, TEvent>(
  dependencies: CoreDependencies<TCommand, TEvent>,
  options: FixedStepRunnerOptions = {},
): CoreRuntime {
  const runner = new FixedStepRunner(
    dependencies.clock,
    (step) => {
      dependencies.simulation.step({
        tick: step.tick,
        deltaSeconds: step.deltaSeconds,
        commands: dependencies.commands.takeForTick(step.tick),
        random: dependencies.random,
        events: dependencies.events,
      });
    },
    options,
  );

  return {
    get isRunning() {
      return runner.isRunning;
    },
    get tick() {
      return runner.tick;
    },
    pause() {
      runner.pause();
    },
    resume() {
      runner.resume();
    },
    advance() {
      return runner.advance();
    },
  };
}

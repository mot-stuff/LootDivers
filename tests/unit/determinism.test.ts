import { describe, expect, it } from "vitest";

import {
  createCoreRuntime,
  Mulberry32,
  type Clock,
  type CommandsFrom,
  type CommandSource,
  type EventSink,
  type EventsFrom,
  type SimulationStepContext,
  type SimulationSystem,
} from "../../src/core";

interface FixtureCommandPayloads {
  "fixture:add": { readonly amount: number };
  "fixture:random-add": { readonly maxExclusive: number };
}

interface FixtureEventPayloads {
  "fixture:value-changed": {
    readonly commandSequence: number;
    readonly value: number;
  };
}

type FixtureCommand = CommandsFrom<FixtureCommandPayloads>;
type FixtureEvent = EventsFrom<FixtureEventPayloads>;

class ManualClock implements Clock {
  milliseconds = 0;

  nowMilliseconds(): number {
    return this.milliseconds;
  }
}

class ScheduledCommands implements CommandSource<FixtureCommand> {
  constructor(private readonly byTick: ReadonlyMap<number, FixtureCommand[]>) {}

  takeForTick(tick: number): readonly FixtureCommand[] {
    return this.byTick.get(tick) ?? [];
  }
}

class CollectedEvents implements EventSink<FixtureEvent> {
  readonly values: FixtureEvent[] = [];

  publish(event: FixtureEvent): void {
    this.values.push(event);
  }
}

class FixtureSimulation implements SimulationSystem<
  FixtureCommand,
  FixtureEvent
> {
  private value = 0;
  private eventSequence = 0;

  step(context: SimulationStepContext<FixtureCommand, FixtureEvent>): void {
    for (const command of context.commands) {
      switch (command.type) {
        case "fixture:add":
          this.value += command.payload.amount;
          break;
        case "fixture:random-add":
          this.value += context.random.nextInteger(
            command.payload.maxExclusive,
          );
          break;
      }

      context.events.publish({
        type: "fixture:value-changed",
        tick: context.tick,
        sequence: this.eventSequence,
        payload: {
          commandSequence: command.sequence,
          value: this.value,
        },
      });
      this.eventSequence += 1;
    }
  }
}

function executeFixture(seed: number): readonly FixtureEvent[] {
  const clock = new ManualClock();
  const events = new CollectedEvents();
  const commands: FixtureCommand[] = Array.from({ length: 120 }, (_, tick) => ({
    type: tick % 3 === 0 ? "fixture:random-add" : "fixture:add",
    sequence: tick,
    targetTick: tick,
    payload:
      tick % 3 === 0 ? { maxExclusive: 1000 } : { amount: (tick % 5) + 1 },
  })) as FixtureCommand[];
  const byTick = new Map<number, FixtureCommand[]>(
    commands.map((command) => [command.targetTick, [command]]),
  );
  const runtime = createCoreRuntime(
    {
      clock,
      random: new Mulberry32(seed),
      commands: new ScheduledCommands(byTick),
      events,
      simulation: new FixtureSimulation(),
    },
    { maxCatchUpSteps: 120 },
  );

  runtime.resume();
  clock.milliseconds = 2000;
  expect(runtime.advance()).toMatchObject({ stepsRun: 120, tick: 120 });

  return events.values;
}

describe("deterministic composition", () => {
  it("produces identical events for the same seed and command stream", () => {
    for (const seed of [0, 1, 42, 0xffff_ffff]) {
      expect(executeFixture(seed)).toEqual(executeFixture(seed));
    }
  });

  it("uses the injected random dependency", () => {
    expect(executeFixture(100)).not.toEqual(executeFixture(101));
  });
});

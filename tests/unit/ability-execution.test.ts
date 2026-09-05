import { describe, expect, it } from "vitest";

import {
  AbilityExecutionEngine,
  contentId,
  Mulberry32,
  SequentialRuntimeEntityIds,
  type AbilityCooldownPort,
  type AbilityDefinition,
  type AbilityExecutionDependencies,
  type AbilityExecutionEvent,
  type AbilityResourcePort,
  type AbilityStatPort,
  type ContentId,
  type RuntimeEntityId,
} from "../../src/core/index.ts";

const mana = contentId("fixture:mana");
const power = contentId("fixture:power");
const modifyResource = contentId("core:modify-resource");

function definition(
  id: string,
  overrides: Partial<AbilityDefinition> = {},
): AbilityDefinition {
  return {
    id: contentId(id),
    tags: [contentId("fixture:ability")],
    targeting: { mode: "self", range: 0 },
    timing: { startupTicks: 1, activeTicks: 1, recoveryTicks: 1 },
    costs: [{ resourceId: mana, amount: 10, settlement: "pay" }],
    cooldown: { durationTicks: 4, startsOn: "complete" },
    cancellation: {
      allowedDuring: ["startup", "active", "recovery"],
      refund: "none",
      cooldown: "retain",
    },
    statPolicy: "snapshot",
    capturedStatIds: [power],
    effects: [
      {
        kind: "modify-resource",
        resourceId: mana,
        amount: 1,
        recipient: "source",
      },
    ],
    ...overrides,
  };
}

class ResourceFixture implements AbilityResourcePort {
  public balance = 100;
  public readonly changes: number[] = [];

  canSpend(_entityId: RuntimeEntityId, _resourceId: ContentId, amount: number) {
    return this.balance >= amount;
  }

  debit(_entityId: RuntimeEntityId, _resourceId: ContentId, amount: number) {
    this.balance -= amount;
    this.changes.push(-amount);
  }

  credit(_entityId: RuntimeEntityId, _resourceId: ContentId, amount: number) {
    this.balance += amount;
    this.changes.push(amount);
  }
}

class CooldownFixture implements AbilityCooldownPort {
  private readonly endTicks = new Map<string, number>();

  remainingTicks(
    entityId: RuntimeEntityId,
    abilityId: ContentId,
    atTick: number,
  ) {
    return Math.max(
      0,
      (this.endTicks.get(`${entityId}:${abilityId}`) ?? 0) - atTick,
    );
  }

  start(
    entityId: RuntimeEntityId,
    abilityId: ContentId,
    atTick: number,
    durationTicks: number,
  ) {
    this.endTicks.set(`${entityId}:${abilityId}`, atTick + durationTicks);
  }

  clear(entityId: RuntimeEntityId, abilityId: ContentId) {
    this.endTicks.delete(`${entityId}:${abilityId}`);
  }
}

function harness(
  definitions: readonly AbilityDefinition[],
  options: {
    readonly maximumDepth?: number;
    readonly maximumEffects?: number;
  } = {},
) {
  const resources = new ResourceFixture();
  const cooldowns = new CooldownFixture();
  const events: AbilityExecutionEvent[] = [];
  const effectReads: number[] = [];
  const randomDraws: number[] = [];
  let statValue = 5;
  const stats: AbilityStatPort = {
    read: () => statValue,
  };
  const dependencies: AbilityExecutionDependencies = {
    definitions: {
      get: (id) => definitions.find((entry) => entry.id === id),
    },
    resources,
    cooldowns,
    stats,
    targets: {
      validate: (request, ability) =>
        request.target.kind === ability.targeting.mode,
    },
    events: {
      publish: (event) => events.push(event),
    },
    random: new Mulberry32(0x5eed_0009),
    executors: new Map([
      [
        modifyResource,
        {
          execute: (_effect, context) => {
            effectReads.push(context.readStat(power));
            randomDraws.push(context.random.nextUint32());
          },
        },
      ],
    ]),
    triggerLimits: {
      maximumDepth: options.maximumDepth ?? 4,
      maximumEffects: options.maximumEffects ?? 16,
    },
  };
  return {
    engine: new AbilityExecutionEngine(dependencies),
    resources,
    cooldowns,
    events,
    effectReads,
    randomDraws,
    setStat: (value: number) => {
      statValue = value;
    },
  };
}

function selfRequest(
  abilityId: ContentId,
  sourceId: RuntimeEntityId,
  requestedAtTick = 0,
) {
  return {
    abilityId,
    sourceId,
    target: { kind: "self" as const },
    requestedAtTick,
  };
}

describe("framework-independent ability execution", () => {
  it("advances success through explicit fixed-tick stages in deterministic order", () => {
    const ability = definition("fixture:success");
    const source = new SequentialRuntimeEntityIds().next();
    const { engine, events, effectReads, resources } = harness([ability]);

    const result = engine.request(selfRequest(ability.id, source));
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.execution.stage).toBe("startup");
    expect(resources.balance).toBe(90);

    expect(engine.advance(result.execution.executionId, 1).stage).toBe(
      "active",
    );
    expect(effectReads).toEqual([5]);
    expect(engine.advance(result.execution.executionId, 2).stage).toBe(
      "recovery",
    );
    const completed = engine.advance(result.execution.executionId, 3);

    expect(completed.stage).toBe("complete");
    expect(completed.history.map(({ stage }) => stage)).toEqual([
      "request",
      "validate",
      "pay",
      "startup",
      "active",
      "recovery",
      "complete",
    ]);
    expect(events.map(({ stage }) => stage)).toEqual([
      "startup",
      "active",
      "recovery",
      "complete",
    ]);
  });

  it("rejects an invalid target before costs or an execution are created", () => {
    const ability = definition("fixture:invalid", {
      targeting: { mode: "entity", range: 5 },
    });
    const source = new SequentialRuntimeEntityIds().next();
    const { engine, events, resources } = harness([ability]);

    const result = engine.request(selfRequest(ability.id, source));

    expect(result).toMatchObject({
      accepted: false,
      reason: "target-invalid",
      history: [
        { stage: "request", tick: 0 },
        { stage: "validate", tick: 0 },
        { stage: "reject", tick: 0 },
      ],
    });
    expect(resources.changes).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      executionId: 0,
      reason: "target-invalid",
    });
  });

  it("applies explicit cancellation refund and cooldown-clear policy", () => {
    const ability = definition("fixture:cancel", {
      costs: [
        { resourceId: mana, amount: 10, settlement: "pay" },
        { resourceId: mana, amount: 15, settlement: "reserve" },
      ],
      cooldown: { durationTicks: 8, startsOn: "pay" },
      cancellation: {
        allowedDuring: ["startup"],
        refund: "reserved",
        cooldown: "clear",
      },
    });
    const source = new SequentialRuntimeEntityIds().next();
    const { engine, resources, cooldowns } = harness([ability]);
    const result = engine.request(selfRequest(ability.id, source));
    if (!result.accepted) throw new Error("fixture request was rejected");

    const cancelled = engine.cancel(result.execution.executionId, 0);

    expect(cancelled.stage).toBe("cancel");
    expect(resources.balance).toBe(90);
    expect(resources.changes).toEqual([-10, -15, 15]);
    expect(cooldowns.remainingTicks(source, ability.id, 0)).toBe(0);
  });

  it("rejects a second request while cooldown is active", () => {
    const ability = definition("fixture:cooldown", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      cooldown: { durationTicks: 4, startsOn: "pay" },
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const { engine, resources } = harness([ability]);

    expect(engine.request(selfRequest(ability.id, source, 10)).accepted).toBe(
      true,
    );
    expect(engine.request(selfRequest(ability.id, source, 11))).toMatchObject({
      accepted: false,
      reason: "cooldown-active",
    });
    expect(resources.changes).toEqual([-10]);
  });

  it("keeps snapshot reads fixed and live reads current", () => {
    const snapshot = definition("fixture:snapshot");
    const live = definition("fixture:live", {
      statPolicy: "live",
      capturedStatIds: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([snapshot, live]);

    const snapshotResult = fixture.engine.request(
      selfRequest(snapshot.id, source),
    );
    fixture.setStat(9);
    if (!snapshotResult.accepted)
      throw new Error("snapshot request was rejected");
    fixture.engine.advance(snapshotResult.execution.executionId, 1);

    const liveResult = fixture.engine.request(selfRequest(live.id, source, 5));
    fixture.setStat(12);
    if (!liveResult.accepted) throw new Error("live request was rejected");
    fixture.engine.advance(liveResult.execution.executionId, 6);

    expect(fixture.effectReads).toEqual([5, 12]);
  });

  it("detects trigger cycles without recursively executing them", () => {
    const firstId = contentId("fixture:cycle-a");
    const secondId = contentId("fixture:cycle-b");
    const first = definition("fixture:cycle-a", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      effects: [{ kind: "trigger-ability", abilityId: secondId }],
    });
    const second = definition("fixture:cycle-b", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      effects: [{ kind: "trigger-ability", abilityId: firstId }],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const { engine, events } = harness([first, second]);

    expect(engine.request(selfRequest(first.id, source)).accepted).toBe(true);
    expect(events.filter(({ stage }) => stage === "reject")).toEqual([
      expect.objectContaining({ reason: "trigger-cycle", abilityId: first.id }),
    ]);
  });

  it("caps shared trigger work across a trigger chain", () => {
    const childId = contentId("fixture:budget-child");
    const effect = {
      kind: "modify-resource" as const,
      resourceId: mana,
      amount: 1,
      recipient: "source" as const,
    };
    const parent = definition("fixture:budget-parent", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      effects: [{ kind: "trigger-ability", abilityId: childId }, effect],
    });
    const child = definition("fixture:budget-child", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      effects: [effect, effect],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const { engine, effectReads, events } = harness([parent, child], {
      maximumEffects: 2,
    });

    expect(engine.request(selfRequest(parent.id, source)).accepted).toBe(true);
    expect(effectReads).toEqual([5]);
    expect(events).toContainEqual(
      expect.objectContaining({ reason: "trigger-budget-exhausted" }),
    );
  });

  it("requires one-tick monotonic advancement", () => {
    const ability = definition("fixture:fixed-step");
    const source = new SequentialRuntimeEntityIds().next();
    const { engine } = harness([ability]);
    const result = engine.request(selfRequest(ability.id, source));
    if (!result.accepted) throw new Error("fixture request was rejected");

    expect(() => engine.advance(result.execution.executionId, 2)).toThrow(
      /exactly one fixed tick/,
    );
  });

  it("replays injected seeded effect randomness deterministically", () => {
    const ability = definition("fixture:random", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const first = harness([ability]);
    const second = harness([ability]);

    first.engine.request(selfRequest(ability.id, source));
    second.engine.request(selfRequest(ability.id, source));

    expect(first.randomDraws).toEqual(second.randomDraws);
    expect(first.randomDraws).toHaveLength(1);
  });
});

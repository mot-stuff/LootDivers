import { describe, expect, it } from "vitest";

import {
  AbilityExecutionEngine,
  CORE_MODIFY_RESOURCE_EXECUTOR_ID,
  contentId,
  Mulberry32,
  SequentialRuntimeEntityIds,
  type AbilityCooldownHandle,
  type AbilityCooldownPort,
  type AbilityDefinition,
  type AbilityEffectExecutor,
  type AbilityExecutionDependencies,
  type AbilityExecutionEvent,
  type AbilityResourcePort,
  type ContentId,
  type ResourcePaymentHandle,
  type ResourceReservationHandle,
  type RuntimeEntityId,
  type StatefulRandomSource,
} from "../../src/core/index.ts";

const mana = contentId("fixture:mana");
const power = contentId("fixture:power");
const health = contentId("fixture:health");
const inspectExecutor = contentId("fixture:inspect-executor");
const recordExecutor = contentId("fixture:record-executor");

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
    statCaptures: [{ subject: "source", statId: power }],
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
  public readonly operations: string[] = [];
  public operationHook: ((operation: string) => void) | undefined;
  private nextToken = 1;
  private readonly amounts = new Map<number, number>();

  canSpend(_entityId: RuntimeEntityId, _resourceId: ContentId, amount: number) {
    return this.balance >= amount;
  }

  pay(
    _entityId: RuntimeEntityId,
    _resourceId: ContentId,
    amount: number,
  ): ResourcePaymentHandle {
    const handle = { kind: "payment" as const, token: this.nextToken++ };
    this.balance -= amount;
    this.amounts.set(handle.token, amount);
    this.operations.push(`pay:${handle.token}:${amount}`);
    this.operationHook?.("pay");
    return handle;
  }

  reserve(
    _entityId: RuntimeEntityId,
    _resourceId: ContentId,
    amount: number,
  ): ResourceReservationHandle {
    const handle = { kind: "reservation" as const, token: this.nextToken++ };
    this.balance -= amount;
    this.amounts.set(handle.token, amount);
    this.operations.push(`reserve:${handle.token}:${amount}`);
    this.operationHook?.("reserve");
    return handle;
  }

  refund(handle: ResourcePaymentHandle) {
    this.balance += this.requireAmount(handle.token);
    this.operations.push(`refund:${handle.token}`);
    this.operationHook?.("refund");
  }

  commit(handle: ResourceReservationHandle) {
    this.requireAmount(handle.token);
    this.operations.push(`commit:${handle.token}`);
    this.operationHook?.("commit");
  }

  release(handle: ResourceReservationHandle) {
    this.balance += this.requireAmount(handle.token);
    this.operations.push(`release:${handle.token}`);
    this.operationHook?.("release");
  }

  private requireAmount(token: number) {
    const amount = this.amounts.get(token);
    if (amount === undefined) throw new Error(`unknown settlement ${token}`);
    this.amounts.delete(token);
    return amount;
  }
}

class CooldownFixture implements AbilityCooldownPort {
  public operationHook: ((operation: "start" | "clear") => void) | undefined;
  private nextToken = 1;
  private readonly active = new Map<
    string,
    { handle: AbilityCooldownHandle; endTick: number }
  >();

  remainingTicks(
    entityId: RuntimeEntityId,
    abilityId: ContentId,
    atTick: number,
  ) {
    return Math.max(
      0,
      (this.active.get(`${entityId}:${abilityId}`)?.endTick ?? 0) - atTick,
    );
  }

  start(
    entityId: RuntimeEntityId,
    abilityId: ContentId,
    atTick: number,
    durationTicks: number,
  ) {
    const handle = {
      token: this.nextToken++,
      entityId,
      abilityId,
    };
    this.active.set(`${entityId}:${abilityId}`, {
      handle,
      endTick: atTick + durationTicks,
    });
    this.operationHook?.("start");
    return handle;
  }

  clear(handle: AbilityCooldownHandle) {
    const key = `${handle.entityId}:${handle.abilityId}`;
    if (this.active.get(key)?.handle.token !== handle.token) return false;
    this.active.delete(key);
    this.operationHook?.("clear");
    return true;
  }
}

function harness(
  definitions: readonly AbilityDefinition[],
  limits = { maximumDepth: 4, maximumEffectsPerTick: 16 },
  random: StatefulRandomSource = new Mulberry32(0x5eed_0009),
) {
  const resources = new ResourceFixture();
  const cooldowns = new CooldownFixture();
  const events: AbilityExecutionEvent[] = [];
  const effectLog: string[] = [];
  const statValues = new Map<string, number>();
  let eventHook: ((event: AbilityExecutionEvent) => void) | undefined;
  const executorMap = new Map<ContentId, AbilityEffectExecutor>();
  executorMap.set(CORE_MODIFY_RESOURCE_EXECUTOR_ID, {
    execute: () => {
      effectLog.push("modify");
    },
  });
  const dependencies: AbilityExecutionDependencies = {
    definitions: {
      get: (id) => definitions.find((entry) => entry.id === id),
    },
    resources,
    cooldowns,
    stats: {
      read: (entityId, statId) => statValues.get(`${entityId}:${statId}`) ?? 0,
    },
    targets: {
      validate: (request, ability) =>
        request.target.kind === ability.targeting.mode,
    },
    events: {
      publish: (event) => {
        events.push(event);
        eventHook?.(event);
      },
    },
    random,
    executors: {
      has: (kind) => executorMap.has(kind),
      get: (kind) => executorMap.get(kind),
    },
    triggerLimits: limits,
  };
  const engine = new AbilityExecutionEngine(dependencies);
  return {
    engine,
    resources,
    cooldowns,
    events,
    effectLog,
    statValues,
    executorMap,
    random,
    setEventHook: (hook: typeof eventHook) => {
      eventHook = hook;
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

describe("ability runtime remediation contracts", () => {
  it("commits a reservation before completion becomes observable", () => {
    const ability = definition("fixture:complete", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 10, settlement: "reserve" }],
      cooldown: { durationTicks: 4, startsOn: "complete" },
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    let operationsAtComplete: string[] = [];
    fixture.setEventHook((event) => {
      if (event.stage === "complete") {
        operationsAtComplete = [...fixture.resources.operations];
      }
    });

    const result = fixture.engine.request(selfRequest(ability.id, source));

    expect(result).toMatchObject({ accepted: true });
    expect(operationsAtComplete).toEqual(["reserve:1:10", "commit:1"]);
    expect(fixture.resources.balance).toBe(90);
  });

  it("terminalizes completion before settlement callbacks can reenter", () => {
    const ability = definition("fixture:complete-settlement-reentry", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 10, settlement: "reserve" }],
      cooldown: { durationTicks: 4, startsOn: "complete" },
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    const observedStages: string[] = [];
    const reentrantRequests: unknown[] = [];
    const reenter = () => {
      observedStages.push(fixture.engine.cancel(1, 0).stage);
      reentrantRequests.push(
        fixture.engine.request(selfRequest(ability.id, source)),
      );
    };
    fixture.resources.operationHook = (operation) => {
      if (operation === "commit") reenter();
    };
    fixture.cooldowns.operationHook = (operation) => {
      if (operation === "start") reenter();
    };

    const result = fixture.engine.request(selfRequest(ability.id, source));

    expect(result).toMatchObject({
      accepted: true,
      execution: { stage: "complete" },
    });
    expect(observedStages).toEqual(["complete", "complete"]);
    expect(reentrantRequests).toEqual([
      expect.objectContaining({
        accepted: false,
        reason: "reentrant-mutation",
      }),
      expect.objectContaining({
        accepted: false,
        reason: "reentrant-mutation",
      }),
    ]);
    expect(
      fixture.events.filter(
        (event) => event.abilityId === ability.id && event.stage === "complete",
      ),
    ).toHaveLength(1);
    expect(
      fixture.events.some(
        (event) => event.abilityId === ability.id && event.stage === "cancel",
      ),
    ).toBe(false);
  });

  it("rejects an unavailable executor before resource settlement", () => {
    const ability = definition("fixture:unavailable", {
      effects: [
        {
          kind: "custom",
          executorKind: contentId("fixture:missing-executor"),
          parameters: [],
        },
      ],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);

    expect(
      fixture.engine.request(selfRequest(ability.id, source)),
    ).toMatchObject({ accepted: false, reason: "executor-unavailable" });
    expect(fixture.resources.operations).toEqual([]);
  });

  it("starts active cooldown before a reentrant stage observer can request again", () => {
    const ability = definition("fixture:reentrant", {
      timing: { startupTicks: 0, activeTicks: 1, recoveryTicks: 0 },
      cooldown: { durationTicks: 5, startsOn: "active" },
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    const reentrantResults: unknown[] = [];
    fixture.setEventHook((event) => {
      if (event.stage === "active") {
        reentrantResults.push(
          fixture.engine.request(selfRequest(ability.id, source)),
        );
      }
    });

    fixture.engine.request(selfRequest(ability.id, source));

    expect(reentrantResults).toEqual([
      expect.objectContaining({
        accepted: false,
        reason: "cooldown-active",
      }),
    ]);
    expect(fixture.resources.operations).toEqual(["pay:1:10"]);
  });

  it("shares one aggregate effect budget across root requests in a tick", () => {
    const first = definition("fixture:budget-first", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
    });
    const second = definition("fixture:budget-second", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 20, settlement: "reserve" }],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([first, second], {
      maximumDepth: 4,
      maximumEffectsPerTick: 1,
    });

    const firstResult = fixture.engine.request(selfRequest(first.id, source));
    const secondResult = fixture.engine.request(selfRequest(second.id, source));

    expect(firstResult).toMatchObject({ accepted: true });
    expect(secondResult).toMatchObject({
      accepted: false,
      reason: "trigger-budget-exhausted",
    });
    expect(fixture.effectLog).toEqual(["modify"]);
    expect(fixture.resources.operations).toEqual([]);
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        abilityId: second.id,
        reason: "trigger-budget-exhausted",
      }),
    );
  });

  it("allows forward idle tick gaps while rejecting backward time", () => {
    const ability = definition("fixture:idle-gap", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);

    expect(
      fixture.engine.request(selfRequest(ability.id, source, 0)),
    ).toMatchObject({ accepted: true });
    expect(
      fixture.engine.request(selfRequest(ability.id, source, 10)),
    ).toMatchObject({ accepted: true });
    expect(() =>
      fixture.engine.request(selfRequest(ability.id, source, 9)),
    ).toThrow(/cannot precede current tick 10/);
  });

  it("rejects a queued child before settlement when aggregate work is exhausted", () => {
    const childId = contentId("fixture:budget-child");
    const parent = definition("fixture:budget-parent", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 5, settlement: "reserve" }],
      statCaptures: [],
      effects: [{ kind: "trigger-ability", abilityId: childId }],
    });
    const child = definition("fixture:budget-child", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 30, settlement: "reserve" }],
      statCaptures: [],
      effects: [
        {
          kind: "modify-resource",
          resourceId: mana,
          amount: 1,
          recipient: "source",
        },
      ],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([parent, child], {
      maximumDepth: 4,
      maximumEffectsPerTick: 1,
    });

    expect(
      fixture.engine.request(selfRequest(parent.id, source)),
    ).toMatchObject({ accepted: true, execution: { stage: "complete" } });
    expect(fixture.resources.operations).toEqual(["reserve:1:5", "commit:1"]);
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        abilityId: child.id,
        reason: "trigger-budget-exhausted",
      }),
    );
  });

  it("rolls back and cancels a delayed activation that cannot reserve work", () => {
    const blocking = definition("fixture:activation-blocker", {
      timing: { startupTicks: 1, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
    });
    const rejected = definition("fixture:activation-rejected", {
      timing: { startupTicks: 1, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 25, settlement: "reserve" }],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([blocking, rejected], {
      maximumDepth: 4,
      maximumEffectsPerTick: 1,
    });
    const first = fixture.engine.request(selfRequest(blocking.id, source));
    const second = fixture.engine.request(selfRequest(rejected.id, source));
    if (!first.accepted || !second.accepted)
      throw new Error("fixture rejected");
    const reentrantCancellationStages: string[] = [];
    fixture.setEventHook((event) => {
      if (
        event.abilityId === rejected.id &&
        event.reason === "trigger-budget-exhausted"
      ) {
        reentrantCancellationStages.push(
          fixture.engine.cancel(event.executionId, event.tick).stage,
        );
      }
    });

    fixture.engine.advance(first.execution.executionId, 1);
    const cancelled = fixture.engine.advance(second.execution.executionId, 1);

    expect(cancelled.stage).toBe("cancel");
    expect(reentrantCancellationStages).toEqual(["cancel"]);
    expect(fixture.resources.operations).toEqual(["reserve:1:25", "release:1"]);
    expect(fixture.resources.balance).toBe(100);
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        abilityId: rejected.id,
        reason: "trigger-budget-exhausted",
      }),
    );
    expect(
      fixture.events.some(
        (event) => event.abilityId === rejected.id && event.stage === "active",
      ),
    ).toBe(false);
    expect(
      fixture.events.filter(
        (event) => event.abilityId === rejected.id && event.stage === "cancel",
      ),
    ).toHaveLength(1);
  });

  it("does not execute or complete after an active observer cancels reentrantly", () => {
    const ability = definition("fixture:reentrant-cancel", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      cancellation: {
        allowedDuring: ["active"],
        refund: "all",
        cooldown: "clear",
      },
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    fixture.setEventHook((event) => {
      if (event.stage === "active") {
        fixture.engine.cancel(event.executionId, event.tick);
      }
    });

    const result = fixture.engine.request(selfRequest(ability.id, source));

    expect(result).toMatchObject({
      accepted: true,
      execution: { stage: "cancel" },
    });
    expect(fixture.effectLog).toEqual([]);
    expect(fixture.resources.operations).toEqual(["pay:1:10", "refund:1"]);
    expect(
      fixture.events.some(
        (event) => event.abilityId === ability.id && event.stage === "complete",
      ),
    ).toBe(false);
  });

  it("stops the effect batch when a custom executor cancels reentrantly", () => {
    const childId = contentId("fixture:cancelled-batch-child");
    const cancelExecutor = contentId("fixture:cancel-executor");
    const ability = definition("fixture:cancelled-batch", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      cancellation: {
        allowedDuring: ["active"],
        refund: "all",
        cooldown: "clear",
      },
      effects: [
        {
          kind: "custom",
          executorKind: cancelExecutor,
          parameters: [],
        },
        {
          kind: "custom",
          executorKind: recordExecutor,
          parameters: [{ key: "label", value: "later-effect" }],
        },
        { kind: "trigger-ability", abilityId: childId },
      ],
    });
    const child = definition("fixture:cancelled-batch-child", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability, child]);
    fixture.executorMap.set(cancelExecutor, {
      execute: (_effect, context) => {
        fixture.effectLog.push("cancel-effect");
        fixture.engine.cancel(context.executionId, context.tick);
      },
    });
    fixture.executorMap.set(recordExecutor, {
      execute: () => {
        fixture.effectLog.push("later-effect");
      },
    });

    const result = fixture.engine.request(selfRequest(ability.id, source));

    expect(result).toMatchObject({
      accepted: true,
      execution: { stage: "cancel" },
    });
    expect(fixture.effectLog).toEqual(["cancel-effect"]);
    expect(fixture.events.some((event) => event.abilityId === child.id)).toBe(
      false,
    );
  });

  it("defers trigger flushing to the outermost reentrant dispatch", () => {
    const childAId = contentId("fixture:dispatch-child-a");
    const childBId = contentId("fixture:dispatch-child-b");
    const reentrantId = contentId("fixture:dispatch-reentrant");
    const actionExecutor = contentId("fixture:dispatch-action");
    const custom = (label: string) => ({
      kind: "custom" as const,
      executorKind: actionExecutor,
      parameters: [{ key: "label", value: label }],
    });
    const parent = definition("fixture:dispatch-parent", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [
        { kind: "trigger-ability", abilityId: childAId },
        custom("reenter"),
        custom("parent-end"),
      ],
    });
    const reentrant = definition("fixture:dispatch-reentrant", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [{ kind: "trigger-ability", abilityId: childBId }],
    });
    const childA = definition("fixture:dispatch-child-a", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [custom("child-a")],
    });
    const childB = definition("fixture:dispatch-child-b", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [custom("child-b")],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([parent, reentrant, childA, childB]);
    fixture.executorMap.set(actionExecutor, {
      execute: (effect, context) => {
        if (effect.kind !== "custom") throw new Error("wrong effect");
        const label = String(effect.parameters[0]?.value);
        fixture.effectLog.push(label);
        if (label === "reenter") {
          fixture.engine.request(
            selfRequest(reentrantId, context.sourceId, context.tick),
          );
        }
      },
    });

    fixture.engine.request(selfRequest(parent.id, source));

    expect(fixture.effectLog).toEqual([
      "reenter",
      "parent-end",
      "child-a",
      "child-b",
    ]);
  });

  it("replays effect RNG observations and final state from a saved seed state", () => {
    const randomExecutor = contentId("fixture:random-executor");
    const ability = definition("fixture:random-replay", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [
        {
          kind: "custom",
          executorKind: randomExecutor,
          parameters: [],
        },
      ],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const firstRandom = new Mulberry32(0x1234_5678);
    const initialState = firstRandom.saveState();
    const first = harness(
      [ability],
      { maximumDepth: 4, maximumEffectsPerTick: 16 },
      firstRandom,
    );
    const firstObservations: number[] = [];
    first.executorMap.set(randomExecutor, {
      execute: (_effect, context) => {
        firstObservations.push(
          context.random.nextUint32(),
          context.random.nextUint32(),
        );
      },
    });

    first.engine.request(selfRequest(ability.id, source));
    const firstFinalState = first.random.saveState();

    const replay = harness(
      [ability],
      { maximumDepth: 4, maximumEffectsPerTick: 16 },
      Mulberry32.fromState(initialState),
    );
    const replayObservations: number[] = [];
    replay.executorMap.set(randomExecutor, {
      execute: (_effect, context) => {
        replayObservations.push(
          context.random.nextUint32(),
          context.random.nextUint32(),
        );
      },
    });
    replay.engine.request(selfRequest(ability.id, source));

    expect(replayObservations).toEqual(firstObservations);
    expect(replay.random.saveState()).toEqual(firstFinalState);
  });

  it("retains runtime trigger cycle and chain-depth bounds", () => {
    const cycleAId = contentId("fixture:cycle-a");
    const cycleBId = contentId("fixture:cycle-b");
    const cycleA = definition("fixture:cycle-a", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [{ kind: "trigger-ability", abilityId: cycleBId }],
    });
    const cycleB = definition("fixture:cycle-b", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [{ kind: "trigger-ability", abilityId: cycleAId }],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const cycleFixture = harness([cycleA, cycleB]);
    cycleFixture.engine.request(selfRequest(cycleA.id, source));
    expect(cycleFixture.events).toContainEqual(
      expect.objectContaining({ reason: "trigger-cycle" }),
    );

    const childId = contentId("fixture:depth-child");
    const grandchildId = contentId("fixture:depth-grandchild");
    const parent = definition("fixture:depth-parent", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [{ kind: "trigger-ability", abilityId: childId }],
    });
    const child = definition("fixture:depth-child", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [{ kind: "trigger-ability", abilityId: grandchildId }],
    });
    const grandchild = definition("fixture:depth-grandchild", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [],
    });
    const depthFixture = harness([parent, child, grandchild], {
      maximumDepth: 1,
      maximumEffectsPerTick: 16,
    });
    depthFixture.engine.request(selfRequest(parent.id, source));
    expect(depthFixture.events).toContainEqual(
      expect.objectContaining({
        abilityId: grandchild.id,
        reason: "trigger-budget-exhausted",
      }),
    );
  });

  it("cannot clear a newer cooldown with an older execution token", () => {
    const ability = definition("fixture:owned-cooldown", {
      timing: { startupTicks: 3, activeTicks: 1, recoveryTicks: 1 },
      costs: [],
      cooldown: { durationTicks: 1, startsOn: "pay" },
      cancellation: {
        allowedDuring: ["startup"],
        refund: "none",
        cooldown: "clear",
      },
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    const first = fixture.engine.request(selfRequest(ability.id, source, 0));
    const second = fixture.engine.request(selfRequest(ability.id, source, 1));
    if (!first.accepted || !second.accepted)
      throw new Error("fixture rejected");

    fixture.engine.cancel(first.execution.executionId, 1);

    expect(fixture.cooldowns.remainingTicks(source, ability.id, 1)).toBe(1);
  });

  it("advances to the cancellation tick before deciding refund eligibility", () => {
    const ability = definition("fixture:future-cancel", {
      timing: { startupTicks: 1, activeTicks: 0, recoveryTicks: 0 },
      costs: [{ resourceId: mana, amount: 20, settlement: "reserve" }],
      cancellation: {
        allowedDuring: ["startup"],
        refund: "reserved",
        cooldown: "clear",
      },
      effects: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    const result = fixture.engine.request(selfRequest(ability.id, source));
    if (!result.accepted) throw new Error("fixture rejected");

    expect(() =>
      fixture.engine.cancel(result.execution.executionId, 1),
    ).toThrow(/cannot be cancelled from stage "complete"/);
    expect(fixture.resources.operations).toEqual(["reserve:1:20", "commit:1"]);
    expect(fixture.resources.balance).toBe(80);
  });

  it("releases reserved costs and refunds paid costs only under explicit policy", () => {
    const ability = definition("fixture:settlement", {
      costs: [
        { resourceId: mana, amount: 10, settlement: "pay" },
        { resourceId: health, amount: 15, settlement: "reserve" },
      ],
      cancellation: {
        allowedDuring: ["startup"],
        refund: "all",
        cooldown: "retain",
      },
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    const result = fixture.engine.request(selfRequest(ability.id, source));
    if (!result.accepted) throw new Error("fixture rejected");

    fixture.engine.cancel(result.execution.executionId, 0);

    expect(fixture.resources.operations).toEqual([
      "pay:1:10",
      "reserve:2:15",
      "refund:1",
      "release:2",
    ]);
    expect(fixture.resources.balance).toBe(100);
  });

  it("terminalizes cancellation before settlement callbacks can reenter", () => {
    const ability = definition("fixture:cancel-settlement-reentry", {
      cooldown: { durationTicks: 4, startsOn: "pay" },
      cancellation: {
        allowedDuring: ["startup"],
        refund: "all",
        cooldown: "clear",
      },
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);
    const result = fixture.engine.request(selfRequest(ability.id, source));
    if (!result.accepted) throw new Error("fixture rejected");
    const observedStages: string[] = [];
    const reenter = () => {
      observedStages.push(
        fixture.engine.cancel(result.execution.executionId, 0).stage,
      );
    };
    fixture.resources.operationHook = (operation) => {
      if (operation === "refund") reenter();
    };
    fixture.cooldowns.operationHook = (operation) => {
      if (operation === "clear") reenter();
    };

    const cancelled = fixture.engine.cancel(result.execution.executionId, 0);

    expect(cancelled.stage).toBe("cancel");
    expect(observedStages).toEqual(["cancel", "cancel"]);
    expect(fixture.resources.operations).toEqual(["pay:1:10", "refund:1"]);
    expect(
      fixture.events.filter(
        (event) => event.abilityId === ability.id && event.stage === "cancel",
      ),
    ).toHaveLength(1);
    expect(
      fixture.events.some(
        (event) => event.abilityId === ability.id && event.stage === "complete",
      ),
    ).toBe(false);
  });

  it("combines snapshot source offense with live source and target reads", () => {
    const ability = definition("fixture:mixed-stats", {
      targeting: { mode: "entity", range: 10 },
      costs: [],
      statCaptures: [{ subject: "source", statId: power }],
      effects: [
        {
          kind: "custom",
          executorKind: inspectExecutor,
          parameters: [],
        },
      ],
    });
    const ids = new SequentialRuntimeEntityIds();
    const source = ids.next();
    const target = ids.next();
    const fixture = harness([ability]);
    const reads: number[] = [];
    fixture.executorMap.set(inspectExecutor, {
      execute: (_effect, context) => {
        reads.push(
          context.readStat({
            subject: "source",
            statId: power,
            policy: "snapshot",
          }),
          context.readStat({
            subject: "source",
            statId: health,
            policy: "live",
          }),
          context.readStat({
            subject: "target",
            statId: health,
            policy: "live",
          }),
        );
      },
    });
    fixture.statValues.set(`${source}:${power}`, 5);
    fixture.statValues.set(`${source}:${health}`, 20);
    fixture.statValues.set(`${target}:${health}`, 30);
    const result = fixture.engine.request({
      abilityId: ability.id,
      sourceId: source,
      target: { kind: "entity", entityId: target },
      requestedAtTick: 0,
    });
    fixture.statValues.set(`${source}:${power}`, 9);
    fixture.statValues.set(`${source}:${health}`, 21);
    fixture.statValues.set(`${target}:${health}`, 31);
    if (!result.accepted) throw new Error("fixture rejected");

    fixture.engine.advance(result.execution.executionId, 1);

    expect(reads).toEqual([5, 21, 31]);
  });

  it("rejects target-recipient effects without an entity target before payment", () => {
    const ability = definition("fixture:invalid-recipient", {
      effects: [
        {
          kind: "modify-resource",
          resourceId: mana,
          amount: 1,
          recipient: "target",
        },
      ],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([ability]);

    expect(
      fixture.engine.request(selfRequest(ability.id, source)),
    ).toMatchObject({ accepted: false, reason: "target-invalid" });
    expect(fixture.resources.operations).toEqual([]);
  });

  it("queues triggers FIFO after parent effects regardless of child phase timing", () => {
    const slowId = contentId("fixture:slow-child");
    const fastId = contentId("fixture:fast-child");
    const record = (label: string) => ({
      kind: "custom" as const,
      executorKind: recordExecutor,
      parameters: [{ key: "label", value: label }],
    });
    const parent = definition("fixture:queue-parent", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [
        record("parent-a"),
        { kind: "trigger-ability", abilityId: slowId },
        { kind: "trigger-ability", abilityId: fastId },
        record("parent-b"),
      ],
    });
    const slow = definition("fixture:slow-child", {
      timing: { startupTicks: 1, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [record("slow")],
    });
    const fast = definition("fixture:fast-child", {
      timing: { startupTicks: 0, activeTicks: 0, recoveryTicks: 0 },
      costs: [],
      statCaptures: [],
      effects: [record("fast")],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([parent, slow, fast]);
    fixture.executorMap.set(recordExecutor, {
      execute: (effect) => {
        if (effect.kind !== "custom") throw new Error("wrong effect");
        fixture.effectLog.push(String(effect.parameters[0]?.value));
      },
    });

    fixture.engine.request(selfRequest(parent.id, source));

    expect(fixture.effectLog).toEqual(["parent-a", "parent-b", "fast"]);
    expect(
      fixture.events
        .filter(({ stage }) => stage === "startup")
        .map(({ abilityId }) => abilityId),
    ).toEqual([parent.id, slow.id, fast.id]);
    const slowStart = fixture.events.find(
      (event) => event.abilityId === slow.id && event.stage === "startup",
    );
    if (slowStart === undefined) throw new Error("slow child not queued");
    fixture.engine.advance(slowStart.executionId, 1);
    expect(fixture.effectLog).toEqual(["parent-a", "parent-b", "fast", "slow"]);
  });
});

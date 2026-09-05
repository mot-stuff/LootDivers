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
    return handle;
  }

  refund(handle: ResourcePaymentHandle) {
    this.balance += this.requireAmount(handle.token);
    this.operations.push(`refund:${handle.token}`);
  }

  commit(handle: ResourceReservationHandle) {
    this.requireAmount(handle.token);
    this.operations.push(`commit:${handle.token}`);
  }

  release(handle: ResourceReservationHandle) {
    this.balance += this.requireAmount(handle.token);
    this.operations.push(`release:${handle.token}`);
  }

  private requireAmount(token: number) {
    const amount = this.amounts.get(token);
    if (amount === undefined) throw new Error(`unknown settlement ${token}`);
    this.amounts.delete(token);
    return amount;
  }
}

class CooldownFixture implements AbilityCooldownPort {
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
    return handle;
  }

  clear(handle: AbilityCooldownHandle) {
    const key = `${handle.entityId}:${handle.abilityId}`;
    if (this.active.get(key)?.handle.token !== handle.token) return false;
    this.active.delete(key);
    return true;
  }
}

function harness(
  definitions: readonly AbilityDefinition[],
  limits = { maximumDepth: 4, maximumEffectsPerTick: 16 },
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
    random: new Mulberry32(0x5eed_0009),
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
      costs: [],
    });
    const source = new SequentialRuntimeEntityIds().next();
    const fixture = harness([first, second], {
      maximumDepth: 4,
      maximumEffectsPerTick: 1,
    });

    fixture.engine.request(selfRequest(first.id, source));
    fixture.engine.request(selfRequest(second.id, source));

    expect(fixture.effectLog).toEqual(["modify"]);
    expect(fixture.events).toContainEqual(
      expect.objectContaining({
        abilityId: second.id,
        reason: "trigger-budget-exhausted",
      }),
    );
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

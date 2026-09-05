import {
  CORE_MODIFY_RESOURCE_EXECUTOR_ID,
  type AbilityCooldownHandle,
  type AbilityDefinition,
  type AbilityDefinitionSource,
  type AbilityEffectContext,
  type AbilityExecutionEventSink,
  type AbilityExecutionSnapshot,
  type AbilityExecutorRegistry,
  type AbilityRequest,
  type AbilityRequestResult,
  type AbilityRejectionReason,
  type AbilityResourcePort,
  type AbilityStage,
  type AbilityStageTransition,
  type AbilityStatCapture,
  type AbilityStatPort,
  type AbilityTargetValidator,
  type CapturedAbilityStat,
  type ResourcePaymentHandle,
  type ResourceReservationHandle,
  type TriggerLimits,
} from "./ability-runtime-contracts";
import type { ContentId, RuntimeEntityId } from "./ids";
import type { RandomSource } from "./random";

type SettledCost =
  | { readonly kind: "payment"; readonly handle: ResourcePaymentHandle }
  | {
      readonly kind: "reservation";
      readonly handle: ResourceReservationHandle;
    };

interface ExecutionRecord {
  readonly executionId: number;
  readonly request: AbilityRequest;
  readonly definition: AbilityDefinition;
  readonly capturedStats: readonly CapturedAbilityStat[];
  readonly history: AbilityStageTransition[];
  readonly triggerPath: readonly ContentId[];
  readonly settledCosts: readonly SettledCost[];
  stage: AbilityStage;
  stageElapsedTicks: number;
  lastTick: number;
  cooldown: AbilityCooldownHandle | undefined;
  workReserved: boolean;
}

interface QueuedTrigger {
  readonly request: AbilityRequest;
  readonly triggerPath: readonly ContentId[];
}

export interface AbilityExecutionDependencies {
  readonly definitions: AbilityDefinitionSource;
  readonly resources: AbilityResourcePort;
  readonly cooldowns: import("./ability-runtime-contracts").AbilityCooldownPort;
  readonly stats: AbilityStatPort;
  readonly targets: AbilityTargetValidator;
  readonly events: AbilityExecutionEventSink;
  readonly random: RandomSource;
  readonly executors: AbilityExecutorRegistry;
  readonly triggerLimits: TriggerLimits;
}

function requireTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new RangeError("Ability ticks must be non-negative safe integers.");
  }
}

function requireLimits(limits: TriggerLimits): void {
  if (
    !Number.isSafeInteger(limits.maximumDepth) ||
    limits.maximumDepth < 0 ||
    !Number.isSafeInteger(limits.maximumEffectsPerTick) ||
    limits.maximumEffectsPerTick < 1
  ) {
    throw new RangeError(
      "Trigger limits require a non-negative depth and positive per-tick effect budget.",
    );
  }
}

function executorKind(effect: AbilityDefinition["effects"][number]) {
  if (effect.kind === "trigger-ability") return undefined;
  return effect.kind === "custom"
    ? effect.executorKind
    : CORE_MODIFY_RESOURCE_EXECUTOR_ID;
}

export class AbilityExecutionEngine {
  private readonly executions = new Map<number, ExecutionRecord>();
  private readonly triggerQueue: QueuedTrigger[] = [];
  private nextExecutionId = 1;
  private currentTick: number | undefined;
  private remainingEffects = 0;
  private flushingTriggers = false;

  public constructor(
    private readonly dependencies: AbilityExecutionDependencies,
  ) {
    requireLimits(dependencies.triggerLimits);
  }

  public request(request: AbilityRequest): AbilityRequestResult {
    this.enterTick(request.requestedAtTick);
    const result = this.requestQueued(request, []);
    this.flushTriggerQueue();
    return result;
  }

  public advance(executionId: number, tick: number): AbilityExecutionSnapshot {
    this.enterTick(tick);
    const record = this.requireExecution(executionId);
    if (record.stage === "complete" || record.stage === "cancel") {
      throw new Error(`Execution ${executionId} is already terminal.`);
    }
    if (tick !== record.lastTick + 1) {
      throw new RangeError(
        `Execution ${executionId} must advance once at current simulation tick ${tick}.`,
      );
    }
    this.advanceOneTick(record, tick);
    this.flushTriggerQueue();
    return this.snapshot(record);
  }

  public cancel(executionId: number, tick: number): AbilityExecutionSnapshot {
    this.enterTick(tick);
    const record = this.requireExecution(executionId);
    if (record.lastTick === tick - 1) {
      this.advanceOneTick(record, tick);
      this.flushTriggerQueue();
    }
    if (record.lastTick !== tick) {
      throw new RangeError(
        `Execution ${executionId} is not coherent with current simulation tick ${tick}.`,
      );
    }
    if (
      record.stage !== "startup" &&
      record.stage !== "active" &&
      record.stage !== "recovery"
    ) {
      throw new Error(
        `Execution ${executionId} cannot be cancelled from stage "${record.stage}".`,
      );
    }
    if (!record.definition.cancellation.allowedDuring.includes(record.stage)) {
      throw new Error(
        `Ability "${record.definition.id}" does not allow cancellation during "${record.stage}".`,
      );
    }

    this.settleCancellation(record);
    if (
      record.cooldown !== undefined &&
      record.definition.cancellation.cooldown === "clear"
    ) {
      this.dependencies.cooldowns.clear(record.cooldown);
      record.cooldown = undefined;
    }
    this.transition(record, "cancel", tick);
    return this.snapshot(record);
  }

  public get(executionId: number): AbilityExecutionSnapshot | undefined {
    const record = this.executions.get(executionId);
    return record === undefined ? undefined : this.snapshot(record);
  }

  private enterTick(tick: number): void {
    requireTick(tick);
    if (this.currentTick === undefined || tick > this.currentTick) {
      this.currentTick = tick;
      this.remainingEffects =
        this.dependencies.triggerLimits.maximumEffectsPerTick;
      return;
    }
    if (tick !== this.currentTick) {
      throw new RangeError(
        `Ability operation tick ${tick} cannot precede current tick ${this.currentTick}.`,
      );
    }
  }

  private requestQueued(
    request: AbilityRequest,
    triggerPath: readonly ContentId[],
  ): AbilityRequestResult {
    const history: AbilityStageTransition[] = [
      { stage: "request", tick: request.requestedAtTick },
      { stage: "validate", tick: request.requestedAtTick },
    ];
    const definition = this.dependencies.definitions.get(request.abilityId);
    if (definition === undefined) {
      return this.reject(request, history, "ability-unknown");
    }
    if (triggerPath.includes(definition.id)) {
      return this.reject(request, history, "trigger-cycle");
    }
    if (triggerPath.length > this.dependencies.triggerLimits.maximumDepth) {
      return this.reject(request, history, "trigger-budget-exhausted");
    }
    if (
      this.dependencies.cooldowns.remainingTicks(
        request.sourceId,
        definition.id,
        request.requestedAtTick,
      ) > 0
    ) {
      return this.reject(request, history, "cooldown-active");
    }
    if (!this.dependencies.targets.validate(request, definition)) {
      return this.reject(request, history, "target-invalid");
    }
    if (
      (definition.statCaptures.some(({ subject }) => subject === "target") ||
        definition.effects.some(
          (effect) =>
            effect.kind === "modify-resource" && effect.recipient === "target",
        )) &&
      request.target.kind !== "entity"
    ) {
      return this.reject(request, history, "target-invalid");
    }
    if (
      definition.effects.some((effect) => {
        const kind = executorKind(effect);
        return kind !== undefined && !this.dependencies.executors.has(kind);
      })
    ) {
      return this.reject(request, history, "executor-unavailable");
    }

    const aggregateCosts = new Map<ContentId, number>();
    for (const cost of definition.costs) {
      aggregateCosts.set(
        cost.resourceId,
        (aggregateCosts.get(cost.resourceId) ?? 0) + cost.amount,
      );
    }
    if (
      [...aggregateCosts].some(
        ([resourceId, amount]) =>
          !this.dependencies.resources.canSpend(
            request.sourceId,
            resourceId,
            amount,
          ),
      )
    ) {
      return this.reject(request, history, "insufficient-resource");
    }
    const workReserved =
      definition.timing.startupTicks === 0
        ? this.reserveEffectWork(definition)
        : false;
    if (definition.timing.startupTicks === 0 && !workReserved) {
      return this.reject(request, history, "trigger-budget-exhausted");
    }

    history.push({ stage: "pay", tick: request.requestedAtTick });
    const capturedStats = definition.statCaptures.map((capture) => ({
      ...capture,
      value: this.dependencies.stats.read(
        this.entityFor(request, capture),
        capture.statId,
        request.requestedAtTick,
      ),
    }));
    const settledCosts = definition.costs.map((cost): SettledCost => {
      if (cost.settlement === "reserve") {
        return {
          kind: "reservation",
          handle: this.dependencies.resources.reserve(
            request.sourceId,
            cost.resourceId,
            cost.amount,
          ),
        };
      }
      return {
        kind: "payment",
        handle: this.dependencies.resources.pay(
          request.sourceId,
          cost.resourceId,
          cost.amount,
        ),
      };
    });
    const executionId = this.nextExecutionId;
    this.nextExecutionId += 1;
    const record: ExecutionRecord = {
      executionId,
      request,
      definition,
      history,
      triggerPath: [...triggerPath, definition.id],
      settledCosts,
      capturedStats,
      stage: "pay",
      stageElapsedTicks: 0,
      lastTick: request.requestedAtTick,
      cooldown: undefined,
      workReserved,
    };
    this.executions.set(executionId, record);
    if (definition.cooldown.startsOn === "pay") {
      this.startCooldown(record, request.requestedAtTick);
    }
    this.transition(record, "startup", request.requestedAtTick);
    this.drainFinishedStages(record, request.requestedAtTick);
    return { accepted: true, execution: this.snapshot(record) };
  }

  private advanceOneTick(record: ExecutionRecord, tick: number): void {
    record.lastTick = tick;
    record.stageElapsedTicks += 1;
    this.drainFinishedStages(record, tick);
  }

  private drainFinishedStages(record: ExecutionRecord, tick: number): void {
    let changed = true;
    while (changed) {
      changed = false;
      if (
        record.stage === "startup" &&
        record.stageElapsedTicks >= record.definition.timing.startupTicks
      ) {
        if (
          !record.workReserved &&
          !this.reserveEffectWork(record.definition)
        ) {
          this.abortForBudget(record, tick);
          return;
        }
        record.workReserved = true;
        if (record.definition.cooldown.startsOn === "active") {
          this.startCooldown(record, tick);
        }
        this.transition(record, "active", tick);
        if (this.executions.get(record.executionId)?.stage !== "active") return;
        this.executeEffects(record, tick);
        if (this.executions.get(record.executionId)?.stage !== "active") return;
        changed = true;
      } else if (
        record.stage === "active" &&
        record.stageElapsedTicks >= record.definition.timing.activeTicks
      ) {
        this.transition(record, "recovery", tick);
        changed = true;
      } else if (
        record.stage === "recovery" &&
        record.stageElapsedTicks >= record.definition.timing.recoveryTicks
      ) {
        this.commitReservations(record);
        if (record.definition.cooldown.startsOn === "complete") {
          this.startCooldown(record, tick);
        }
        this.transition(record, "complete", tick);
        changed = true;
      }
    }
  }

  private executeEffects(record: ExecutionRecord, tick: number): void {
    for (const [effectIndex, effect] of record.definition.effects.entries()) {
      if (effect.kind === "trigger-ability") {
        this.triggerQueue.push({
          request: {
            abilityId: effect.abilityId,
            sourceId: record.request.sourceId,
            target: record.request.target,
            requestedAtTick: tick,
          },
          triggerPath: record.triggerPath,
        });
        continue;
      }
      const kind = executorKind(effect);
      const executor =
        kind === undefined ? undefined : this.dependencies.executors.get(kind);
      if (executor === undefined) {
        throw new Error(`Validated executor "${kind}" became unavailable.`);
      }
      executor.execute(effect, this.effectContext(record, effectIndex, tick));
    }
  }

  private reserveEffectWork(definition: AbilityDefinition): boolean {
    if (definition.effects.length > this.remainingEffects) return false;
    this.remainingEffects -= definition.effects.length;
    return true;
  }

  private abortForBudget(record: ExecutionRecord, tick: number): void {
    for (const settled of record.settledCosts) {
      if (settled.kind === "reservation") {
        this.dependencies.resources.release(settled.handle);
      } else {
        this.dependencies.resources.refund(settled.handle);
      }
    }
    if (record.cooldown !== undefined) {
      this.dependencies.cooldowns.clear(record.cooldown);
      record.cooldown = undefined;
    }
    this.publishRejection(record, tick, "trigger-budget-exhausted");
    this.transition(record, "cancel", tick);
  }

  private flushTriggerQueue(): void {
    if (this.flushingTriggers) return;
    this.flushingTriggers = true;
    try {
      while (this.triggerQueue.length > 0) {
        const queued = this.triggerQueue.shift();
        if (queued !== undefined) {
          this.requestQueued(queued.request, queued.triggerPath);
        }
      }
    } finally {
      this.flushingTriggers = false;
    }
  }

  private effectContext(
    record: ExecutionRecord,
    effectIndex: number,
    tick: number,
  ): AbilityEffectContext {
    return {
      executionId: record.executionId,
      ability: record.definition,
      effectIndex,
      sourceId: record.request.sourceId,
      target: record.request.target,
      tick,
      random: this.dependencies.random,
      entity: (subject) => this.entityFor(record.request, { subject }),
      readStat: (read) => {
        if (read.policy === "snapshot") {
          const captured = record.capturedStats.find(
            (entry) =>
              entry.subject === read.subject && entry.statId === read.statId,
          );
          if (captured === undefined) {
            throw new Error(
              `Snapshot ${read.subject} stat "${read.statId}" was not declared by "${record.definition.id}".`,
            );
          }
          return captured.value;
        }
        return this.dependencies.stats.read(
          this.entityFor(record.request, read),
          read.statId,
          tick,
        );
      },
    };
  }

  private entityFor(
    request: AbilityRequest,
    selector: Pick<AbilityStatCapture, "subject">,
  ): RuntimeEntityId {
    if (selector.subject === "source") return request.sourceId;
    if (request.target.kind !== "entity") {
      throw new Error("Target entity selector requires an entity target.");
    }
    return request.target.entityId;
  }

  private settleCancellation(record: ExecutionRecord): void {
    for (const settled of record.settledCosts) {
      if (settled.kind === "reservation") {
        if (
          record.definition.cancellation.refund === "reserved" ||
          record.definition.cancellation.refund === "all"
        ) {
          this.dependencies.resources.release(settled.handle);
        } else {
          this.dependencies.resources.commit(settled.handle);
        }
      } else if (record.definition.cancellation.refund === "all") {
        this.dependencies.resources.refund(settled.handle);
      }
    }
  }

  private commitReservations(record: ExecutionRecord): void {
    for (const settled of record.settledCosts) {
      if (settled.kind === "reservation") {
        this.dependencies.resources.commit(settled.handle);
      }
    }
  }

  private transition(
    record: ExecutionRecord,
    stage: AbilityStage,
    tick: number,
  ): void {
    record.stage = stage;
    record.stageElapsedTicks = 0;
    record.history.push({ stage, tick });
    this.dependencies.events.publish({
      executionId: record.executionId,
      abilityId: record.definition.id,
      stage,
      tick,
    });
  }

  private startCooldown(record: ExecutionRecord, tick: number): void {
    record.cooldown = this.dependencies.cooldowns.start(
      record.request.sourceId,
      record.definition.id,
      tick,
      record.definition.cooldown.durationTicks,
    );
  }

  private reject(
    request: AbilityRequest,
    history: AbilityStageTransition[],
    reason: AbilityRejectionReason,
  ): AbilityRequestResult {
    history.push({ stage: "reject", tick: request.requestedAtTick });
    this.dependencies.events.publish({
      executionId: 0,
      abilityId: request.abilityId,
      stage: "reject",
      tick: request.requestedAtTick,
      reason,
    });
    return { accepted: false, reason, history };
  }

  private publishRejection(
    record: ExecutionRecord,
    tick: number,
    reason: "trigger-budget-exhausted",
  ): void {
    this.dependencies.events.publish({
      executionId: record.executionId,
      abilityId: record.definition.id,
      stage: "reject",
      tick,
      reason,
    });
  }

  private snapshot(record: ExecutionRecord): AbilityExecutionSnapshot {
    return {
      executionId: record.executionId,
      abilityId: record.definition.id,
      sourceId: record.request.sourceId,
      target: record.request.target,
      stage: record.stage,
      stageElapsedTicks: record.stageElapsedTicks,
      history: [...record.history],
      capturedStats: record.capturedStats.map((entry) => ({ ...entry })),
    };
  }

  private requireExecution(executionId: number): ExecutionRecord {
    const record = this.executions.get(executionId);
    if (record === undefined) {
      throw new Error(`Unknown ability execution ${executionId}.`);
    }
    return record;
  }
}

import {
  type AbilityCooldownPort,
  type AbilityDefinition,
  type AbilityDefinitionSource,
  type AbilityEffectContext,
  type AbilityEffectExecutor,
  type AbilityExecutionEventSink,
  type AbilityExecutionSnapshot,
  type AbilityRequest,
  type AbilityRequestResult,
  type AbilityRejectionReason,
  type AbilityResourcePort,
  type AbilityStage,
  type AbilityStageTransition,
  type AbilityStatPort,
  type AbilityTargetValidator,
  type TriggerLimits,
} from "./ability-contracts";
import type { ContentId } from "./ids";
import type { RandomSource } from "./random";

interface TriggerBudget {
  remainingEffects: number;
}

interface ExecutionRecord {
  readonly executionId: number;
  readonly request: AbilityRequest;
  readonly definition: AbilityDefinition;
  readonly capturedStats?: ReadonlyMap<ContentId, number>;
  readonly history: AbilityStageTransition[];
  readonly triggerBudget: TriggerBudget;
  readonly triggerPath: readonly ContentId[];
  stage: AbilityStage;
  stageElapsedTicks: number;
  lastTick: number;
  cooldownStarted: boolean;
}

export interface AbilityExecutionDependencies {
  readonly definitions: AbilityDefinitionSource;
  readonly resources: AbilityResourcePort;
  readonly cooldowns: AbilityCooldownPort;
  readonly stats: AbilityStatPort;
  readonly targets: AbilityTargetValidator;
  readonly events: AbilityExecutionEventSink;
  readonly random: RandomSource;
  readonly executors: ReadonlyMap<ContentId, AbilityEffectExecutor>;
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
    !Number.isSafeInteger(limits.maximumEffects) ||
    limits.maximumEffects < 1
  ) {
    throw new RangeError(
      "Trigger limits require a non-negative depth and positive effect budget.",
    );
  }
}

export class AbilityExecutionEngine {
  private readonly executions = new Map<number, ExecutionRecord>();
  private nextExecutionId = 1;

  public constructor(
    private readonly dependencies: AbilityExecutionDependencies,
  ) {
    requireLimits(dependencies.triggerLimits);
  }

  public request(request: AbilityRequest): AbilityRequestResult {
    requireTick(request.requestedAtTick);
    return this.requestWithTriggerState(
      request,
      { remainingEffects: this.dependencies.triggerLimits.maximumEffects },
      [],
    );
  }

  public advance(executionId: number, tick: number): AbilityExecutionSnapshot {
    requireTick(tick);
    const record = this.requireExecution(executionId);
    if (record.stage === "complete" || record.stage === "cancel") {
      throw new Error(`Execution ${executionId} is already terminal.`);
    }
    if (tick !== record.lastTick + 1) {
      throw new RangeError(
        `Execution ${executionId} must advance exactly one fixed tick from ${record.lastTick}.`,
      );
    }
    record.lastTick = tick;
    record.stageElapsedTicks += 1;
    this.drainFinishedStages(record, tick);
    return this.snapshot(record);
  }

  public cancel(executionId: number, tick: number): AbilityExecutionSnapshot {
    requireTick(tick);
    const record = this.requireExecution(executionId);
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
    if (tick < record.lastTick) {
      throw new RangeError(
        "Cancellation cannot move simulation time backwards.",
      );
    }

    const refund = record.definition.cancellation.refund;
    for (const cost of record.definition.costs) {
      if (
        refund === "all" ||
        (refund === "reserved" && cost.settlement === "reserve")
      ) {
        this.dependencies.resources.credit(
          record.request.sourceId,
          cost.resourceId,
          cost.amount,
        );
      }
    }
    if (
      record.cooldownStarted &&
      record.definition.cancellation.cooldown === "clear"
    ) {
      this.dependencies.cooldowns.clear(
        record.request.sourceId,
        record.definition.id,
      );
      record.cooldownStarted = false;
    }
    record.lastTick = tick;
    this.transition(record, "cancel", tick);
    return this.snapshot(record);
  }

  public get(executionId: number): AbilityExecutionSnapshot | undefined {
    const record = this.executions.get(executionId);
    return record === undefined ? undefined : this.snapshot(record);
  }

  private requestWithTriggerState(
    request: AbilityRequest,
    triggerBudget: TriggerBudget,
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
      definition.costs.some(
        (cost) =>
          !this.dependencies.resources.canSpend(
            request.sourceId,
            cost.resourceId,
            cost.amount,
          ),
      )
    ) {
      return this.reject(request, history, "insufficient-resource");
    }

    history.push({ stage: "pay", tick: request.requestedAtTick });
    for (const cost of definition.costs) {
      this.dependencies.resources.debit(
        request.sourceId,
        cost.resourceId,
        cost.amount,
      );
    }
    const capturedStats =
      definition.statPolicy === "snapshot"
        ? new Map(
            definition.capturedStatIds.map(
              (statId) =>
                [
                  statId,
                  this.dependencies.stats.read(
                    request.sourceId,
                    statId,
                    request.requestedAtTick,
                  ),
                ] as const,
            ),
          )
        : undefined;
    const executionId = this.nextExecutionId;
    this.nextExecutionId += 1;
    const record: ExecutionRecord = {
      executionId,
      request,
      definition,
      history,
      triggerBudget,
      triggerPath: [...triggerPath, definition.id],
      stage: "pay",
      stageElapsedTicks: 0,
      lastTick: request.requestedAtTick,
      cooldownStarted: false,
      ...(capturedStats === undefined ? {} : { capturedStats }),
    };
    this.executions.set(executionId, record);
    if (definition.cooldown.startsOn === "pay") {
      this.startCooldown(record, request.requestedAtTick);
    }
    this.transition(record, "startup", request.requestedAtTick);
    this.drainFinishedStages(record, request.requestedAtTick);
    return { accepted: true, execution: this.snapshot(record) };
  }

  private drainFinishedStages(record: ExecutionRecord, tick: number): void {
    let changed = true;
    while (changed) {
      changed = false;
      if (
        record.stage === "startup" &&
        record.stageElapsedTicks >= record.definition.timing.startupTicks
      ) {
        this.transition(record, "active", tick);
        if (record.definition.cooldown.startsOn === "active") {
          this.startCooldown(record, tick);
        }
        this.executeEffects(record, tick);
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
        this.transition(record, "complete", tick);
        if (record.definition.cooldown.startsOn === "complete") {
          this.startCooldown(record, tick);
        }
        changed = true;
      }
    }
  }

  private executeEffects(record: ExecutionRecord, tick: number): void {
    for (const [effectIndex, effect] of record.definition.effects.entries()) {
      if (record.triggerBudget.remainingEffects === 0) {
        this.publishRejection(record, tick, "trigger-budget-exhausted");
        return;
      }
      record.triggerBudget.remainingEffects -= 1;
      if (effect.kind === "trigger-ability") {
        this.requestWithTriggerState(
          {
            abilityId: effect.abilityId,
            sourceId: record.request.sourceId,
            target: record.request.target,
            requestedAtTick: tick,
          },
          record.triggerBudget,
          record.triggerPath,
        );
        continue;
      }
      const executorId =
        effect.kind === "custom"
          ? effect.executorKind
          : ("core:modify-resource" as ContentId);
      const executor = this.dependencies.executors.get(executorId);
      if (executor === undefined) {
        throw new Error(
          `No ability effect executor is registered for "${executorId}".`,
        );
      }
      executor.execute(effect, this.effectContext(record, effectIndex, tick));
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
      readStat: (statId) => {
        if (record.capturedStats !== undefined) {
          const value = record.capturedStats.get(statId);
          if (value === undefined) {
            throw new Error(
              `Snapshot stat "${statId}" was not declared by "${record.definition.id}".`,
            );
          }
          return value;
        }
        return this.dependencies.stats.read(
          record.request.sourceId,
          statId,
          tick,
        );
      },
    };
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
    this.dependencies.cooldowns.start(
      record.request.sourceId,
      record.definition.id,
      tick,
      record.definition.cooldown.durationTicks,
    );
    record.cooldownStarted = true;
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
      ...(record.capturedStats === undefined
        ? {}
        : { capturedStats: new Map(record.capturedStats) }),
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

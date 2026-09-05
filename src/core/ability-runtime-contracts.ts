import type { ContentId, RuntimeEntityId } from "./ids";
import type { RandomSource } from "./random";

export const CORE_MODIFY_RESOURCE_EXECUTOR_ID =
  "core:modify-resource" as ContentId;

export const ABILITY_STAGES = [
  "request",
  "validate",
  "pay",
  "startup",
  "active",
  "recovery",
  "complete",
  "cancel",
  "reject",
] as const;
export type AbilityStage = (typeof ABILITY_STAGES)[number];

export type AbilityTargetingMode = "self" | "entity" | "point" | "direction";
export type AbilityEntitySelector = "source" | "target";
export type AbilityStatReadPolicy = "snapshot" | "live";
export type CostSettlement = "pay" | "reserve";
export type CostRefundPolicy = "none" | "reserved" | "all";
export type CooldownStartPolicy = "pay" | "active" | "complete";
export type CancellationCooldownPolicy = "retain" | "clear";

export interface AbilityTiming {
  readonly startupTicks: number;
  readonly activeTicks: number;
  readonly recoveryTicks: number;
}

export interface AbilityCost {
  readonly resourceId: ContentId;
  readonly amount: number;
  readonly settlement: CostSettlement;
}

export interface AbilityCooldown {
  readonly durationTicks: number;
  readonly startsOn: CooldownStartPolicy;
}

export interface AbilityCancellation {
  readonly allowedDuring: readonly ("startup" | "active" | "recovery")[];
  readonly refund: CostRefundPolicy;
  readonly cooldown: CancellationCooldownPolicy;
}

export interface AbilityStatCapture {
  readonly subject: AbilityEntitySelector;
  readonly statId: ContentId;
}

export interface AbilityStatRead {
  readonly subject: AbilityEntitySelector;
  readonly statId: ContentId;
  readonly policy: AbilityStatReadPolicy;
}

export interface ModifyResourceEffect {
  readonly kind: "modify-resource";
  readonly resourceId: ContentId;
  readonly amount: number;
  readonly recipient: AbilityEntitySelector;
}

export interface TriggerAbilityEffect {
  readonly kind: "trigger-ability";
  readonly abilityId: ContentId;
}

export interface CustomAbilityEffect {
  readonly kind: "custom";
  readonly executorKind: ContentId;
  readonly parameters: readonly {
    readonly key: string;
    readonly value: string | number | boolean;
  }[];
}

export type AbilityEffect =
  ModifyResourceEffect | TriggerAbilityEffect | CustomAbilityEffect;

export interface AbilityDefinition {
  readonly id: ContentId;
  readonly tags: readonly ContentId[];
  readonly targeting: {
    readonly mode: AbilityTargetingMode;
    readonly range: number;
  };
  readonly timing: AbilityTiming;
  readonly costs: readonly AbilityCost[];
  readonly cooldown: AbilityCooldown;
  readonly cancellation: AbilityCancellation;
  readonly statCaptures: readonly AbilityStatCapture[];
  readonly effects: readonly AbilityEffect[];
}

export type AbilityTarget =
  | { readonly kind: "self" }
  | { readonly kind: "entity"; readonly entityId: RuntimeEntityId }
  | { readonly kind: "point"; readonly x: number; readonly y: number }
  | { readonly kind: "direction"; readonly x: number; readonly y: number };

export interface AbilityRequest {
  readonly abilityId: ContentId;
  readonly sourceId: RuntimeEntityId;
  readonly target: AbilityTarget;
  readonly requestedAtTick: number;
}

export type AbilityRejectionReason =
  | "ability-unknown"
  | "cooldown-active"
  | "executor-unavailable"
  | "insufficient-resource"
  | "reentrant-mutation"
  | "target-invalid"
  | "trigger-budget-exhausted"
  | "trigger-cycle";

export interface AbilityStageTransition {
  readonly stage: AbilityStage;
  readonly tick: number;
}

export interface CapturedAbilityStat {
  readonly subject: AbilityEntitySelector;
  readonly statId: ContentId;
  readonly value: number;
}

export interface AbilityExecutionSnapshot {
  readonly executionId: number;
  readonly abilityId: ContentId;
  readonly sourceId: RuntimeEntityId;
  readonly target: AbilityTarget;
  readonly stage: AbilityStage;
  readonly stageElapsedTicks: number;
  readonly history: readonly AbilityStageTransition[];
  readonly capturedStats: readonly CapturedAbilityStat[];
}

export type AbilityRequestResult =
  | {
      readonly accepted: true;
      readonly execution: AbilityExecutionSnapshot;
    }
  | {
      readonly accepted: false;
      readonly reason: AbilityRejectionReason;
      readonly history: readonly AbilityStageTransition[];
    };

export interface AbilityDefinitionSource {
  get(id: ContentId): AbilityDefinition | undefined;
}

export interface ResourcePaymentHandle {
  readonly kind: "payment";
  readonly token: number;
}

export interface ResourceReservationHandle {
  readonly kind: "reservation";
  readonly token: number;
}

export interface AbilityResourcePort {
  canSpend(
    entityId: RuntimeEntityId,
    resourceId: ContentId,
    amount: number,
  ): boolean;
  pay(
    entityId: RuntimeEntityId,
    resourceId: ContentId,
    amount: number,
  ): ResourcePaymentHandle;
  reserve(
    entityId: RuntimeEntityId,
    resourceId: ContentId,
    amount: number,
  ): ResourceReservationHandle;
  refund(handle: ResourcePaymentHandle): void;
  commit(handle: ResourceReservationHandle): void;
  release(handle: ResourceReservationHandle): void;
}

export interface AbilityCooldownHandle {
  readonly token: number;
  readonly entityId: RuntimeEntityId;
  readonly abilityId: ContentId;
}

export interface AbilityCooldownPort {
  remainingTicks(
    entityId: RuntimeEntityId,
    abilityId: ContentId,
    atTick: number,
  ): number;
  start(
    entityId: RuntimeEntityId,
    abilityId: ContentId,
    atTick: number,
    durationTicks: number,
  ): AbilityCooldownHandle;
  clear(handle: AbilityCooldownHandle): boolean;
}

export interface AbilityStatPort {
  read(entityId: RuntimeEntityId, statId: ContentId, atTick: number): number;
}

export interface AbilityTargetValidator {
  validate(request: AbilityRequest, definition: AbilityDefinition): boolean;
}

export interface AbilityEffectContext {
  readonly executionId: number;
  readonly ability: AbilityDefinition;
  readonly effectIndex: number;
  readonly sourceId: RuntimeEntityId;
  readonly target: AbilityTarget;
  readonly tick: number;
  readonly random: RandomSource;
  entity(subject: AbilityEntitySelector): RuntimeEntityId;
  readStat(read: AbilityStatRead): number;
}

export interface AbilityEffectExecutor<
  T extends AbilityEffect = AbilityEffect,
> {
  execute(effect: T, context: AbilityEffectContext): void;
}

export interface AbilityExecutorRegistry {
  has(kind: ContentId): boolean;
  get(kind: ContentId): AbilityEffectExecutor | undefined;
}

export interface AbilityExecutionEvent {
  readonly executionId: number;
  readonly abilityId: ContentId;
  readonly stage: AbilityStage;
  readonly tick: number;
  readonly reason?: AbilityRejectionReason;
}

export interface AbilityExecutionEventSink {
  publish(event: AbilityExecutionEvent): void;
}

export interface TriggerLimits {
  readonly maximumDepth: number;
  readonly maximumEffectsPerTick: number;
}

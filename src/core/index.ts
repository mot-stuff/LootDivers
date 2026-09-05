export const FOUNDATION_ID = "rarpg:browser-foundation";

export * from "./ability-runtime-contracts";
export {
  ABILITY_DAMAGE_EXECUTOR_ID,
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  COMBAT_ABILITY_DEFINITIONS,
  DEFIANT_SIGNAL_ID,
  MANA_RESOURCE_ID,
  MOVE_SPEED_STAT_ID,
  OUTGOING_DAMAGE_STAT_ID,
  RefreshingStatusStore,
  WINTER_PULSE_ID,
  damageAfterModifier,
  definitionById,
  pointInArea,
  sweptCircleHitFraction,
  targetMatches,
  type CombatAbilityId,
  type CombatAbilityDefinition,
  type CombatAbilityEffect,
  type CombatEffectParameter,
  type CombatEffectParameters,
  type CombatStatusId,
  type StatusInstance,
} from "./combat-abilities";
export {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  type AttackPhase,
  type CombatArenaConfig,
  type CombatArenaDiagnostics,
  type CombatArenaEvent,
  type CombatArenaEventReader,
  type CombatAbilityActivationKind,
  type CombatAbilityActivationReadModel,
  type CombatAreaFeedbackReadModel,
  type CombatProjectileReadModel,
  type CombatTargetReadModel,
} from "./combat-arena";
export {
  HealthPool,
  type Damageable,
  type DamageIgnoreReason,
  type DamageRequest,
  type DamageResult,
  type HealthReadModel,
} from "./health";
export {
  SimpleMeleeEnemy,
  type MeleeEnemyState,
  type MeleeEnemyTarget,
  type PlayerDamageApplicator,
  type SimpleMeleeEnemyConfig,
  type SimpleMeleeEnemyDiagnostics,
} from "./simple-melee-enemy";
export {
  AbilityExecutionEngine,
  type AbilityExecutionDependencies,
} from "./ability-runtime";
export type { Clock } from "./clock";
export {
  createCoreRuntime,
  type CoreDependencies,
  type CoreRuntime,
  type SimulationStepContext,
  type SimulationSystem,
} from "./composition";
export {
  FIXED_STEP_MILLISECONDS,
  FIXED_STEP_SECONDS,
  FIXED_TICKS_PER_SECOND,
  FixedStepRunner,
  type AdvanceResult,
  type FixedStep,
  type FixedStepCallback,
  type FixedStepRunnerOptions,
} from "./fixed-step";
export {
  contentId,
  persistentInstanceId,
  SequentialRuntimeEntityIds,
  type ContentId,
  type PersistentInstanceId,
  type RuntimeEntityId,
  type RuntimeEntityIdSource,
} from "./ids";
export {
  PresentationComponentStore,
  PresentationKind,
  TECHNICAL_UPDATE_ORDER,
  TechnicalEntityLifecycle,
  TransformComponentStore,
  type EntityLifecycleDiagnostics,
  type TechnicalUpdateStage,
  type TransformWrite,
} from "./entity-lifecycle";
export type {
  CommandEnvelope,
  CommandSource,
  CommandsFrom,
  EventEnvelope,
  EventSink,
  EventsFrom,
} from "./messages";
export type { IntentSink, ReadModelSource } from "./ui-boundary";
export {
  MULBERRY32_ALGORITHM,
  Mulberry32,
  type RandomSource,
  type RandomState,
  type StatefulRandomSource,
} from "./random";
export {
  BLOCKED_NAVIGATION_COST,
  MAXIMUM_NAVIGATION_COST,
  MINIMUM_NAVIGATION_COST,
  NavigationGrid,
  type CompiledNavigationGridData,
  type GridPoint,
} from "./navigation-grid";
export {
  BoundedAStar,
  createPathResult,
  PathBuffer,
  type PathResult,
  type PathStatus,
} from "./pathfinding";
export {
  FairPathRequestScheduler,
  type PathCompletionSink,
  type PathRequest,
  type PathRequestRejection,
  type PathSchedulerOptions,
  type PathSchedulerTickResult,
} from "./path-scheduler";
export { computeLocalSeparation, type MutableVector2 } from "./separation";
export {
  aabbsOverlap,
  circleIntersectsAabb,
  circlesOverlap,
  segmentIntersectsAabb,
  segmentIntersectsCircle,
  SpatialQueryBuffer,
  UniformSpatialHash,
  type Aabb,
  type Circle,
  type MutableCircleQuery,
  type MutableSegmentQuery,
  type Point2,
  type Segment,
  type SpatialAllocationDiagnostics,
  type SpatialRecord,
} from "./spatial";
export {
  FIXTURE_STAGE_SAMPLE_CAPACITY,
  SYNTHETIC_ACTOR_COUNT,
  SYNTHETIC_CAMERA_HEIGHT,
  SYNTHETIC_CAMERA_WIDTH,
  SYNTHETIC_ENTITY_COUNT,
  SYNTHETIC_FIXTURE_SCHEMA,
  SYNTHETIC_FIXTURE_SEED,
  SYNTHETIC_LOOT_COUNT,
  SYNTHETIC_PARTICLE_COUNT,
  SYNTHETIC_PROJECTILE_COUNT,
  SYNTHETIC_WORLD_SIZE,
  SyntheticLifecycleFixture,
  type FixturePathDiagnostics,
  type FixtureStageSampleSummary,
  type FixtureStageTimings,
  type FixtureTimer,
  type RawFixtureStageSamples,
  type SyntheticFixtureDiagnostics,
  type TimingSampleSummary,
} from "./synthetic-lifecycle-fixture";

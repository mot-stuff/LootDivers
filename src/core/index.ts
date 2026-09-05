export const FOUNDATION_ID = "rarpg:browser-foundation";

export * from "./ability-runtime-contracts";
export {
  CombatArenaSimulation,
  DEFAULT_COMBAT_ARENA_CONFIG,
  type CombatArenaConfig,
  type CombatArenaDiagnostics,
} from "./combat-arena";
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

# Spatial, Collision, and Navigation Primitives

TASK-P0-007 implements the framework-free technical primitives required by
DEC-009, DEC-010, and DEC-012. It does not implement movement, enemy behavior,
combat hit rules, or a physics simulation.

## Spatial and collision contracts

`src/core/spatial.ts` provides a uniform spatial hash for numeric runtime IDs.
Records have one integer elevation and one AABB. Queries require an exact
elevation and write deduplicated candidates into a caller-owned
`SpatialQueryBuffer`; callers should retain one buffer per concurrent query
owner instead of allocating arrays per simulation step.

The hash supports AABB, circle, and padded swept-segment candidate queries.
Simple narrow-phase helpers cover circle/circle, AABB/AABB, circle/AABB,
segment/circle, and segment/AABB intersections. Touching boundaries count as
intersections. The primitives report geometry only and define no damage, hit,
response, mass, velocity, or physics policy.

`upsert` mutates an existing record without replacing it while its occupied hash
cells are unchanged. Crossing a hash-cell boundary updates only the affected
bucket membership. Query buffers and synthetic-agent records are reused.

## Compiled navigation grid

`fixtures/world/technical-navigation.json` is a concise technical source for the
deterministic 128×128 grid. `npm run world:compile` emits
`public/zones/technical-navigation.grid.json`; `world:check` compiles twice and
checks byte identity and committed freshness for both the P0-006 zone and this
grid.

The compiler validates bounds, costs from 0 through 255, signed 16-bit discrete
elevation, fixture IDs, exact metadata, and compatibility with the P0-006 zone
bundle version. Cost zero is blocked. Runtime construction verifies the source
zone ID before exposing the framework-free `NavigationGrid`; neither core
navigation nor the compiler adapter imports Phaser.

The grid intentionally has no elevation transitions. A path start and goal must
be walkable and have the same requested elevation, and every traversed cell must
match it. Ramps, portals, stacked floors, dynamic overlays, and navmesh rebakes
remain outside this task.

## Bounded pathfinding and scheduling

`BoundedAStar` uses deterministic four-neighbor expansion with cost-aware
Manhattan ordering and stable index tie-breaking. Each call receives a positive
node-expansion cap and a reusable `PathBuffer`. Outcomes are `complete`,
`no-path`, `budget-exhausted`, or `invalid`, with exact expansion and cost
diagnostics.

`FairPathRequestScheduler` is a bounded FIFO queue. It permits at most one
pending request per requester, rejects queue overflow, and enforces explicit
per-request, per-tick request-count, and per-tick expansion budgets. A completion
sink consumes the shared path buffer synchronously. Systems that need to retain
a path must copy it into their own bounded storage. The scheduler never polls or
loops independently per agent.

Local separation performs one same-elevation radius query, visits candidates in
stable runtime-ID order, and writes a capped vector to caller-owned storage. It
is a steering input only; it does not move actors or resolve penetrations.

## Deterministic timing harness

Run:

```powershell
& $npm run timing:navigation -- --output=reports/TASK-P0-007/local.json
```

Each of five fresh repetitions uses P0-002 seed `0x5EED2008`, warms up for
1,800 unmeasured steps, and samples 7,200 steps. Every 60 Hz step executes 200
technical-agent radius queries and 500 swept-segment queries, with one bounded
path request every three steps (20 requests per second). The report uses
nearest-rank p50/p95, includes per-repetition and pooled timings, and verifies
that candidate totals, path outcomes, expansions, and checksum match across all
five repetitions. It also records fixture hash, commit, dirty state, and machine
metadata.

Current-machine and Node harness timings are always `INELIGIBLE`: they are
diagnostic and are not browser acceptance. TASK-P0-008 owns the complete
P0-002 browser population/presentation fixture. Real Safari remains
`NOT RUN — hardware unavailable`.

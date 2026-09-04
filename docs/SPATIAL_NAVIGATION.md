# Spatial, Collision, and Navigation Primitives

TASK-P0-007 implements the framework-free technical primitives required by
DEC-009, DEC-010, and DEC-012. It does not implement movement, enemy behavior,
combat hit rules, or a physics simulation.

## Spatial and collision contracts

`src/core/spatial.ts` provides a uniform spatial hash for numeric runtime IDs.
Records have one integer elevation and one AABB. Queries require an exact
elevation and write deduplicated candidates into a caller-owned
fixed-capacity `SpatialQueryBuffer`. Callers choose capacity up front and retain
one buffer per concurrent query owner. Overflow throws with a stable diagnostic;
the query never silently grows its result array.

The hash supports AABB, circle, and padded swept-segment candidate queries.
Simple narrow-phase helpers cover circle/circle, AABB/AABB, circle/AABB,
segment/circle, and segment/AABB intersections. Touching boundaries count as
intersections. The primitives report geometry only and define no damage, hit,
response, mass, velocity, or physics policy.

Circle and segment calls use caller-owned mutable query specifications. Hash
cells use collision-free numeric keys for signed cell coordinates in the
documented ±33,554,432-cell range; queries do not build strings or temporary
bounds. Candidate slots contain references to persistent spatial records and
are insertion-sorted by numeric ID without `Array.sort`.

The precise steady-state guarantee is limited to project-authored storage:
after construction/reservation, `queryAabb`, `queryCircle`, `querySegment`, and
`computeLocalSeparation` create no project objects, arrays, strings, closures,
or result records and do not resize caller buffers. This is not a claim that a
JavaScript engine performs zero internal allocation or garbage collection.
Generation rollover maintenance occurs once per 2^32 queries and is outside the
normal fixture sample.

`upsert` mutates persistent records. New hash buckets and capacity expansions
are known structural allocations and are counted separately. The fixture
reserves its complete cell range and bucket capacity before warm-up. Every
timed repetition fails its allocation contract if a bucket is created, a bucket
or record-cell capacity expands, a query buffer overflows, or a result-array
identity changes after warm-up. The diagnostic deliberately makes no JS heap
claim. Bounded A* request/path objects are outside this spatial-query guarantee.

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

For retained evidence, also pass
`--raw-output=reports/TASK-P0-007/local.raw.json`. The summary records the raw
artifact path, byte count, SHA-256, and all 108,000 stage samples.

Each of five fresh repetitions uses P0-002 seed `0x5EED2008`, warms up for
1,800 unmeasured steps, and samples 7,200 steps. Every 60 Hz step executes 200
technical-agent radius queries and 500 swept-segment queries, with one bounded
path request every three steps (20 requests per second). The report uses
nearest-rank p50/p95, includes per-repetition and pooled timings, and verifies
that candidate totals, path outcomes, expansions, and checksum match across all
five repetitions. It also records fixture hash, commit, dirty state, and machine
metadata.

Evidence metadata includes exact Git commit and dirty output, available
Windows/CPU/RAM/GPU/driver/display/power/browser/network/process details,
tool and Playwright versions/install inventory, and a labeled headless DPR/WebGL
probe. Unavailable scaling, screenshots, branded graphics pages, temperatures,
or other fields remain explicit null/NOT RUN values.

Current-machine and Node harness timings are always `INELIGIBLE`: they are
diagnostic and are not browser acceptance. TASK-P0-008 owns the complete
P0-002 browser population/presentation fixture. Real Safari remains
`NOT RUN — hardware unavailable`.

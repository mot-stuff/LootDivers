# TASK-P0-008 Entity and Presentation Lifecycle

**Status:** Implemented as technical Phase 0 infrastructure

**Decision basis:** DEC-010 and the P0-002 fixture contract; no new ADR required

## Boundaries

`src/core/entity-lifecycle.ts` owns opaque runtime IDs, fixed-capacity typed
transform/presentation metadata stores, and complete component cleanup.
`src/core/synthetic-lifecycle-fixture.ts` owns only deterministic technical
records. Phaser objects never carry authoritative coordinates, lifetimes,
velocities, waypoints, or entity state.

The declared technical update order is:

1. snapshot transforms;
2. advance seeded closed actor waypoints;
3. wrap projectile records;
4. recycle fixed-pool cosmetic particle records;
5. rebuild/query the shared spatial index after record movement;
6. issue/process bounded path requests;
7. clean pending entities;
8. publish diagnostics.

This is intentionally not a general ECS. The fixture has two explicit component
stores and dedicated fixed-capacity arrays for measured populations.

## P0-002 fixture

Open `/?automation=1&fullFixture=1`. The fixture uses seed `0x5EED2008` and
contains:

- 128×128 synthetic isometric terrain, four populated layers and a deterministic
  10% foreground pattern;
- a 30-second closed camera path with a 1920×1080 logical viewport;
- 200 technical waypoint actors with four directions and eight frames;
- 500 wrapping projectiles;
- 1,000 recycling cosmetic particles;
- 100 foot-sorted loot visuals;
- 200 radius and 500 swept-segment queries per simulation step;
- one 2,048-expansion-capped A* request every three 60 Hz steps.

The technical presentation plane repeats around the moving camera while the
authoritative records retain their documented movement. This projects each
record into the camera's nearest repeated cell, so the required 200 actor, 500
projectile, 1,000 particle, and 100 loot presentations are all visibly rendered
throughout the moving-camera sample. Diagnostics expose visible and culled
counts per kind. A test-only culling probe moves one actor presentation outside
the camera bounds, proves it is culled without changing authoritative
populations, and restores the exact visible contract before timing.

The committed synthetic atlas is `public/assets/technical-entities.svg`.
Presentation pools have fixed capacities, explicit acquire/release ownership,
high-water and exhaustion diagnostics, interpolation, and culling. Per-entity
destruction releases the mapped Phaser image before a replacement ID acquires a
slot. Phaser objects contain no authoritative state.

The browser adapter uses the established `FixedStepRunner`. Reports separate
warm-up and sample steps/callbacks, catch-up and discarded time, visibility and
focus invalidation, exact query/path rates, and every P0-002 threshold. The six
named timing stages are `simulation`, `spatial`, `pathfinding`, `presentation`,
`renderSubmission`, and `combined`. Raw values and p95/maximum summaries are
retained in preallocated buffers: 10,000 fixed-step samples and 20,000 browser
callback samples. Overflow invalidates the corresponding gate. The overall
state remains `INELIGIBLE` on the current machine, while each hypothetical
threshold is still reported as `PASS` or `FAIL`.

Simulation-step validity is derived from measured warm-up/sample duration.
The bounded tolerance is six 60 Hz steps (100 ms), matching the separate
maximum-frame-interval validity ceiling. Callback minimums, callback-to-stage
sample accounting, zero dropped time, duration, focus/visibility stability, and
the 100 ms ceiling remain independent failure checks, so the tolerance only
prevents a delayed wall-clock timer callback from falsely imposing exactly
7,200 steps.

The project-authored fixture reuses query specifications, bounds, transform
storage, fixed-step records, projection output, and fixed-capacity frame sample
buffers in routine hot loops. This is not a claim that Phaser, browser engines,
`Map`, or JavaScript runtimes perform zero internal allocation. Heap trend is
reported only where the browser exposes `performance.memory`.

## Verification

Run the pinned toolchain from `TOOLING.md`, then:

```powershell
& $npm run format:check
& $npm run lint
& $npm run typecheck
& $npm test
& $npm run content:check
& $npm run world:check
& $npm run build
& $npm run budget
& $npm run budget:world
& $npm run budget:fixture
& $npm run test:smoke
& $npm run test:browser
& $npm run test:visual
& $npm run timing:fixture
```

`timing:fixture` defaults to the P0-002 30-second warm-up and 120-second sample.
Optional shorter diagnostics use `-- --warmup-seconds=2 --sample-seconds=10`.
Reports are always `INELIGIBLE` on the currently recorded machine and must not
be described as strict performance acceptance. The current command collects one
diagnostic repetition; a strict acceptance session still requires five fresh
browser processes, the controlled conditions in P0-002, and eligible hardware.

Evidence is generated only after committing implementation and building that
clean commit. The JSON names that implementation hash as
`provenance.testedImplementationCommit`; the generated JSON and fixture budget
may then be committed in one follow-up evidence-only commit. The evidence
commit does not alter eligibility, and branded-browser availability is reported
separately from code/test failures.

## Scope exclusions

There is no player/enemy identity, input-driven movement, AI, attack, damage,
drop generation, balance, gameplay item, production art, networking, or Phase 1
behavior. Real Safari remains `NOT RUN — hardware unavailable`.

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
5. update/query the shared spatial index;
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

The committed synthetic atlas is
`public/assets/technical-entities.svg`. Presentation pools are allocated once,
interpolate previous/current transforms, and cull outside the camera margin.
Diagnostics report populations, simulation steps, camera phase, visible/culled
counts, pools, path/query work, structural allocations, stage timings, frame
samples, heap/draw calls when exposed, and lifecycle ownership.

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

## Scope exclusions

There is no player/enemy identity, input-driven movement, AI, attack, damage,
drop generation, balance, gameplay item, production art, networking, or Phase 1
behavior. Real Safari remains `NOT RUN — hardware unavailable`.

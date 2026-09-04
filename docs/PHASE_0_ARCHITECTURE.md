# RARPG Phase 0 Architecture

**Status:** Phase 0 architecture direction approved by the project owner on
2026-09-04; Phase 1 remains blocked on the Phase 0 acceptance gate
**Date:** 2026-09-04
**Scope:** Browser-first technical foundation only. This document does not authorize Phase 1 or gameplay implementation.

## Executive recommendation

Build RARPG as a browser-native TypeScript application using **Phaser 4.2.1**
as the runtime framework and WebGL renderer. Keep game rules in framework-free,
strict TypeScript modules; use Phaser at the adapter/presentation boundary for
rendering, input, cameras, loading, and audio. Use Preact and ordinary HTML/CSS
for menus and information-heavy UI over the game canvas. Author isometric zones
in Tiled and compile them into validated, versioned zone bundles.

This is deliberately not a custom engine. The project will own only the
ARPG-specific pieces that a general framework cannot provide well: a fixed-step
simulation, lightweight component stores, spatial queries and collision,
grid-based navigation, isometric world conventions, typed ability execution,
content compilation, and persistence boundaries.

WebGL2 is the production baseline. WebGPU is a later measured optimization, not
a vertical-slice dependency. The stack must pass Phase 0 browser, isometric
correctness, loading, context-loss, and synthetic population gates before Phase
1 can begin.

## 1. Requirements analysis

### Product constraints

- The browser is the primary runtime, not an export target. The vertical slice
  must run without installation in current desktop Chrome, Edge, and Firefox.
  Safari is a compatibility target where practical; mobile is out of scope.
- Presentation is fundamentally 2D pseudo-isometric: layered terrain, sprites,
  foot-point depth, elevation bands, foreground occlusion, particles,
  telegraphs, ground effects, and readable combat text.
- Combat requires independent WASD movement and mouse aim, low input latency,
  explicit startup/active/recovery timing, interruption, dodge, dense enemies,
  projectiles, effects, statuses, and loot.
- The vertical slice must eventually support one town, one wilderness zone, one
  dungeon, and one boss arena without requiring a seamless world.
- Items, affixes, abilities, enemies, loot, professions, recipes, and encounters
  must be data-driven and cross-referenceable by stable IDs.
- Early saves may be local, but valuable future progression must be owned or
  validated by a trusted server. The browser client is always untrusted.
- Cursor agents need text-first source, command-line builds, deterministic tests,
  browser automation, useful logs, clear contracts, and small reviewable tasks.

### Browser implications

- Startup transfer, parse/compile time, GPU memory, tab suspension, audio
  unlock, pointer focus, resize/fullscreen, WebGL context loss, storage eviction,
  and cache invalidation are architecture concerns.
- A large engine WebAssembly payload and editor-centric workflow impose costs
  before game assets are loaded. A browser-native ESM stack gives finer code and
  asset chunking, direct browser debugging, DOM UI, and straightforward CDN
  deployment.
- Simulation must not use wall-clock time or rendering frame count as game time.
  A fixed step, bounded catch-up, injectable clock, and seeded random source are
  required for stable behavior and tests. Background tabs pause simulation;
  they do not attempt to replay an unbounded backlog on resume.
- Browser persistence is best-effort and origin-scoped. Local saves need
  transaction failure handling, migrations, backup records, export/import, and
  an explicit path to server persistence.

### Provisional Phase 0 quality gates

These are engineering gates, not final product promises. TASK-P0-002 must record
the exact hardware and may revise thresholds with Director approval.

- Correct startup and a deterministic smoke scene in current Chromium/Chrome,
  Edge, and Firefox at 1920x1080; a WebKit run detects likely Safari regressions.
- 60 Hz simulation with no unbounded catch-up after a hidden/resumed tab.
- A representative synthetic scene sustains 60 FPS on the agreed reference
  desktop in Chrome and Firefox, with p95 main-thread frame time at or below
  16.7 ms after warm-up. Report results rather than hiding slow frames.
- Synthetic gate contents: layered isometric terrain, 200 moving actor visuals,
  500 projectiles, 1,000 lightweight particles, 100 loot visuals, spatial
  queries, and periodic path requests. These numbers validate headroom; they are
  not promised encounter counts.
- Initial application shell JavaScript, CSS, and framework transfer budget:
  1 MiB Brotli excluding zone/game assets. The exact result and exceptions must
  be recorded. Zone bundles load on demand.
- A forced WebGL context loss/restoration produces a recoverable state or a
  clear reload flow without corrupting the save.

## 2. Engine and framework comparison

### Phaser 4.2.1

Phaser is a browser-native 2D game framework with scenes, WebGL rendering,
tilemaps including isometric orientation, camera culling, unified input, asset
loading, audio, tweens, and optional simple physics. Phaser 4.2.1 is the current
stable patch as of this decision and is available through npm.

For RARPG, Phaser removes substantial commodity engine work while retaining
normal TypeScript, ESM, DOM integration, browser developer tools, and static
hosting. Its scene ownership model can encourage framework-coupled logic, so
Phaser scenes and game objects must remain adapters over the simulation rather
than authoritative entities. Phaser 4 is also young; lock the patch version and
require focused regression/performance gates before upgrades.

**Fit:** Best overall balance, subject to Phase 0 gates.

### PixiJS 8 plus a custom browser runtime

PixiJS is a strong, production-oriented 2D renderer. Its stable production
renderer is WebGL, its WebGPU renderer remains experimental, and its
ParticleContainer provides an efficient route for high-count lightweight
visuals. It offers excellent rendering control and a smaller conceptual surface
than a game framework.

It does not provide the complete game runtime RARPG needs. The project would own
input mapping, cameras, audio lifecycle, asset orchestration, tilemap ingestion
and culling, scene/zone lifecycle, collision, navigation, and more integration
code. RARPG already needs custom simulation and spatial systems, but rebuilding
all commodity browser-game services adds Phase 0 risk without a demonstrated
Phaser blocker.

**Fit:** Strong fallback if Phaser's isometric batching, extensibility, bundle,
or performance gates fail. Not the initial choice.

### Browser-native TypeScript with raw Canvas/WebGL/WebGPU

A narrowly scoped custom renderer could optimize exactly for isometric tiles and
ARPG sprite streams. It would also make RARPG responsible for atlas management,
batching, shaders, masks, render targets, context restoration, text, particles,
camera transforms, asset lifecycle, and cross-browser GPU defects. Canvas 2D is
not a credible primary renderer for the target effects and density. WebGPU is
valuable for future specialized workloads but is unnecessary for the first
slice and raises fallback/testing cost.

**Fit:** Inappropriate as the starting renderer. Custom simulation and content
systems are appropriate; a custom graphics engine is not.

### Babylon.js or Three.js

Both are capable browser-native 3D/WebGL/WebGPU foundations. Babylon provides
sprite managers and SpriteMap; Three provides sprites, meshes, and programmable
rendering. They are compelling if RARPG adopts true 3D terrain, 3D lighting, or a
2.5D camera as a core art requirement.

RARPG currently requires fundamentally 2D isometric rendering. These libraries
would shift world authoring, tilemap handling, ordering, sprite animation, and
2D collision toward project-owned systems while carrying a 3D scene abstraction
the game does not need. Three's high-count instanced Sprite support is tied to
its WebGPU renderer, and Babylon's grid SpriteMap has static-grid constraints.

**Fit:** Do not use unless the approved visual direction changes to material
true 3D/2.5D requirements.

### Godot 4 web export

Godot provides a mature visual editor and useful 2D systems. However, the stale
Godot 4.7.2 .NET recommendation cannot meet the product requirement: Godot's
official documentation states that Godot 4 C# projects cannot export to the web.
Switching to GDScript removes that hard blocker but retains a comparatively
large engine/Wasm bootstrap, engine export and hosting constraints, less direct
DOM integration, and an editor-centric content workflow. Browser deployment
would still be an export of a general engine rather than the native development
target.

**Fit:** Rejected for RARPG's current requirements. Godot .NET is incompatible;
Godot GDScript does not offset its browser-first costs.

### Unity Web

Unity offers mature editor tooling, profiling, effects, and a large ecosystem.
Its web build compiles a substantial engine/application to WebAssembly and has
web-specific limitations. Official Unity documentation notes that standard C#
is single-threaded on Web, garbage collection occurs at frame end, native socket
APIs are unavailable, and threaded builds require cross-origin isolation
headers. Asset caching and web deployment require Unity-specific handling.

For a fundamentally 2D browser-first game, those startup, iteration, hosting,
and agent-automation costs are not justified by current requirements.

**Fit:** Rejected unless future measured needs require Unity-only tooling and
the browser delivery costs are explicitly accepted.

### Decision summary

1. Select Phaser 4.2.1 plus strict TypeScript.
2. Keep PixiJS 8 as the named fallback, triggered only by a documented hard
   Phaser gate failure.
3. Do not introduce 3D engines, WebGPU dependence, Wasm desktop-engine exports,
   or a raw custom renderer without a new architecture decision.

## 3. Recommended stack

- **Language:** TypeScript in strict mode; no implicit `any`, framework types do
  not cross core domain boundaries.
- **Runtime/framework/renderer:** Phaser 4.2.1, pinned exactly, using WebGL2.
  Perform a WebGL2 preflight before Phaser boot, assert and expose the created
  context version in diagnostics, and present an actionable unsupported-browser
  message if WebGL2 initialization fails. Phaser's generic WebGL renderer
  selection is not itself proof that WebGL2 was obtained. Do not maintain a
  Canvas gameplay renderer.
- **Simulation:** project-owned fixed-step TypeScript core with explicit
  commands/events, seeded PRNG, injectable clock, and no DOM/Phaser imports.
- **Collision:** project-owned 2D circles/AABBs/segments over a uniform spatial
  hash and zone collision grid. Do not use Matter. Phaser Arcade Physics may be
  evaluated only as a benchmark comparison, not mixed into authoritative rules.
- **Navigation:** walkability/cost grid compiled from map data; bounded A* for
  individual requests, path-request scheduling, direct steering, and local
  separation. Flow fields or workers require measured need and a later decision.
- **World authoring:** Tiled isometric maps plus project-owned validation and
  compilation into versioned zone bundles.
- **UI:** Preact with HTML/CSS for HUD, menus, inventory, tooltips, settings,
  loading, and accessibility; Phaser canvas for world-space visuals. UI consumes
  read models and emits intents, never owning gameplay state.
- **Content:** UTF-8 JSON authored against versioned JSON Schema, semantic
  validation with Ajv, stable namespaced IDs, generated TypeScript types where
  practical, and a compiled content manifest.
- **Persistence:** versioned snapshots in IndexedDB through a project-owned
  repository interface; migrations, checksum, backup generation, export/import,
  quota/eviction handling, and future server adapter boundary.
- **Build/package tooling:** active Node.js LTS, npm with committed lockfile,
  `npm ci` in automation, Vite, `tsc --noEmit`, ESLint, and Prettier. Exact
  versions are pinned by the approved toolchain task.
- **Testing:** Vitest for core and content tests, Vitest Browser Mode only where
  a real DOM/browser unit test adds value, and Playwright for startup, input,
  persistence, resize, browser lifecycle, and end-to-end smoke tests.
- **CI/deployment:** provider-neutral immutable static artifact, CI validation,
  browser smoke tests, preview/staging deployment, then a protected production
  promotion. Choose the hosting vendor in TASK-P0-013 based on headers, preview
  environments, CDN/cache controls, cost, and rollback.

Backend language, database, authentication provider, analytics, and multiplayer
transport remain undecided because Phase 0 does not require them.

## 4. Rendering approach

### Coordinates and frame loop

The authoritative simulation uses Cartesian world coordinates in logical units.
Projection into isometric screen space is a render concern. A single documented
projection convention, tile footprint, origin, foot anchor, and elevation unit
must be shared by map compilation, picking, collision overlays, and rendering.

Run game rules at a fixed 60 Hz. Sample browser input into intent/command state,
execute zero or more bounded simulation steps, then render once with interpolation
where useful. Clamp elapsed time and discard excess backlog after suspension.

### Layering and depth

Render each zone in ordered bands:

1. ground and decals below actors;
2. low terrain and ground effects;
3. one elevation-aware foot-point sort containing actor bases, projectiles,
   interactables, loot, and the base portions of tall props;
4. overhang portions of tall props and elevation-aware occluders;
5. foreground roofs/canopies with authored fade or mask rules;
6. world-space feedback such as telegraphs and combat text.

Static tile layers use Phaser tilemap culling and atlas textures. Dynamic
objects use a stable depth key based primarily on elevation band and foot-point
screen Y, with an explicit tie-breaker. Do not sort by sprite center. Batch
changes by atlas/material where this does not violate depth; profile sort and
draw-call costs in the representative scene.

Characters use sprite atlases with direction/state animation metadata. Pool
short-lived projectile, decal, particle, and combat-text presentations. Cap or
degrade cosmetic effects before gameplay entities. Culling and lifetime
policies are mandatory for high-count presentation types.

WebGL context loss must pause presentation, preserve domain state, and either
recreate resources through Phaser's supported lifecycle or show a controlled
reload prompt. Test loss with `WEBGL_lose_context`.

WebGPU, dynamic normal-mapped lighting, skeletal animation middleware, and true
3D objects are out of scope until visual prototypes and browser measurements
justify them.

## 5. World and tilemap approach

- Use segmented zones: town, wilderness, dungeon, and arena are separately
  loadable units. This bounds memory, navigation, persistence, and iteration.
- Tiled is the authoring source. A build step validates map orientation, tile
  size, tileset references, object-layer schemas, collision, elevation,
  occlusion, spawn markers, navigation costs, portals, and stable object IDs.
- Runtime consumes compiled zone bundles, not arbitrary editor JSON. A bundle
  contains metadata/version, layer chunks, tileset/atlas references, collision
  cells, navigation costs, object placements, occluders, portal links, and a
  content-hash identity.
- Chunk large visual layers for culling and selective creation. Do not equate a
  visual tile with a collision body or runtime entity.
- Collision is represented as coarse blocked/cost cells plus optional simple
  authored primitives for precise boundaries. Navigation uses the compiled
  walkability grid; runtime changes apply bounded overlays rather than rebaking.
- Elevation is discrete for the first slice. Bridges, ramps, and stacked
  walkable floors require explicit portal/transition metadata and must pass
  projection, collision, ordering, and navigation validation.
- Semi-procedural dungeons may later assemble authored room modules from a
  seeded room graph. Phase 0 defines bundle/socket contracts only; generation
  and procedural worlds are out of scope.
- Zone transitions unload presentation assets, retain only persistent records,
  and load a manifest-declared dependency set. The initial shell and current
  zone must not force download of every future zone.

## 6. Entity architecture

Do not adopt a general-purpose ECS package or make Phaser game objects
authoritative. Use an explicit composition-oriented simulation:

- opaque numeric runtime entity IDs, never persisted;
- stable instance IDs only for persistent/generated objects;
- typed component stores for state such as transform, health, resources, combat
  stats, collider, movement, faction, cooldowns, statuses, and lifetime;
- narrow systems with declared read/write sets and a documented update order;
- commands for requested actions and domain events for completed facts;
- presentation registry mapping entity IDs to pooled Phaser objects;
- immutable definition data referenced by stable content IDs;
- dedicated dense arrays/pools for projectiles, particles, and other measured
  hot paths rather than forcing every object through one abstraction.

The initial update order is: ingest commands, advance timers/statuses, resolve
movement intent, navigation/steering, collision, abilities, projectiles/hits,
damage/death, drops/interactions, cleanup, publish read models/events. Combat
engineers may refine the order only through a recorded contract change.

Avoid hidden service locators and global mutable singletons. A composition root
constructs services and passes explicit interfaces. Phaser scenes coordinate
zone lifecycle and adapters; they do not become giant gameplay managers.

Future multiplayer remains possible because inputs, simulation rules, snapshots,
and events have boundaries, but Phase 0 does not promise determinism across
machines, rollback, lockstep, or networking.

## 7. Ability-system approach

Abilities are typed definitions interpreted by an explicit execution pipeline,
not scripts embedded in JSON and not one bespoke class per ability.

An ability definition can include stable ID/version, tags, input slot, targeting
mode, range/shape, timing phases, movement/turn constraints, costs, cooldown,
charges, animation/VFX/SFX cues, ordered effect specifications, and cancellation
rules. Shared effect kinds begin narrowly: deal damage, heal, move/impulse,
spawn projectile, create area, apply/remove status, and modify resource.

Execution stages are request, validate target/state, reserve or pay costs,
startup, active execution, recovery, completion/cancel, and cooldown policy.
Each execution receives an explicit context containing source, target/point,
definition, captured stats according to policy, seeded random source, and event
sink. Snapshot-versus-live stats, hit-once rules, interruption, refund behavior,
and trigger ordering must be explicit.

Tags and stats use central registries validated at build time. Trigger depth and
per-tick event budgets prevent cycles and runaway combinations. Truly novel
mechanics use code-defined executors registered by a stable kind; content cannot
name arbitrary modules or execute code.

Phase 0 defines schemas, contracts, and deterministic contract tests only. It
does not implement player attacks, enemies, damage balance, or the Phase 1
combat prototype.

## 8. Data and content architecture

Canonical domain content is versioned JSON grouped by bounded category:
abilities, statuses, item bases, affixes, enemies, loot tables, progression,
professions, recipes, encounters, and zone metadata.

- Every definition has a namespaced stable ID such as `core:iron_sword`; display
  names are localization keys and are not identity.
- JSON Schema checks shape. Ajv compiles schemas for tooling. Project semantic
  validators check references, tag/stat names, ranges, duplicate IDs, affix
  eligibility, loot cycles, recipe inputs, and asset keys.
- TypeScript runtime types are generated from or checked against canonical
  schemas; schema and runtime type drift fails CI.
- A compiler resolves references and produces a versioned content manifest and
  category/zone chunks. Runtime loaders reject incompatible versions and report
  source IDs in diagnostics.
- Visual assets are referenced through manifest keys. Art paths and Phaser
  objects never become persisted domain identity.
- Derived/generated files are reproducible, carry source hashes, and are not
  hand-edited. Whether compiled artifacts are committed is decided by build-time
  measurement; CI always verifies regeneration.
- Content patching, mod loading, remote executable content, and a custom content
  editor are out of scope.

## 9. Save and persistence approach

Define `SaveRepository` and serialization/migration boundaries independent of
IndexedDB. A save envelope includes format version, build/content compatibility
metadata, save ID, revision, timestamps, checksum, character snapshot, world
snapshot, settings references as appropriate, and migration provenance.

Use IndexedDB transactions for prototype saves. Write a new generation, read it
back and validate/checksum it, then update the active pointer while retaining a
last-known-good generation. Never serialize Phaser objects, component-store
internals, callbacks, or asset paths. Save DTOs reference stable content and
persistent instance IDs.

Handle blocked upgrades, aborted transactions, quota errors, private browsing,
origin changes, and storage eviction as user-visible states. Request persistent
storage at an understandable point in the product flow and without claiming it
is guaranteed; a user gesture is a UX choice, not a Storage API requirement.
Provide explicit JSON export/import for local backup, with validation before
replacement. Autosave is event/checkpoint based and debounced; page-unload is
not the sole save opportunity.

Settings that are small and noncritical may use localStorage. Character/world
progress does not. Local saves are tamperable and must never be treated as
authoritative for future trading, leaderboards, or shared economy.

The eventual server adapter will exchange versioned commands/snapshots over an
authenticated API, with server validation or ownership of valuable state. No
backend, authentication, cloud sync, conflict resolution, or anti-cheat is
implemented in Phase 0.

## 10. Testing strategy

### Test layers

- **Static:** strict TypeScript, ESLint, formatting check, dependency audit, JSON
  Schema, semantic content validation, and reproducible compilation.
- **Core unit/property tests:** coordinates/projection, fixed-step clock, seeded
  random behavior, stats, tags, ability stages, component lifecycle, spatial
  hash, collision, A*, save migrations, checksums, and content reference rules.
- **Browser component/integration tests:** input focus, resize, DOM/canvas
  boundary, IndexedDB, visibility pause/resume, audio unlock state, and selected
  renderer lifecycle behavior in a real browser.
- **Playwright smoke/E2E:** production build boot, asset errors, console errors,
  keyboard/pointer mapping, zone fixture load, save/reload, viewport changes,
  and unsupported/recovery flows across configured projects.
- **Visual tests:** a small deterministic set for isometric projection, depth,
  elevation, and occlusion at fixed viewport/DPR. Do not use screenshots as a
  substitute for behavioral assertions.
- **Performance:** synthetic fixture with deterministic populations, warm-up,
  sampled frame/update/render timings, draw calls where available, memory trend,
  and reproducible report metadata. Shared CI detects catastrophic regressions;
  acceptance performance runs on recorded reference hardware.
- **Manual:** combat feel later, plus browser audio/fullscreen behavior, depth
  readability, GPU compatibility, and final Safari checks on real hardware.

Tests use injectable clocks and seeded random sources. The runtime exposes a
test-only diagnostics API in non-production builds for readiness, metrics, and
controlled fixtures; automation must not rely on arbitrary sleeps or pixel
coordinates where semantic hooks are possible.

CI's required baseline is core tests plus Chromium smoke on every change.
Firefox runs on every change when stable enough; branded Chrome, branded Edge,
and WebKit compatibility run on the release/nightly matrix. Real Safari remains
a release check when hardware is available because Playwright WebKit is not
Safari certification. Browser failures include traces, screenshots, console
logs, and failed network requests.

## 11. Build and deployment strategy

Local development uses a pinned Node LTS, exact dependencies, npm scripts, and
Vite's development server. Vite transpiles TypeScript but does not type-check it,
so `tsc --noEmit` is a separate required command.

The production pipeline is:

1. clean `npm ci`;
2. formatting, lint, type-check, schema, semantic, and generated-output checks;
3. unit and browser integration tests;
4. Vite production build with content/zone chunking and hashed filenames;
5. bundle/asset-budget report;
6. serve the exact artifact and run Playwright smoke tests;
7. upload the immutable artifact and reports;
8. deploy to a preview/staging environment;
9. run remote smoke tests;
10. promote the same artifact to production after approval.

HTML and the small content manifest use revalidation/no-cache semantics. Hashed
JS, CSS, atlases, audio, and zone bundles use long-lived immutable caching.
Compression should provide Brotli and gzip. Deployment must support HTTPS,
correct MIME types, source-map policy, security headers, rollback, and
environment-specific API configuration without rebuilding game logic.

Do not enable a service worker in the initial foundation; stale shell/asset
coordination can create hard-to-debug failures. Add offline caching only through
a later decision. Hosting is a static-site/CDN concern until a backend is
approved. The hosting vendor remains an approval item; GitHub Pages is suitable
for a temporary smoke site but gives insufficient cache/header control for the
intended production path.

## 12. Main technical risks

1. **Phaser 4 maturity and regressions.** It is a recent major release. Mitigate
   with an exact pin, representative gates, adapter boundaries, and deliberate
   upgrade PRs. PixiJS is the documented fallback.
2. **Isometric depth/elevation complexity.** Tall sprites, ramps, bridges, and
   foreground occlusion can create ordering defects. Mitigate with one projection
   convention, discrete elevation, authored metadata, validation, and visual
   fixtures before content scales.
3. **Main-thread density.** Simulation, sorting, pathfinding, DOM, and rendering
   share a browser main thread. Mitigate with fixed budgets, pooling, uniform
   spatial indexing, staggered AI/path requests, culling, dense hot stores, and
   representative browser profiling. Workers follow evidence, not assumption.
4. **Garbage collection spikes.** Per-frame arrays/events/objects can cause
   pauses. Mitigate with allocation tracking, reusable query buffers, object
   pools for measured hot paths, bounded queues, and performance tests.
5. **Tilemap/render batching limits.** Correct isometric ordering can conflict
   with batching. The Phase 0 renderer gate measures draw calls, sort cost, and
   atlas behavior; a hard failure activates the Pixi/custom-renderer comparison.
6. **Navigation under crowd load.** Per-enemy A* and full avoidance do not scale.
   Mitigate with scheduled requests, shared goals, path caching, simple local
   separation, and bounded search. Measure before flow fields or workers.
7. **Asset size and startup.** Atlases, audio, and future zones can dominate
   transfer and memory. Use manifest-driven zone bundles, compression, budgets,
   progressive loading, and explicit unload policies.
8. **Browser lifecycle/GPU variance.** Tab suspension, focus loss, audio policy,
   DPR, and WebGL context loss differ. Test lifecycle transitions and maintain a
   controlled recovery path.
9. **Local-save loss/tampering.** IndexedDB is best-effort and client-controlled.
   Use generations, validation, export/import, clear messaging, and a server
   boundary; never promise secure cloud-grade persistence locally.
10. **Overbuilding framework abstractions.** A custom engine or universal ECS
    would delay combat validation. Every Phase 0 module must satisfy a current
    gate and remain narrowly scoped.
11. **Future multiplayer retrofit.** Single-player decisions may need change.
    Commands, events, IDs, DTOs, and core/adapters reduce coupling, but no claim
    of network determinism is made.
12. **Local-only source control.** Git is initialized, but the owner's current
    local-only choice provides no off-device backup, hosted review, branch
    protection, or CI. Mitigate with small local branches now and require an
    approved remote before TASK-P0-013 or shared development.

## 13. Dependency-ordered Phase 0 implementation backlog

The project owner authorized the Phase 0 architecture baseline on 2026-09-04.
No task below authorizes Phase 1 gameplay, player/enemy combat, production
content, or backend work.

### TASK-P0-001 — Approve and baseline architecture

**Owner:** Director
**Dependencies:** None
**Objective:** Resolve approval items, mark this document approved, establish
Git/source-control workflow, and convert decisions into the active baseline.
**Scope:** Repository initialization/remote choice, branch and review policy,
architecture status, ownership map, browser/reference-hardware record,
and valid single-frontmatter custom-agent definitions using supported model
identifiers or `inherit`.
**Out of scope:** Runtime scaffold, gameplay, deployment.
**Acceptance:** No contradictory active decision remains; every custom role
parses and loads under its declared identity; remote and protection policy are
documented; owners and target browser versions are named.
**Testing:** Independent QA document/repository audit plus non-mutating role-load
dry runs.

**Completion record (2026-09-04):** Architecture choices approved; local Git
initialized on `main`; governance and ownership documented in
`docs/PROJECT_BASELINE.md`; all six custom agents normalized and directly load
tested. The owner selected local-only Git, so hosted branch protection and CI
are intentionally deferred until a remote is approved.

### TASK-P0-002 — Define measurable browser budgets

**Owner:** QA Reviewer, with Director approval
**Dependencies:** P0-001
**Objective:** Turn provisional browser, loading, frame-time, and population
gates into a reproducible test specification.
**Scope:** Reference hardware/browser versions, fixture populations, warm-up,
sampling, pass/fail/report rules, bundle and asset budgets.
**Out of scope:** Optimizing or implementing gameplay.
**Acceptance:** A reviewer can repeat every measurement; thresholds and waiver
process are explicit; Safari availability is recorded.
**Testing:** Dry-run the measurement procedure against a minimal static fixture.

**Completion record (2026-09-04):** Complete and independently accepted. The
reproducible gate contract is recorded in
`docs/TASK_P0_002_BROWSER_PERFORMANCE_BUDGETS.md`, with machine-readable dry-run
evidence in `reports/TASK-P0-002/2026-09-04-dry-run.json`. The available machine
is not the reference tier and real Safari remains unavailable; representative
performance, lifecycle, and browser-matrix gates remain explicitly deferred to
their dependency tasks rather than reported as passes.

### TASK-P0-003 — Establish browser toolchain and module skeleton

**Owner:** Gameplay Engineer
**Dependencies:** P0-001
**Objective:** Create the smallest buildable TypeScript/Phaser/Preact foundation
with documented module boundaries and no gameplay.
**Scope:** Node/npm lock, Vite, strict TypeScript, lint/format, package scripts,
empty core/adapters/presentation/content/persistence/test modules, boot/diagnostic
page, pinned dependencies, and a minimal Playwright harness with a Chromium
production-build boot test that later tasks can extend.
**Out of scope:** Maps, player movement, attacks, enemies, abilities, items.
**Acceptance:** Clean install, type-check, lint, unit-test placeholder, production
build, and Playwright Chromium boot work from commands; Phaser imports are
absent from core modules; shell transfer budget is reported; browser console
errors fail the boot test.
**Testing:** Run all scripts and the minimal Playwright smoke from a clean
checkout.

**Completion record (2026-09-04):** Complete and independently accepted. The
pinned Node/npm/Vite/TypeScript/Phaser/Preact toolchain, framework-free core
boundary, WebGL2-only diagnostic shell, transfer-budget report, Vitest checks,
and Playwright Chromium production-build smoke are implemented and documented
in `docs/TOOLING.md`. A clean `npm ci` verification passed formatting, lint,
type-checking, 10 unit tests, production build, all currently measurable shell
transfer gates, and Chromium smoke. No gameplay or later Phase 0 task was
introduced.

### TASK-P0-004 — Implement deterministic foundation contracts

**Owner:** Combat Engineer
**Dependencies:** P0-003
**Objective:** Provide framework-free clock, fixed-step runner, seeded PRNG,
commands/events, IDs, and composition-root contracts.
**Scope:** Contracts and tests only, including pause/resume and bounded catch-up.
**Out of scope:** Damage, movement behavior, attacks, enemies, full ECS.
**Acceptance:** Same seed/commands produce the same contract-test results;
background-gap simulation is bounded; no Phaser/DOM imports exist in core.
**Testing:** Vitest unit/property tests and lint dependency-boundary checks.

**Completion record (2026-09-04):** Complete and independently accepted. The
framework-free core now provides an injectable clock, bounded fixed 60 Hz
runner, explicit pause/resume behavior, versioned Mulberry32 random state,
typed commands/events, runtime and stable ID contracts, and explicit
composition dependencies. Static, dynamic, type-only, and re-export dependency
escapes from core are rejected. Integrated clean verification passed strict
formatting, lint, type-checking, 73 unit/property-style tests, production build,
all transfer gates, content checks, and Chromium smoke without introducing
gameplay or a general ECS.

### TASK-P0-005 — Create content schema and compiler foundation

**Owner:** Systems Designer
**Dependencies:** P0-003
**Objective:** Establish stable IDs, schema versions, registries, semantic
validation, manifests, and reproducible generated output using non-gameplay
fixtures.
**Scope:** Infrastructure schemas, Ajv tooling, cross-reference diagnostics,
asset keys, fixture definitions, documented authoring workflow.
**Out of scope:** Real item/ability/enemy balance or content sets.
**Acceptance:** Invalid shape, duplicate IDs, missing references, unknown tags,
and incompatible versions fail with source-specific messages; two clean builds
are byte-identical where timestamps are excluded.
**Testing:** Positive/negative fixture tests and CI-ready compiler command.

**Completion record (2026-09-04):** Complete and independently accepted.
Versioned, typed canonical schemas; Ajv validation; central synthetic
registries; semantic diagnostics; safe asset references; and deterministic
manifest/chunk compilation are implemented with the shared P0-004 stable-ID
contract. The non-mutating `content:check` gate verifies schemas, source,
byte-identical compilation, and committed generated-output freshness.
Integrated clean verification passed with Ajv `8.20.0` pinned exactly, 73 total
tests, all P0-002/P0-003 gates, and Chromium smoke. No production content,
balance, maps, gameplay, or P0-006 work was added.

### TASK-P0-006 — Validate isometric world pipeline

**Owner:** Gameplay Engineer
**Dependencies:** P0-002, P0-003, P0-005
**Objective:** Prove Tiled import/compilation, projection, chunk/layer rendering,
foot sorting, elevation, occlusion, picking, and zone load/unload with synthetic
art and markers.
**Scope:** One technical fixture map and renderer adapters.
**Out of scope:** A production zone, encounters, interactions, quests, procedural
generation, polished art.
**Acceptance:** Fixture passes projection/depth visual cases; invalid map metadata
fails compilation; unloaded assets/objects are released; target browsers boot it.
**Testing:** Unit projection tests, deterministic screenshots, Playwright browser
matrix, manual depth review.

### TASK-P0-007 — Build spatial, collision, and navigation primitives

**Owner:** Gameplay Engineer
**Dependencies:** P0-004, P0-006
**Objective:** Prove uniform spatial hash, simple collision queries, compiled
walkability grid, bounded A*, scheduling, and local separation using synthetic
agents.
**Scope:** Framework-free primitives, debug presentation, deterministic fixtures.
**Out of scope:** Enemy AI, combat hit rules, physics simulation, dynamic navmesh,
flow fields, worker implementation.
**Acceptance:** Queries and paths are correct at boundaries/elevation; searches
respect work budgets; no per-agent unbounded path request loop exists.
**Testing:** Unit/property tests plus synthetic crowd timing report.

### TASK-P0-008 — Prove entity/presentation lifecycle

**Owner:** Combat Engineer
**Dependencies:** P0-004, P0-006, P0-007
**Objective:** Validate typed component stores, update order, entity cleanup,
pooled Phaser presentations, interpolation, culling, and allocation discipline
using behaviorless synthetic actors/projectiles/loot.
**Scope:** Technical entities and diagnostics only.
**Out of scope:** Player/enemy logic, attacks, damage, drops, balance, broad ECS.
**Acceptance:** Spawn/despawn leaves no stale components or visuals; no
authoritative state resides in Phaser objects; fixture reaches P0-002 populations
and emits timing/allocation metrics.
**Testing:** Lifecycle tests, leak trend test, browser performance run.

### TASK-P0-009 — Define and test ability execution contracts

**Owner:** Combat Engineer, reviewed by Systems Designer
**Dependencies:** P0-004, P0-005, P0-008
**Objective:** Implement only the generic typed ability/effect schema and
execution-state contracts needed to unblock later phases.
**Scope:** Validation, timing stages, cancellation/refund policy, tags, bounded
triggers, mock executors, deterministic tests.
**Out of scope:** Playable abilities, animations, damage balance, real combat.
**Acceptance:** Mock definitions demonstrate success, invalid request,
cancellation, cooldown, and bounded trigger behavior without Phaser.
**Testing:** Unit/contract tests and malformed-content tests.

### TASK-P0-010 — Establish persistence foundation

**Owner:** Gameplay Engineer
**Dependencies:** P0-004, P0-005
**Objective:** Implement SaveRepository, versioned envelope, migrations,
IndexedDB generations/backups, validation, and export/import using fixture state.
**Scope:** Local technical fixture and error UX hooks.
**Out of scope:** Production character schema, accounts, cloud sync, backend,
anti-cheat.
**Acceptance:** Round trip and migration preserve fixture state; interrupted or
invalid newest generation falls back safely; quota/blocked errors are surfaced;
malformed import cannot replace a valid save.
**Testing:** Unit migration tests and Playwright reload/failure-path tests.

**Completion record (2026-09-04):** Complete pending independent acceptance.
The framework-free persistence boundary now provides versioned, checksummed
synthetic save envelopes, ordered migration, fixture-state validation, and
validated JSON export/import. The IndexedDB adapter writes inactive
generations, verifies them before pointer promotion, retains a last-known-good
backup, and exposes stable error UX states. Clean pinned verification passed 76
unit tests and seven Chromium production-artifact tests, including reload,
invalid-active fallback, interrupted promotion, quota/blocked error hooks,
valid export/import, and non-destructive malformed/tampered import. No
production character/world schema, gameplay, account, backend, cloud-sync, or
anti-cheat behavior was introduced.

### TASK-P0-011 — Establish UI shell boundaries

**Owner:** UI Engineer
**Dependencies:** P0-003, P0-004
**Objective:** Prove Preact/canvas layout, read-model/intent contracts, focus,
input capture, resize/DPR, loading/error overlays, and basic accessibility.
**Scope:** Technical shell with placeholder diagnostics.
**Out of scope:** HUD design, inventory, skill UI, vendors, visual identity.
**Acceptance:** DOM UI never mutates core state directly; keyboard focus does not
leak into gameplay input; supported desktop viewports resize cleanly.
**Testing:** Browser component tests, Playwright focus/resize tests, manual
keyboard review.

### TASK-P0-012 — Complete browser verification harness

**Owner:** QA Reviewer
**Dependencies:** P0-006, P0-008, P0-010, P0-011
**Objective:** Make static, unit, browser, visual, lifecycle, and performance
checks repeatable with useful artifacts.
**Scope:** Playwright projects, diagnostics hooks, context-loss, tab lifecycle,
console/network capture, traces, reports, test documentation.
**Out of scope:** Gameplay acceptance tests and exhaustive Safari certification.
**Acceptance:** A clean run exercises configured Chromium, branded Chrome,
branded Edge, Firefox, and WebKit tiers; real Safari availability and manual
release coverage are recorded; WebGL2 preflight/rejection, forced failures,
context-loss, and save/reload paths retain actionable artifacts.
**Testing:** Intentionally fail each harness class, inspect artifact, then restore.

### TASK-P0-013 — Establish CI and staging deployment

**Owner:** Director / release engineering; QA Reviewer validates
**Dependencies:** P0-002, P0-003, P0-012
**Objective:** Produce and deploy the exact tested immutable static artifact.
**Scope:** CI, dependency cache, artifact metadata, preview/staging host selection,
headers, compression, cache behavior, remote smoke test, rollback procedure.
**Out of scope:** Production launch, backend/API, service worker, analytics.
**Acceptance:** Clean CI builds once and deploys the same artifact; staging uses
HTTPS and required MIME/cache/security headers; previous artifact can be restored;
remote smoke passes.
**Testing:** Full pipeline, cache inspection, failed-deploy exercise, rollback.

### TASK-P0-014 — Run architecture acceptance gate

**Owner:** QA Reviewer, accepted by Director
**Dependencies:** P0-005 through P0-013
**Objective:** Independently decide whether the foundation is safe for Phase 1.
**Scope:** Requirements trace, clean checkout, all tests, target browsers,
performance/bundle reports, source-control and decision audit, known risks.
**Out of scope:** Fixing failures inside the review, gameplay implementation.
**Acceptance:** QA issues PASS or FAIL with blocking/major/minor findings; Director
records acceptance or remediation tasks. Phase 1 remains blocked on PASS and
explicit Director approval.
**Testing:** Execute rather than infer every available automated gate; explicitly
list unavailable hardware/manual checks.

## Approval status

Approved by the project owner on 2026-09-04:

1. Phaser 4.2.1 as the initial framework and PixiJS as the conditional fallback.
2. WebGL2-only gameplay baseline and the unsupported-browser UX.
3. No WebGPU requirement for the vertical slice.
4. Preact with HTML/CSS for DOM UI.
5. Tiled as the zone authoring tool.
6. Strict TypeScript with framework-independent simulation.

Additional operational selections recorded on 2026-09-04:

1. Use local Git only for now; no remote or CI provider is approved.
2. Use Windows 10/11, a four-core CPU, 8 GB RAM, Intel UHD 630-class integrated
   graphics, and 1920×1080 at device-pixel ratio 1 as the initial minimum
   reference tier.
3. Real Safari hardware is unavailable; Playwright WebKit is an interim signal,
   not Safari certification.

Still requiring later project-owner selection:

1. The preview/staging hosting vendor after P0-013 compares headers, CDN,
   preview environments, cost, and rollback requirements.
2. A remote and CI provider before TASK-P0-013 or shared development.

## Research sources

Official or primary documentation consulted on 2026-09-04:

- Phaser 4.2/4.2.1 release:
  <https://phaser.io/news/2026/07/phaser-4-2-spine-renderer-mesh2d-stencil>
- Phaser scenes: <https://docs.phaser.io/phaser/concepts/scenes>
- Phaser loader and Tiled JSON:
  <https://docs.phaser.io/phaser/concepts/loader>
- Phaser input: <https://docs.phaser.io/phaser/concepts/input>
- Phaser cameras: <https://docs.phaser.io/phaser/concepts/cameras>
- Phaser isometric TilemapLayer and culling:
  <https://docs.phaser.io/api-documentation/class/tilemaps-tilemaplayer>
- PixiJS renderers:
  <https://pixijs.com/8.x/guides/components/renderers>
- PixiJS ParticleContainer:
  <https://pixijs.com/8.x/guides/components/scene-objects/particle-container>
- Godot web export limitations:
  <https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html>
- Godot C# platform support:
  <https://docs.godotengine.org/en/stable/tutorials/scripting/c_sharp/>
- Unity web technical limitations:
  <https://docs.unity3d.com/6000.7/Documentation/Manual/webgl-technical-overview.html>
- Unity web multithreading:
  <https://docs.unity3d.com/Manual/web-multithreading-intro.html>
- Babylon.js sprites:
  <https://doc.babylonjs.com/features/featuresDeepDive/sprites/sprites_introduction/>
- Three.js sprites and WebGPU renderer:
  <https://threejs.org/docs/pages/Sprite.html> and
  <https://threejs.org/docs/pages/WebGPURenderer.html>
- Vite TypeScript behavior and production builds:
  <https://vite.dev/guide/features> and <https://vite.dev/guide/build>
- Vitest Browser Mode: <https://vitest.dev/guide/browser/>
- Playwright browser support: <https://playwright.dev/docs/browsers>
- IndexedDB/storage quotas and eviction:
  <https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria>
- WebGL context loss/restoration:
  <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event>
  and
  <https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextrestored_event>
- npm lockfiles and clean installs:
  <https://docs.npmjs.com/cli/v12/configuring-npm/package-lock-json/> and
  <https://docs.npmjs.com/cli/v12/commands/npm-ci/>

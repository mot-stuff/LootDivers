# Architecture and Design Decisions

Use this document to record important decisions.

The project owner approved the Phase 0 architecture direction on 2026-09-04,
including Phaser 4.2.1, conditional PixiJS fallback, WebGL2, no vertical-slice
WebGPU dependency, Preact/HTML/CSS, Tiled, and strict TypeScript with a
framework-independent simulation. Provider, reference-hardware, and Safari
availability selections are recorded in `docs/PROJECT_BASELINE.md`: local Git
only for now, an Intel UHD 630-class minimum reference tier, and no current real
Safari hardware. Remote/CI and hosting providers remain future decisions.
DEC-016 reduces Phase 0 to a seven-task validation gate and supersedes earlier
Phase 0 completion/authorization language. DEC-017 accepts local production-
artifact browser proof for P0-G06 and defers public HTTPS staging.

---

# Decision Template

## DEC-###

### Date

YYYY-MM-DD

### Decision

Describe what was decided.

### Context

Explain why this decision was needed.

### Options Considered

1. Option A
2. Option B
3. Option C

### Chosen Approach

Explain the selected approach.

### Why

Explain why it was selected.

### Tradeoffs

List drawbacks or risks.

### Systems Affected

List affected systems.

---

# DEC-001

### Status

Accepted and active.

### Date

Undated (pre-existing decision)

### Decision

Build a polished single-player vertical slice before networking.

### Context

Networking would dramatically increase complexity before the core gameplay loop is proven.

### Options Considered

1. Build networking into the initial vertical slice
2. Build the vertical slice as single-player while preserving reasonable system
   boundaries for possible later networking

### Chosen Approach

Build systems with reasonable separation but do not implement networking during the initial vertical slice.

### Why

This allows combat, progression, itemization, professions, and world gameplay to be validated first.

### Tradeoffs

Some systems may require later restructuring for multiplayer.

### Systems Affected

- Combat
- Save system
- Enemy architecture
- Inventory
- World state

---

# DEC-002

### Status

**Superseded by DEC-009 on 2026-09-04.** Godot 4.7.2 .NET cannot export to
the Web according to Godot's official documentation and is incompatible with
RARPG's hard browser-first requirement.

### Date

2026-09-04

### Decision

Use Godot 4.7.2 .NET with C# 12 on .NET 8 as the initial RARPG engine and
application stack, subject to a Phase 0 representative performance gate.

### Context

RARPG needs dedicated 2D isometric rendering, tilemaps, sorting, navigation,
particle effects, UI, headless automation, Windows deployment, agent-friendly
source, and a credible route to large ARPG populations.

### Options Considered

1. Godot 4.7.2 .NET
2. Unity 6.3 LTS
3. MonoGame 3.8.5.1
4. Defold 1.13.1
5. Unreal Engine 5.8.2
6. A custom engine

### Chosen Approach

Pin Godot 4.7.2 .NET and .NET 8. Use C# for production code. Confirm the choice
with isometric depth, crowd/navigation, projectile, effect, and loot stress
spikes before Phase 1. Run an equivalent Unity 6.3 LTS comparison spike only if
Godot has a hard benchmark failure or unacceptable remediation, then record the
final measured engine decision.

### Why

Godot provides the best balance of purpose-built 2D features, text-based project
assets, headless command-line workflows, C# support, low operational overhead,
Windows export, source availability, and MIT licensing. Unity is the strongest
fallback if measured results expose a hard Godot limitation.

### Tradeoffs

- Godot has no built-in production ARPG ability/entity stack.
- High-count C# Nodes, navigation avoidance, and physics objects require
  representative profiling.
- C# projects currently cannot export to Web, and mobile support is experimental.

### Systems Affected

- All runtime and editor systems
- Content and asset pipeline
- Testing and CI
- Windows builds

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 1-3 and 10-13.

---

# DEC-003

### Status

**Superseded by DEC-010 on 2026-09-04.** The separation and composition
principles remain, but the C#/Godot Node implementation does not.

### Date

2026-09-04

### Decision

Separate engine-independent game rules from Godot integration and use
composition-oriented scene entities with specialized data-oriented hot paths.

### Context

RARPG needs maintainable actors and testable rules while retaining a scaling
route for enemies, projectiles, effects, and loot. A project-wide ECS would add
complexity before representative profiling exists, while putting all rules in
Nodes would tightly couple the game to the engine.

### Options Considered

1. Godot Node inheritance for all behavior
2. A project-wide ECS from the beginning
3. Composed Nodes plus a pure C# core and measured hot-loop services

### Chosen Approach

Maintain a pure `RARPG.Core` rules boundary and a Godot-facing `RARPG.Game`
adapter/presentation boundary. Compose actors from narrow components. Keep actors
as Nodes initially, then move only measured high-count workloads into pooled,
compact, data-oriented services.

### Why

This preserves editor usability and straightforward scene composition while
making formulas, generation, itemization, abilities, and persistence testable
without Godot. It avoids both deep inheritance and premature ECS complexity.

### Tradeoffs

- Boundaries and mapping code require discipline.
- Some data exists in domain and presentation forms.
- Late optimization may still require native server APIs or a focused extension.

### Systems Affected

- Player and enemies
- Combat and abilities
- Projectiles and effects
- Loot and interactions
- Testing

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 4, 6, and 7.

---

# DEC-004

### Status

**Superseded by DEC-011 on 2026-09-04.** Stable IDs and canonical JSON remain,
but typed TypeScript definitions and browser-native assets replace the
C#/Godot-specific approach.

### Date

2026-09-04

### Decision

Use versioned, schema-validated JSON as canonical gameplay content and stable
namespaced IDs as cross-system identity.

### Context

Items, affixes, abilities, statuses, enemies, loot, professions, recipes,
encounters, and procedural modules must be data-driven, reviewable, generatable
by agents, and safe to evolve. Godot Resources are useful for engine assets but
couple domain data to Variant-compatible engine serialization.

### Options Considered

1. Hardcoded C# definitions
2. Godot Resources for all content
3. Canonical JSON for domain definitions plus Godot Resources/scenes for
   presentation assets
4. An embedded database

### Chosen Approach

Store gameplay definitions as UTF-8 JSON validated by versioned JSON Schema and
semantic validators. Load them into typed immutable C# definitions. Use
`.tres`/`.tscn` for engine-native visual resources and scenes.

### Why

JSON supports clear diffs, command-line validation, programmatic generation,
stable schemas, and engine-independent tests. The hybrid avoids recreating
Godot's strong visual asset pipeline.

### Tradeoffs

- The project must build validators and reference resolution.
- Designers do not initially receive a custom database editor.
- JSON is verbose and cannot enforce semantic integrity without project tooling.

### Systems Affected

- Items and loot
- Abilities and statuses
- Progression, professions, and crafting
- Enemies, encounters, and procedural content
- Localization and asset references

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, section 8.

---

# DEC-005

### Status

**Superseded by DEC-012 on 2026-09-04.** Segmented zones and authored modules
remain, but Godot TileMapLayer, NavigationRegion2D, and scene assumptions do not.

### Date

2026-09-04

### Decision

Use segmented 2D isometric zone scenes built from layered `TileMapLayer` nodes,
baked 2D navigation, foot-point sorting, and authored modules for
semi-procedural dungeons.

### Context

The game needs towns, outdoor areas, dungeons, bosses, correct isometric depth,
and eventual repeatable content. A seamless MMO-scale world and fully procedural
world generation are explicitly outside the initial scope.

### Options Considered

1. Seamless streamed world
2. Segmented authored zones
3. Fully procedural tile worlds
4. Segmented zones with authored modular procedural dungeons

### Chosen Approach

Load towns, outdoor zones, dungeons, and arenas independently. Use layered
`TileMapLayer` nodes, explicit elevation bands, foot-anchor sorting, optimized
`NavigationRegion2D` data, and reproducible room-graph assembly from authored
modules.

### Why

Segmented zones bound memory, navigation, saves, and iteration time. Authored
modules preserve visual and encounter quality while enabling seeded replayability
without taking on full procedural generation.

### Tradeoffs

- Zone transitions are visible unless disguised.
- Bridges, ramps, tall props, and foreground occlusion need strict authoring rules.
- Modular generation requires validation of sockets, reachability, and navigation.

### Systems Affected

- Rendering and camera
- World authoring
- Navigation
- Encounters and procedural content
- Save/world state

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 4 and 5.

---

# DEC-006

### Status

**Superseded by DEC-013 on 2026-09-04.** The typed composable design remains
valid and is restated with browser-native execution boundaries and safety budgets.

### Date

2026-09-04

### Decision

Use typed, composable ability/effect specifications with an explicit execution
pipeline and central tag/stat registries.

### Context

RARPG requires attacks, projectiles, areas, status effects, item modifiers, and
build interactions without a separate architecture for every ability. A fully
generic visual graph or unconstrained trigger system would be premature and hard
to validate.

### Options Considered

1. One bespoke class/script per ability
2. A general visual scripting graph
3. Data-defined abilities composed from typed code-defined effects

### Chosen Approach

Define ability timing, targeting, costs, cooldowns, tags, and ordered effects in
canonical content. Execute them through explicit validation, cost, startup,
active, recovery, completion, and cancellation stages. Use custom executors only
for behavior that cannot be expressed clearly with shared primitives.

### Why

The approach supports varied abilities and item interactions while keeping
ordering, interruption, testing, and debugging understandable.

### Tradeoffs

- The primitive effect vocabulary must evolve carefully.
- Some complex mechanics require custom code.
- Trigger cycles and snapshot/live-stat semantics require explicit policies.

### Systems Affected

- Combat
- Abilities and status effects
- Items and affixes
- Stats and resources
- Animation and VFX integration

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, section 7.

---

# DEC-007

### Status

**Superseded by DEC-014 on 2026-09-04.** Local JSON files and platform-specific
atomic replacement are not browser persistence mechanisms.

### Date

2026-09-04

### Decision

Use versioned local JSON save snapshots with dedicated persistence records,
ordered migrations, validated temporary writes, and last-known-good backup
rotation.

### Context

Persistent character, inventory, profession, world, and generated-content state
must survive format changes and interrupted writes. Serializing live Nodes or
using scene/resource paths as identity would make saves brittle.

### Options Considered

1. Serialize live Godot scenes/resources
2. Versioned JSON snapshots with migrations
3. SQLite
4. A custom binary format

### Chosen Approach

Map domain state to dedicated versioned DTOs, reference content by stable IDs,
write and validate a temporary snapshot, rotate a backup, and replace the
primary save. Run tested ordered migrations when reading older versions.

### Why

JSON is debuggable and sufficient for initial local save volumes. Dedicated DTOs,
stable IDs, backups, and migrations directly address corruption and schema
evolution.

### Tradeoffs

- JSON is larger and slower than a compact binary format.
- Atomic replacement details are platform-specific and must be tested.
- Offline client saves cannot be made tamper-proof.
- Cloud conflict resolution is deferred.

### Systems Affected

- Character/account progression
- Inventory and equipment
- Professions and crafting
- World and procedural state
- Build/content versioning

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, section 9.

---

# DEC-008

### Status

**Superseded by DEC-015 on 2026-09-04.** The Windows/Godot/.NET build pipeline
is replaced by browser-native tests, static artifacts, and browser deployment.

### Date

2026-09-04

### Decision

Use layered automated testing and a pinned headless Windows build/export pipeline.

### Context

The project must support automated agent-assisted changes, practical regression
testing, repeatable builds, and initial Windows deployment.

### Options Considered

1. Manual editor builds and playtesting only
2. Engine-only integration tests
3. Pure xUnit tests plus project-owned Godot headless integration tests and CI

### Chosen Approach

Run xUnit tests for pure C# rules, schema/semantic content validation, Godot
headless integration/smoke tests, and controlled performance harnesses. CI pins
Godot 4.7.2 .NET and .NET 8, then validates, tests, imports/builds, exports, smoke
checks, and archives a traceable Windows x86-64 artifact.

### Why

Fast engine-independent tests give precise feedback, while headless Godot tests
cover lifecycle and integration failures. Pinned command-line exports make builds
reproducible for agents and humans.

### Tradeoffs

- A small integration runner and CI tool setup must be maintained.
- Shared CI is unsuitable for strict frame-time regression gates.
- Final responsiveness, depth readability, and minimum-spec performance still
  require manual/hardware testing.

### Systems Affected

- All code and content
- CI and release engineering
- QA workflow
- Windows deployment

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 10, 11, and 13.

---

# DEC-009

### Status

Accepted as technical direction. DEC-016 supersedes its original exhaustive
Phase 0 gate and separate-Director-approval language.

### Date

2026-09-04

### Decision

Use strict TypeScript and Phaser 4.2.1 as RARPG's initial browser-native runtime
and WebGL2 renderer. Keep PixiJS 8 as the named fallback only if representative
Phase 0 gates expose a hard Phaser limitation.

### Context

RARPG is definitively browser-first, desktop-first, 2D, isometric, and real-time.
The previous Godot 4.7.2 .NET choice could not export to Web and optimized for a
Windows client that the product explicitly defers.

### Options Considered

1. Phaser 4.2.1 with framework-independent TypeScript game rules
2. PixiJS 8 plus a larger project-owned browser runtime
3. Raw TypeScript/WebGL or WebGPU renderer
4. Babylon.js or Three.js 2.5D architecture
5. Godot 4 web export
6. Unity Web

### Chosen Approach

Pin Phaser 4.2.1 exactly and use its rendering, tilemap, input, camera, loader,
and audio facilities through adapters. Use WebGL2 as the production baseline.
Preflight and assert a WebGL2 context before Phaser boot rather than assuming
Phaser's generic WebGL selection guarantees the version. Do not depend on
WebGPU, Wasm desktop-engine export, or Canvas gameplay fallback. Validate the
choice with browser, isometric, lifecycle, loading, bundle, and
synthetic-population gates before Phase 1.

### Why

Phaser supplies the commodity services a browser game needs while retaining a
normal TypeScript/ESM workflow, direct browser debugging, DOM integration,
static deployment, and automated browser testing. It requires materially less
custom runtime work than PixiJS without importing a desktop engine and Wasm
bootstrap into the primary platform.

### Tradeoffs

- Phaser 4 is a recent major release and requires pinned, deliberate upgrades.
- Phaser scenes can encourage framework coupling if boundaries are not enforced.
- RARPG still owns ARPG simulation, collision, navigation, data, and persistence.
- WebGL2 excludes old/unsupported browsers; they receive a clear error flow.

### Systems Affected

- All runtime and presentation systems
- Tooling, testing, content pipeline, and deployment
- Browser support and performance validation

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 1-4 and 12-13.

---

# DEC-010

### Status

Accepted.

### Date

2026-09-04

### Decision

Use a framework-independent fixed-step simulation with composition-oriented
typed component stores and specialized dense hot paths; Phaser objects are
presentation adapters, not authoritative entities.

### Context

RARPG needs testable rules and predictable high-count updates without coupling
every entity to Phaser's scene graph or adopting a general-purpose ECS before
representative profiling.

### Options Considered

1. Authoritative Phaser Game Objects and Scene logic
2. A third-party project-wide ECS
3. Typed project-owned component stores and explicit systems
4. Class hierarchy per entity type

### Chosen Approach

Run rules at a fixed 60 Hz behind explicit commands/events, an injectable clock,
and seeded random source. Use opaque runtime entity IDs, typed stores, declared
system order, a presentation registry, and dedicated pools/dense arrays for
measured high-count workloads.

### Why

This preserves deterministic contract testing, clear ownership, and a measured
optimization path while avoiding both framework lock-in and premature universal
ECS abstractions.

### Tradeoffs

- The project owns lifecycle and system-order discipline.
- Domain state must be mapped to presentation/read models.
- This does not guarantee future network determinism or rollback compatibility.

### Systems Affected

- Entities, combat, abilities, projectiles, effects, loot, and interactions
- Testing and future persistence/network boundaries

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 3 and 6.

---

# DEC-011

### Status

Accepted.

### Date

2026-09-04

### Decision

Use versioned JSON Schema-validated content, semantic validation, stable
namespaced IDs, and a reproducible compiler that emits typed browser-ready
content and zone manifests.

### Context

Agents and developers must create and review items, affixes, abilities, enemies,
loot, professions, recipes, encounters, and zones without writing bespoke code
or relying on binary/editor-only domain assets.

### Options Considered

1. Hardcoded TypeScript definitions
2. Raw JSON loaded directly at runtime
3. Canonical JSON plus schema, semantic validation, and compilation
4. Embedded browser database as canonical content

### Chosen Approach

Canonical UTF-8 JSON uses stable namespaced IDs and versioned schemas. Ajv checks
shape, project validators check semantics and references, and a deterministic
compiler emits manifests/chunks and aligned TypeScript types. Visual assets use
manifest keys rather than persistent paths.

### Why

Text content is diffable, generatable, testable, and engine-independent.
Compilation catches errors before runtime and supports zone-based browser loading.

### Tradeoffs

- Schemas, semantic validators, and generated-type alignment require maintenance.
- JSON is verbose.
- A custom visual content editor is deferred.

### Systems Affected

- All gameplay content, world bundles, saves, localization, and assets

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, section 8.

---

# DEC-012

### Status

Accepted.

### Date

2026-09-04

### Decision

Use segmented, Tiled-authored isometric zones compiled into validated runtime
bundles with discrete elevation, foot-point sorting, collision/navigation grids,
and manifest-driven on-demand loading.

### Context

RARPG needs towns, wilderness, dungeons, boss arenas, correct pseudo-isometric
depth, and bounded browser memory. A seamless world and fully procedural world
are outside the vertical slice.

### Options Considered

1. Seamless streamed world
2. Direct runtime use of arbitrary Tiled JSON
3. Compiled segmented authored zones
4. Fully procedural tile worlds

### Chosen Approach

Author source maps in Tiled, validate and compile them into versioned layer,
collision, navigation, object, occlusion, portal, and asset chunks, then load
zones independently. Actor bases, props, loot, and interactables share an
elevation-aware foot-point sort; overhangs and foreground occluders use authored
split layers. Semi-procedural dungeons may later assemble validated authored
room modules.

### Why

Segmented compiled zones bound memory and loading, make authoring errors fail at
build time, and preserve a controlled path to seeded repeatable dungeons.

### Tradeoffs

- The project owns map validation/compilation and strict authoring conventions.
- Transitions are visible unless disguised.
- Bridges, ramps, occlusion, and multiple elevation bands require early fixtures.

### Systems Affected

- Rendering, world authoring, collision, navigation, assets, and saves

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 4-5.

---

# DEC-013

### Status

Accepted.

### Date

2026-09-04

### Decision

Use typed composable ability/effect definitions executed by an explicit,
framework-independent staged pipeline with central tag/stat registries and
bounded triggers.

### Context

The game needs attacks, projectiles, areas, statuses, item interactions, timing,
interruption, and testing without scripts in content or a bespoke architecture
for every ability.

### Options Considered

1. One class per ability
2. Arbitrary scripted content or a general visual graph
3. Typed data definitions with shared code-defined effects and limited custom
   executors

### Chosen Approach

Definitions describe targeting, phases, costs, cooldowns, tags, ordered effects,
and cancellation. The pipeline explicitly validates, pays/reserves, advances
startup/active/recovery, completes or cancels, and applies cooldown policy.
Custom behavior registers a stable executor kind; trigger depth/work is bounded.

### Why

This supports build variety while keeping execution order, interruption,
snapshot policy, validation, and debugging understandable.

### Tradeoffs

- The shared effect vocabulary must evolve carefully.
- Novel mechanics still require code-defined executors.
- Trigger and stat-capture policies require comprehensive tests.

### Systems Affected

- Combat, stats, resources, statuses, items, animation, and effects

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, section 7.

---

# DEC-014

### Status

Accepted for prototype/local persistence. Production server persistence remains
undecided.

### Date

2026-09-04

### Decision

Use versioned dedicated save DTOs stored as validated generations in IndexedDB,
with migrations, checksum, last-known-good fallback, and explicit export/import.

### Context

Browser saves must survive schema changes and interrupted transactions, but
IndexedDB data is best-effort, origin-scoped, and user-tamperable. LocalStorage
is unsuitable for character/world snapshots.

### Options Considered

1. localStorage JSON
2. IndexedDB with a repository and generation protocol
3. OPFS files
4. Immediate account/backend persistence

### Chosen Approach

Hide IndexedDB behind `SaveRepository`. Persist versioned envelopes and dedicated
DTOs, validate a new generation before updating the active pointer, retain a
backup, run ordered migrations, and surface quota/eviction/blocked states.
Provide validated export/import. Keep a future trusted server adapter boundary.

### Why

IndexedDB is broadly available and transactional, supports larger structured
data than localStorage, and avoids premature backend work. Generations and export
reduce—but cannot eliminate—browser storage loss risk.

### Tradeoffs

- Storage may be evicted and is tied to an origin/browser profile.
- Local data cannot be secure or authoritative.
- Cloud synchronization and conflict resolution are deferred.

### Systems Affected

- Character/world progression, inventory, professions, settings, migration, UI

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, section 9.

---

# DEC-015

### Status

Accepted. The initial reference hardware tier is recorded; hosting and remote/CI
providers remain future approval items, and real Safari hardware is unavailable.

### Date

2026-09-04

### Decision

Use a pinned Node/npm/Vite TypeScript toolchain, layered Vitest and Playwright
verification, and a provider-neutral immutable static artifact promoted through
preview/staging before production.

### Context

The browser is the target runtime. Agents need clean command-line installs,
type-checks, tests, browser diagnostics, reproducible builds, and deployment of
the exact tested artifact rather than a Windows executable.

### Options Considered

1. Manual local builds and browser checks
2. Unit tests without browser automation
3. Static/unit/browser/performance layers with automated artifact deployment

### Chosen Approach

Commit the npm lockfile and use `npm ci`. Run formatting, lint, `tsc --noEmit`,
content validation, Vitest, Vite build, bundle budgets, and Playwright smoke
tests. Test the built artifact, deploy that immutable artifact to staging, run
remote smoke tests, and promote with rollback. Chromium, branded Chrome,
branded Edge, Firefox, and WebKit compatibility are automated at documented
tiers; real Safari is checked when hardware is available. WebGL2 preflight,
lifecycle, context-loss, and representative performance are explicit gates.

### Why

Most domain failures receive fast tests while real browsers cover the runtime,
storage, rendering, and lifecycle behavior that simulated environments miss.
Hashed static artifacts support CDN delivery and reproducible rollback.

### Tradeoffs

- Multiple browser binaries and visual artifacts increase CI cost.
- Shared CI cannot be the sole source of strict performance acceptance.
- A staging/production host with suitable cache/header control must be selected.

### Systems Affected

- All code and content, CI, QA, browser compatibility, and deployment

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, sections 10-13.

---

# DEC-016

### Status

Accepted. This decision narrows Phase 0 acceptance scope without deleting or
reversing working implementation.

### Date

2026-09-04

### Decision

Replace the fourteen-task Phase 0 infrastructure program with seven
dependency-ordered stack-validation tasks. Independent QA PASS on the lean gate
immediately completes Phase 0 and authorizes Phase 1 combat.

Retain only these Phase 0 obligations: project/toolchain foundation;
Phaser/WebGL2 boot under strict TypeScript; one Tiled isometric fixture and basic
depth sorting; framework-independent fixed-step and minimal entity/component
lifecycle; one synthetic browser performance run; minimal IndexedDB save/load;
one production build deployed once to staging; and independent QA acceptance.

### Context

Former P0-001 through P0-011 delivered substantial foundation code before
combat feel was tested. The backlog had turned advanced content compilation,
navigation, abilities, persistence recovery, UI, browser matrices, CI/CD, and
production operations into prerequisites for the first movement and combat
prototype. That sequencing conflicted with the project priority to prove
responsive combat before broad infrastructure.

### Options Considered

1. Finish the original P0-012 through P0-014 gates before combat.
2. Discard the completed foundation and restart with a smaller scaffold.
3. Preserve working code, map existing evidence to a compact gate, defer
   advanced acceptance, and begin Phase 1 immediately after lean independent QA.

### Chosen Approach

Choose option 3. Former P0-001/P0-003 map to the browser foundation; P0-006 to
the isometric fixture; P0-004/P0-008 to fixed-step and lifecycle; P0-002/P0-008
to the synthetic performance check; and P0-010 to minimal IndexedDB persistence.
The existing production build plus one still-pending staging deployment form the
release proof. A new P0-G07 QA review is the only final authorization gate.

Former P0-005, P0-007, P0-009, and the excess scope of P0-010 and P0-011 are
completed-early, non-gating infrastructure. Their code stays in place. Their
advanced acceptance and future maintenance move to the gameplay phase that
actually consumes them.

### Why

The compact gate still tests the architectural risks that could invalidate the
stack: browser boot, isometric rendering/depth, simulation separation and
lifecycle, synthetic density, local browser persistence, production output, and
real HTTPS delivery. It removes speculative completeness requirements that do
not need to precede player movement and attacks.

Independent QA remains mandatory, but it evaluates only explicit compact
criteria. A PASS authorizes Phase 1 without a second architecture or owner
approval, avoiding another administrative gate after technical acceptance.

### Tradeoffs

- Phase 1 may discover that completed-early systems need redesign.
- Cross-browser, minimum-spec, recovery, accessibility, hosting, and operations
  risks remain open and must be revisited before their consuming milestones.
- One short current-machine performance run catches catastrophic regressions
  but is not minimum-spec certification or a statistical performance claim.
- Manual staging verification is less repeatable than future remote automation.
- Keeping extra code carries maintenance cost even though it no longer gates
  combat.

### Systems Affected

- Phase planning and task status
- QA and Phase 1 authorization
- Browser/runtime, world, entity, persistence, build, and staging acceptance
- Content, navigation, ability, UI, browser-matrix, CI/CD, and multiplayer
  deferrals

### Relationship to Earlier Decisions

DEC-009 through DEC-015 remain technical direction. DEC-016 supersedes only
their interpretation as exhaustive Phase 0 prerequisites. Core/Phaser
separation, strict TypeScript, browser tests, WebGL2, Tiled, and IndexedDB
boundaries remain active safeguards.

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, `docs/PROJECT_BASELINE.md`, and
`docs/ROADMAP.md`.

---

# DEC-017

### Status

Accepted as an owner-approved Phase 0 exception. Public HTTPS staging remains a
later delivery obligation.

### Date

2026-09-04

### Decision

For P0-G06 only, treat the exact production artifact served over loopback plus
successful Chromium and headed Microsoft Edge boot checks as sufficient
deployment proof. Defer public HTTPS staging until a later delivery milestone.

### Context

The owner explicitly selected local-only development rather than GitHub or
public staging. Requiring an external provider solely to begin the combat
prototype would conflict with that choice and would test hosting operations
rather than the reduced Phase 0 stack risks.

The production build passed. Chromium production-artifact smoke passed 26 tests
with one diagnostic-only skip. A short headed hardware-accelerated Microsoft
Edge run reached the ready WebGL2 fixture on an NVIDIA RTX 5070 Ti at 1920×1080
DPR 1, with a 14 ms p95 frame interval and zero intervals over 33.4 ms.

### Options Considered

1. Require public HTTPS staging before Phase 1.
2. Accept loopback production-artifact browser proof temporarily.
3. Remove deployment proof from Phase 0 entirely.

### Chosen Approach

Choose option 2. Preserve a real production build and browser boot requirement
while postponing provider selection, public HTTPS transport, CDN behavior,
cache/header validation, remote automation, and rollback work.

### Why

Serving `dist` over loopback exercises the built static artifact independently
of Vite's development server. Chromium and branded Edge verify the current
machine's production boot and WebGL2 path. This is enough for the reduced
stack-validation purpose without pretending that local HTTP proves public
delivery behavior.

### Tradeoffs

- Public HTTPS, external routing, CDN/cache headers, and remote-origin behavior
  remain untested.
- The performance evidence is a short current-machine stack sanity test, not a
  statistical performance claim.
- The NVIDIA RTX 5070 Ti evidence remains `INELIGIBLE` for the Intel UHD 630
  minimum-spec certification and must not be relabeled as that certification.
- Local-only Git has no off-device backup, hosted CI, branch protection, or
  pull-request enforcement.

### Systems Affected

- Phase 0 P0-G06 and P0-G07 acceptance
- Deployment planning and release engineering
- Phase 1 authorization

### Relationship to Earlier Decisions

DEC-015 remains the long-term deployment direction. DEC-017 supersedes only its
public staging requirement as a Phase 0 prerequisite. DEC-016's lean QA and
automatic Phase 1 authorization rules remain active.

### Reference

See `docs/PHASE_0_ARCHITECTURE.md`, `docs/PROJECT_BASELINE.md`,
`docs/ROADMAP.md`, and
`reports/TASK-P0-008/local-browser-ineligible.json`.

---

# DEC-018

### Status

Accepted for the Phase 2 playable ability framework.

### Date

2026-09-04

### Decision

Integrate the existing staged ability runtime into the fixed-step combat arena
through typed combat definitions and a small registered executor boundary.
Represent mana, cooldowns, projectiles, area effects, and refreshing statuses in
the framework-independent simulation; keep Phaser and Preact as presentation
adapters.

### Context

Phase 2 must prove four configurable abilities spanning melee, projectile, area,
buff, debuff, costs, cooldowns, and tags without creating bespoke execution
architectures or a production-scale effect graph. The former P0-009 runtime
already provides validated staged execution, resource/cooldown ports, typed
targets, tag-bearing definitions, and bounded custom executors.

### Options Considered

1. Replace P0-009 with direct combat-arena conditionals.
2. Expand P0-009 into a fully generic combat graph before gameplay integration.
3. Retain the staged runtime and connect it to lean combat-specific primitives.

### Chosen Approach

Choose option 3. Four immutable TypeScript definitions share the existing
request, validation, payment, startup, active, recovery, and completion
pipeline. A registered combat executor interprets a finite typed vocabulary of
cone damage, projectile, area damage, area status, and self status effects.
Damage, geometry, travel, duration, and modifier values live in those effect
parameters rather than ability-id branches. The arena owns current prototype
state and exposes read models/events to Phaser and Preact. Novel future mechanics
may add narrow executor kinds when shared primitives cannot express them clearly.

Player ability requests share one authoritative activation check. Death rejects
all requests, and one player execution may occupy startup, active, or recovery
at a time with no queue; movement and cooldown-only dodge remain independent.
The same framework-independent activation and current-execution read model drives
the HUD's executing, busy, defeated, Mana, and cooldown states.

The Phase 2 set is Basic Cleave (left click), Cinder Dart (Q), Winter Pulse (E),
and Defiant Signal (F). Mana is stored in integer tenths, statuses refresh
without stacking, and damage multipliers floor the final result. Dodge remains
cooldown-only and has no stamina dependency.

### Why

This reuses the tested P0-009 contracts, preserves deterministic core rules, and
proves meaningful gameplay paths with a small implementation surface. Ability
timing, costs, cooldowns, targeting, tags, and effect selection are configured
in shared definitions rather than separate ability classes.

### Tradeoffs

- The playable arena still has one enemy and one combat-specific executor.
- Definitions are typed source data for this prototype rather than canonical
  compiled JSON content.
- Status stacking, resistances, critical strikes, interruption, and advanced
  targeting are deferred.
- Presentation feedback is intentionally simple and is not final art or VFX.

### Systems Affected

- Ability runtime and combat simulation
- Mana, cooldowns, projectiles, areas, and statuses
- Phaser input/rendering and browser automation
- Preact combat HUD
- Unit, component, and browser tests

### Relationship to Earlier Decisions

DEC-010 and DEC-013 remain active. This decision records their first playable
combat integration and does not change the framework-independent simulation
boundary.

---

# DEC-019

### Status

Accepted for the Phase 3 playable item and loot loop.

### Date

2026-09-04

### Decision

Keep authoritative generated items, inventory, equipment, world loot, equipment
stats, ability ownership, and LMB/Q/E/F assignments in the framework-independent
fixed-step core. Use Phaser only to render world drops and route slot input, and
Preact only to present inventory, equipment, tooltips, Ability Stone choices,
and loadout commands.

### Context

Phase 3 must prove that killing an enemy can produce readable randomized loot,
that pickup and equipment change combat-relevant stats, and that lootable
Ability Stones can change combat assignments. The proof must remain small and
testable without introducing the final crafting, economy, item-level, unique
item, flask, or persistence systems.

### Options Considered

1. Store inventory and loadout state in Preact and world drops in Phaser.
2. Build a production-scale canonical item database, save migration, and generic
   modifier engine before exposing a playable loop.
3. Add narrow typed item catalogs and authoritative core state, then expose
   read models and commands to Phaser and Preact.

### Chosen Approach

Choose option 3. Phase 3 uses three equipment bases, six restricted affixes,
three generated rarities, a 12-slot inventory, and three equipment slots.
Equipment does not stack; Ability Stones stack to nine. Seeded generation gives
Common items no affixes, Magic items one affix, and Rare items two distinct
legal affixes. Each enemy kill drops one equipment item, and the first kill
also drops one Ability Stone. Nearby loot transfers atomically to inventory and
remains in the world if capacity is unavailable.

Maximum-health modifiers add flat values. Outgoing ability-damage percentages
add in integer basis points and then multiply temporary status effects, with one
final floor operation. Maximum changes preserve missing health. Arena reset
respawns combat while preserving the run's item/loadout state, uncollected
drops, and unique deterministic loot sequence.

The Phase 2 ability assignments remain executable borrowed defaults. Basic
Cleave is initially owned; consuming a stone creates one of the other
implemented abilities and permits reassignment. The core rejects edits that
would remove the final Basic Cleave slot.

### Why

This produces a complete playable loot decision without making Phaser or Preact
authoritative, preserves deterministic unit and browser automation, and keeps
the implementation proportional to one-enemy vertical-slice content.

### Tradeoffs

- Item and affix catalogs remain immutable typed TypeScript data for this
  prototype rather than new canonical JSON document kinds.
- Inventory, equipment, generated items, and ability ownership are not yet
  included in the IndexedDB character save DTO and are lost on page reload.
- Drops use prototype geometric presentation and automatic proximity pickup.
- Gold, vendors, crafting, item levels, requirements, Unique items, duplicate
  ability rules, and flask mechanics are deferred.
- The borrowed defaults preserve Phase 2 accessibility but are transitional;
  later progression must define the permanent starting loadout.

### Systems Affected

- Item generation, inventory, equipment, stats, and world loot
- Combat input, ability loadouts, health, and damage
- Phaser world presentation and Preact inventory/loadout UI
- Unit, component, and browser tests
- Future content compilation and save-schema work

### Relationship to Earlier Decisions

DEC-010 and DEC-013 continue to govern simulation and ability execution.
DEC-011 remains the long-term canonical content direction; the typed Phase 3
catalog is a documented vertical-slice exception. DEC-014 remains unchanged,
and no Phase 3 item state is claimed to persist.

---

# DEC-020

### Status

Accepted for the Phase 3 owner-requested itemization and loot UX follow-up.

### Date

2026-09-05

### Decision

Expand the Phase 3 item model to nine equipment slots with tiered affixes and
replace automatic loot pickup with player-directed pickup, while keeping all
authoritative state in the framework-independent core.

Specifically:

- Base items declare a slot kind (helmet, chest, amulet, belt, boots,
  main-hand, offhand, ring); the character owns nine concrete slots where the
  ring kind may occupy Ring 1 or Ring 2. Equip commands accept an optional
  explicit target slot, validated for kind compatibility.
- Every rolled affix carries a tier from 1 (best) through 5 (lowest). Each
  affix defines five non-overlapping value ranges; tier N rolls with relative
  weight N, so strong tiers are rare. Common items roll no affixes, Magic one
  or two, Rare three or four distinct legal affixes. Validation rejects
  out-of-range tiers and values.
- Unique rarity exists in the rarity model with an orange presentation color
  but is never generated; enemy loot weights cover Common, Magic, and Rare.
- Walking over loot no longer collects it. F picks up the nearest world drop
  within the pickup radius (raised from 36 to 72); `pickUpDropById` exists in
  the core for a future click-to-pick-up path. Inventory rejection leaves the
  drop in the world untouched.
- Ability slot keys are LMB, Q, E, and R. F is the loot pickup key. The
  keyboard R-reset testing binding is removed; arena reset remains available
  to automation only.
- Phaser renders a compact floating name label above each world drop using the
  base display name, colored white/blue/yellow/orange by rarity, with a dark
  backing and vertical stacking for co-located drops.
- Preact presents an original paper-doll character panel (body column of
  helmet/chest/belt/boots flanked by weapon and offhand, amulet at the neck,
  rings near the hands), pointer-based drag-and-drop equipping and
  unequipping with compatibility highlighting, an accessible click/keyboard
  path including explicit Ring 1/Ring 2 targeting, and T1–T5 markers on affix
  tooltip lines. The I key toggles the menu open and closed outside
  text-entry contexts; Esc still closes.

### Context

The owner reviewed the accepted Phase 3 loop and requested specific
itemization depth (slot coverage, affix tiers) and loot UX changes (manual
pickup, ground name labels, drag-and-drop, direct inventory toggle) before
Phase 4. The three-slot model and auto-pickup were explicit prototype
simplifications; this follow-up replaces them at prototype scale.

### Options Considered

1. Defer slot expansion and tiers to a later itemization phase and patch only
   the UX complaints.
2. Introduce the full production item schema (item level, implicits,
   prefix/suffix split, canonical JSON catalogs) alongside the new slots.
3. Extend the existing typed catalogs and core loadout minimally: slot kinds,
   per-affix tier ranges, targeted equip commands, manual pickup commands, and
   presentation-only labels/drag UI.

### Chosen Approach

Option 3. The typed TypeScript catalogs gain slot kinds, five new bases (one
per new kind: Lookout Casque, Cinchweave Belt, Drifter Treads, Splintered
Buckler, Plain Loopband) and two generic tag-gated affixes (Vigorous, Keen) so
every base has exactly four legal affixes; generation remains seeded and
deterministic. Pickup becomes an explicit core command consumed by the Phaser
input adapter (F key). Loot labels are derived per frame from the core world
loot read model. The Preact menu keeps command/read-model boundaries and adds
only transient UI state (selection, drag, open/closed).

### Why

This satisfies every owner requirement while preserving DEC-019's
architecture: no authority moves into Phaser or Preact, generation stays
deterministic and unit-testable, and the catalog grows only enough to make
each slot obtainable. Tier data lives on the affix definitions, so later
item-level gating can restrict tiers without reshaping instances.

### Tradeoffs

- Catalogs remain typed TypeScript rather than canonical JSON (unchanged
  vertical-slice exception).
- Ground labels always render while a drop exists; no hover-only or
  toggle-label mode yet.
- Click-to-pick-up was deliberately skipped: a label click would double-fire
  the LMB ability through the gameplay pointer handler. `pickUpDropById`
  remains available for a cleaner future integration.
- Rare display names concatenate up to four affix names and are long; ground
  labels avoid this by showing base names, but tooltip naming may need a
  dedicated scheme later.
- Item, equipment, and ability ownership state is still not persisted
  (DEC-014 unchanged); a reload loses Phase 3 state.

### Systems Affected

- Item catalogs, generation, validation, loadout, and equipment stats
- Combat arena simulation (pickup commands), combat input adapter (R/F keys)
- Phaser world loot presentation (name labels) and diagnostics
- Preact inventory/equipment UI, tooltips, and menu input
- Unit, component, and Chromium end-to-end tests
- docs/ITEMIZATION.md and docs/COMBAT.md

### Relationship to Earlier Decisions

DEC-019 remains the governing Phase 3 item architecture; this decision extends
its scope without moving authority. DEC-010/DEC-013 simulation and ability
rules are unchanged. DEC-011 canonical content and DEC-014 persistence
directions are unchanged.

---

# DEC-021

### Status

Accepted for the Phase 3 inventory-capacity and common-affix follow-up.

### Date

2026-09-05

### Decision

Increase inventory capacity to 48 scrollable slots, give Common equipment
exactly one rolled affix, move the inventory toggle above the HP/MP/XP
vitals, and remove the inventory-screen Character summary.

This supersedes the DEC-019/DEC-020 12-slot capacity and the rule that Common
items roll no affixes. Magic remains 1–2 affixes and Rare remains 3–4.

### Why

The 12-slot bag filled immediately in play, Common drops could appear with no
stats at all, and the Character block belongs on a later dedicated character
screen rather than inside inventory.

### Tradeoffs

- A 48-slot bag is still a prototype bound, not unlimited storage.
- Common and Magic can both roll a single affix; rarity still distinguishes
  Magic's chance at a second affix and its blue presentation.
- Character-derived health and damage totals are no longer shown in the
  inventory menu until the Phase 4 character screen exists.

### Systems Affected

- Inventory capacity and item generation
- Preact inventory/HUD layout
- docs/ITEMIZATION.md and docs/ROADMAP.md

### Relationship to Earlier Decisions

DEC-019 and DEC-020 remain the governing Phase 3 architecture except where
this decision changes inventory size and Common affix count.
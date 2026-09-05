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

---

# DEC-022

### Status

Accepted for adding life and mana flasks to the Phase 3 drop pool.

### Date

2026-09-05

### Decision

Heartwell Flask and Mindwell Flask are generatable items that share gear
rarity and T1–T5 affix rules, occupy the four flask slots, and never
contribute to character health or ability-damage stats. Enemy kills draw
from the combined gear-and-flask base catalog. Flask use with keys 1–4
remains deferred.

Flask-only affixes are original recovery and charge modifiers inspired by
ARPG flask design, not copies of another game's names or proprietary
wording.

### Systems Affected

- Item catalogs, generation, loot, loadout, inventory UI, and combat HUD

### Relationship to Earlier Decisions

DEC-019 through DEC-021 remain the governing Phase 3 item architecture.

---

# DEC-023

### Status

Accepted for the Phase 4 playable character-progression loop.

### Date

2026-09-05

### Decision

Keep XP, levels, attributes, masteries, and respec in the
framework-independent core. Enemy kills grant a fixed 20 experience. The
level curve is `40 + 20 × (level − 1)` with no hardcoded cap. A new
character starts at level 1 with 2 attribute points and 1 mastery point;
each later level awards the same amounts.

The four attributes are Strength, Dexterity, Vitality, and Intelligence.
They add outgoing ability damage, move speed, maximum health, and
maximum mana. Eight three-rank original masteries add shared or
ability-specific bonuses. Restore Training refunds every spent point for
free. Generated Common and Magic items require level 1; Rares require
level 2.

The C key and a button to the right of Inventory open the character
screen. Combat loadout assignment lives there. The compact XP meter
shows real experience. Progression is not added to the IndexedDB save
DTO.

### Context

Phase 3 proved loot and equipment. Phase 4 must prove that killing
enemies improves the character through a readable spend-and-respec loop
without building a giant tree or persisting a career.

### Options Considered

1. Automatic stat gains on level-up with no spend decisions.
2. A large passive tree and item-level gating before the spend loop is
   proven.
3. A small core-owned progression object, a compact mastery catalog, and
   a dedicated character screen that also hosts loadout assignment.

### Chosen Approach

Option 3. Core owns `CharacterProgression`. Combat composes equipment
and progression bonuses. Preact observes read models and emits spend,
respec, and assign-ability commands.

### Why

This keeps Phaser and Preact non-authoritative, stays inside the
vertical-slice bound, and makes the C screen useful on the first launch.

### Tradeoffs

- XP comes only from enemy kills in this prototype.
- Respec is free and unlimited.
- Item requirements are rarity-based, not a full item-level system.
- Progression is lost on reload (DEC-014 unchanged).

### Systems Affected

- Progression, combat stats, mana, movement speed, and equip validation
- Item generation required-level field
- Combat HUD XP meter and Preact character screen
- Unit, component, and browser tests

### Relationship to Earlier Decisions

DEC-010 and DEC-013 continue to govern simulation and ability execution.
DEC-019 through DEC-022 remain the item architecture. DEC-014 remains
unchanged.

---

# DEC-024

### Status

Accepted for the Phase 5 playable Mining and Smithing loop.

### Date

2026-09-05

### Decision

Keep profession XP, materials, nodes, and recipes in the
framework-independent core. Mining and Smithing use the curve
`20 + 10 × (level − 1)` and stay independent of combat level.

The current arena hosts two geometric ore nodes and one forge. F is a
shared interact: loot pickup wins when a drop is in range, otherwise the
nearest node or forge. Gathering is a short channel cancelled by
movement, dodge, ability use, or incoming damage. Nodes have charges and
respawn.

Smithing recipes consume stacked ore and produce equipment from a
crafted-only catalog. Those bases never enter the enemy drop pool.
Crafted items are ordinary equipment instances with `origin: "crafted"`.
The Character screen shows profession levels. Opening the forge shows a
Preact recipe menu.

Art stays geometric. Sprite import is deferred. Profession state is not
added to the IndexedDB save DTO.

### Context

Phase 4 proved combat XP and spendable attributes. Phase 5 must prove
that gathering and crafting feed the same equipment loop without waiting
on sprites or building a town.

### Options Considered

1. Wait for character and node sprites before any profession work.
2. Build a town-and-vendor crafting loop before Mining exists.
3. A thin gather → smith → equip loop in the current arena with
   geometric placeholders and a crafted-only item catalog.

### Chosen Approach

Option 3. Core owns `ProfessionProgression`, material stacks, nodes, and
recipes. Combat composes interact, gather, and craft. Preact observes
read models and emits craft or close-forge commands.

### Why

This keeps Phaser and Preact non-authoritative, stays inside the
vertical-slice bound, and lets the profession loop be proven before art
import or Phase 6 world content.

### Tradeoffs

- Only Mining and Smithing exist.
- Two ores and three recipes.
- No gold, no flask drinking, no persistence.
- Nodes and the forge are shapes, not sprites.

### Systems Affected

- Profession XP, materials, inventory stacking
- Combat interact, gathering, and forge state
- Crafted-only equipment bases and item generation origin
- Combat HUD gathering line, Character professions, and forge menu
- Unit, component, and browser tests

### Relationship to Earlier Decisions

DEC-010 and DEC-013 continue to govern simulation and ability execution.
DEC-019 through DEC-023 remain the item and progression architecture.
DEC-014 remains unchanged.

---

# DEC-025

### Status

Accepted for the Phase 6 world-session gate.

### Date

2026-09-05

### Decision

Keep the first vertical-slice world as three core-owned geometric zones
with a portal graph: Hearthmere (safe town), Ashtrail Expanse
(wilderness), and Hollowdeep (dungeon). Character inventory, combat XP,
and profession XP survive travel. `reset()` returns to Ashtrail so
existing combat tests stay valid. The playable session starts in
Hearthmere.

Town content is a barter vendor (Veinshard for stock gear), a second
forge, and one Roadwarden quest that completes when the Hollowdeep
Bruiser dies. Zones stay shapes. DEC-012 Tiled combat integration, five
normal enemy types, a boss, and a minimap remain later Phase 6 work.

### Context

Phase 5 proved gather and craft inside one arena. Phase 6 must prove
travel and a town hub before authoring production Tiled maps or adding
sprite art.

### Options Considered

1. Author three Tiled maps and move combat onto compiled zone bundles now.
2. Wait for sprites before any town or dungeon exists.
3. A geometric zone session that reuses the current combat simulation.

### Chosen Approach

Option 3. Core owns `ZONE_CATALOG` and quest/vendor contracts. Combat
swaps the current zone profile, enemy, and interactables. Preact shows
zone name, quest stage, and the vendor menu.

### Why

This keeps Phaser and Preact non-authoritative, preserves Phase 1–5
combat tests, and lets the world loop be proven before Tiled combat
integration.

### Tradeoffs

- Gameplay zones are not yet compiled Tiled bundles (DEC-012 still
  governs the intended production path).
- Only one elite exists; five normal types and a boss are not in this
  gate. Later Phase 6 work is recorded in DEC-026.
- Gold is still absent; the vendor barters ore.

### Systems Affected

- Combat arena zone travel, interactables, and quest state
- Combat HUD zone/quest line and Preact vendor menu
- Unit, component, and browser tests

### Relationship to Earlier Decisions

DEC-012 remains the intended authored-zone architecture. This decision
is a geometric stand-in for the first playable world loop, not a
replacement. DEC-014 remains unchanged. DEC-026 extends this gate with
multi-enemy encounters, a boss, and a minimap.

---

# DEC-026

### Status

Accepted for the Phase 6 encounter and minimap increment.

### Date

2026-09-05

### Decision

The combat arena simulates every living enemy in the current zone, not
one shared prototype. `reset()` and `new CombatArenaSimulation()` still
spawn only the Ashtrail prototype so Phase 1–5 combat tests stay valid.
Traveling into a catalog zone loads that zone's encounter list.

Ashtrail Expanse has a three-Gnasher white pack and one Ashtrail Brute
elite. Hollowdeep keeps the Bruiser as the quest elite and adds
Embercleft as a south-side boss. Enemies use an aggro radius so packs
and the boss stay leashed until the player approaches.

`diagnostics().enemy` remains the first encounter entry (or the reset
prototype). `diagnostics().enemies`, `targets`, and `minimap` expose the
full set. A compact top-right Preact minimap observes that read model.

### Context

DEC-025 shipped a three-zone session with one enemy at a time. The
owner asked for the minimap, a boss, and a white pack plus elite in the
first wilderness zone.

### Options Considered

1. Keep one live enemy and fake the pack in presentation only.
2. Replace the arena with a new encounter manager.
3. Grow the existing melee enemy and zone catalog into a multi-enemy
   list with a compatibility primary.

### Chosen Approach

Option 3. Ranks (`normal`, `elite`, `boss`) and optional aggro live on
`SimpleMeleeEnemyConfig`. Cleave and area effects hit every enemy in
range. Projectiles still resolve the first sweep hit.

### Why

This is the smallest change that makes a pack, elite, and boss real in
core, while preserving `diagnostics().enemy` for existing combat and
quest tests.

### Tradeoffs

- Enemies still share one melee brain. Embercleft is a heavier melee
  boss, not a multi-phase encounter.
- Ashtrail whites are one type, not five distinct normals.
- Gameplay zones remain geometric. DEC-012 still owns Tiled combat maps.

### Systems Affected

- Simple melee enemy ranks, experience, and aggro
- Combat arena encounter list, damage, and minimap read model
- Phaser enemy drawing and Preact top-right minimap
- World session unit, component, and browser tests

### Relationship to Earlier Decisions

Extends DEC-025. Does not replace DEC-012. DEC-014 remains unchanged.
DEC-027 closes Phase 6 with the owner-accepted geometric slice.

---

# DEC-027

### Status

Accepted. Completes Phase 6.

### Date

2026-09-05

### Decision

Phase 6 is complete with the geometric world session: town, wilderness,
dungeon, vendor, one quest, a white pack, one elite, one boss, and a
compact top-right minimap whose walkable-area border is visible. The
minimap walkable rect is the arena clamp inset (player radius), filled
with the current zone floor color and stroked with the zone edge color.

Five distinct normal enemy types and Tiled compiled gameplay maps stay
deferred. Those were original Phase 6 candidates; the owner accepted
this slice and asked to close the phase after the walkable border.

### Context

DEC-025 and DEC-026 already shipped travel, encounters, and a minimap.
The remaining visible gap was that the map floor had no readable border,
so the walkable limit was unclear.

### Options Considered

1. Keep Phase 6 open until five unique normals and Tiled zones exist.
2. Close Phase 6 on the current geometric loop after the walkable
   border, and move leftover content to later phases.

### Chosen Approach

Option 2, by owner request.

### Why

The vertical-slice loop is playable: combat, loot, progression, gather,
craft, travel, quest, vendor, pack, elite, and boss. Remaining content
volume and DEC-012 authored maps do not need to block Phase 7 polish.

### Tradeoffs

- Ashtrail whites are one Gnasher type, not five distinct normals.
- Zones are still core-owned shapes, not compiled Tiled bundles.

### Systems Affected

- Minimap walkable bounds and zone-colored floor/edge
- Phase 6 roadmap status

### Relationship to Earlier Decisions

Closes the Phase 6 work started in DEC-025 and DEC-026. DEC-012 remains
the intended production zone path. DEC-014 remains unchanged.

---

# DEC-028

### Status

Accepted.

### Date

2026-09-05

### Decision

The player renders as the owner-authored barbarian spritesheets instead
of the placeholder circle. The sheets live in
`public/assets/characters/barbarian/` as 1920x1024 PNGs: a 15-column,
8-row grid of 128x128 frames, one row per screen-space facing ordered
clockwise (screen y down) from east (E, SE, S, SW, W, NW, N, NE).

`BarbarianSpritePresentation` (Phaser adapter) loads five sheets on
demand — Idle, Run, Attack1, Rolling, Die — and picks an animation from
combat diagnostics: death, dodge roll, attack, then locomotion. The
character faces the direction of movement, not the cursor; standing
still keeps the last movement facing, and only attacks orient toward
the aim (owner-corrected on 2026-09-05 from an earlier aim-locked
facing with backpedal/strafe sheets, which were removed). The sprite
anchors at the feet (y=90 of 128) on the ground-shadow center at 1.3x
scale. Until textures finish loading the old circle-and-facing-line
fallback draws, so boot diagnostics never regress.

### Context

The owner supplied barbarian spritesheets generated from their character
creator and asked for the barbarian as the player character. The roadmap
Phase 7 note explicitly reserved this import for owner-provided art.

### Options Considered

1. Face the aim direction at all times, using the backpedal and strafe
   sheets for off-aim movement.
2. Face the movement direction while moving, with attacks orienting to
   the aim.
3. Move sprite state into the core simulation as a first-class model.

### Chosen Approach

Option 2, presentation-only, per owner playtest feedback (option 1 was
shipped first and corrected the same day). The core simulation is
untouched; the sprite is a pure read of existing diagnostics
(movement/aim/dodge/attack/death), and new presentation diagnostics
(`playerSpriteReady`, `playerAnimation`, `playerDirectionRow`) make the
selection testable end to end.

### Why

The owner wants the character to read as running where WASD points.
Keeping selection in the adapter honors the simulation/presentation
split from DEC-005.

### Tradeoffs

- Enemies, interactables, and zones remain geometric placeholders.
- The frame-aligned shadow and attack-effect companion sheets render as
  synced layers under/over the body (owner-requested 2026-09-05); the
  flat ellipse shadow now only backs the pre-load fallback. Effect
  sheets for the unused animations stay unimported.
- No per-entity isometric depth sorting yet; the player always draws
  above interactables, as the circle did.

### Systems Affected

- New `src/adapters/phaser/barbarian-sprite.ts`
- Combat arena presentation player rendering and diagnostics
- New `tests/e2e/player-sprite.spec.ts`

### Relationship to Earlier Decisions

Fulfills the character-art import reserved in the Phase 7 roadmap note.
Presentation-only per DEC-005; DEC-012 (Tiled zones) and enemy visuals
remain future work.

---

# DEC-029

### Status

Accepted.

### Date

2026-09-05

### Decision

Fantasy UI theme — a CSS-first design-token restyle of the in-game shell.
`src/presentation/styles.css` defines the theme once as `:root` custom
properties (`--ui-panel-bg`, `--ui-border`, `--ui-accent`, `--ui-text`,
and companions for surfaces, frames, text tiers, keycaps, and functional
states), and every restyled rule consumes those tokens. The palette moves
from the dark-blue diagnostic look to deep charcoal/umber panel
backgrounds, aged-brass borders, ember-gold accents, and warm
parchment-toned text. A shared framed-panel treatment (brass outer
border, dark inlay and inner hairline via inset shadows, warm vignette
gradient, and ember-gold corner brackets drawn by an absolutely
positioned pseudo-element) styles the diagnostic overlay, vitals, ability
bar, minimap frame, paused overlay, and all menu dialogs. Headings use a
system serif stack ("Palatino Linotype", Palatino, "Book Antiqua",
Georgia, serif); no font is vendored, no CDN fonts, no external asset
packs, and no raster UI images. Rarity colors (magic `#6da5ff`, rare
`#f0c75e`, unique `#ff8000`) and the health/mana/XP bar fills are
preserved exactly as tokens; minimap zone floor/edge colors remain
simulation data delivered as inline SVG attributes and are never set
from CSS.

### Context

Phase 7 kickoff (TASK-701) asked for an original fantasy visual identity
to replace the diagnostic styling, with no behavior changes, no
copyrighted assets, and stable class names, roles, and test ids so the
existing unit, component, and e2e suites keep passing.

### Options Considered

1. Vendor one OFL display typeface via `@font-face` for headings.
2. Use a well-chosen system serif stack for headings, no vendored file.
3. Raster panel artwork (nine-slice images) for the framed-panel look.

### Chosen Approach

Option 2 for typography and pure CSS (borders, shadows, gradients) for
the panel treatment. Every class name, role, aria label, and data-testid
was kept stable, and `App.tsx` needed zero changes; the restyle is
entirely inside `styles.css`.

### Why

The system serif stack ships no binary asset and carries zero licensing
risk while still reading as a fantasy heading face on all target
desktop platforms; the packet explicitly allows it. CSS-only panel
ornaments keep the theme resolution-independent and diffable, and
avoiding markup changes eliminated test churn entirely.

### Tradeoffs

- Heading rendering varies slightly across platforms (Palatino Linotype
  on Windows, Palatino/Georgia elsewhere). A vendored OFL display font
  can later drop in by changing only `--ui-font-heading` plus one
  `@font-face` rule.
- The Phase 0 persistence/automation diagnostic panels received token
  inheritance only, not the full framed treatment (they are test-only
  surfaces, per the packet's out-of-scope list).

### Systems Affected

- `src/presentation/styles.css` (only file changed).

### Relationship to Earlier Decisions

Presentation-only; the DEC-005 core/presentation boundary is unchanged.
Rarity colors from the DEC-020 loot UI and the simulation-fed minimap
zone colors from DEC-027 are preserved exactly. First accepted packet of
the Phase 7 kickoff (TASK-701).

---

# DEC-030

### Status

Accepted.

### Date

2026-09-05

### Decision

Tutorial zone and core-owned tutorial progression. Wakeshore Landing
(`zone:wakeshore-landing`) is the fourth `ZONE_CATALOG` zone, an
unsafe wilderness containing exactly one very weak normal melee enemy
(the Wakeshore Scuttler: 18 health, 2 damage, slow cadence, 150 aggro
leash), one tutorial-only Veinshard ore node, and one exit portal to
Hearthmere. No vendor, forge, or quest giver. `ZoneKind` is unchanged.

A new core module (`src/core/tutorial.ts`) follows the quest-stage
pattern: an ordered six-step list (move, attack, dodge, loot, gather,
travel) defined as core data with core-owned prompt copy, and a
`TutorialTracker` that observes simulation verbs. Steps advance
strictly in order; out-of-order actions neither advance nor break the
sequence. The tracker is receptive only while the tutorial zone is
current: entering shows the current step, leaving hides prompts but
keeps progress, and re-entry after completion shows nothing. The exit
portal always works regardless of progress — walking out IS the skip
mechanism; nothing gates input and no dedicated skip UI exists.

Tutorial state (step id, prompt, completed count/total) is exposed
through `diagnostics()` and a nullable `tutorial` field on the combat
HUD read model, forwarded by the Phaser adapter exactly like zone name
and quest label. One new framed prompt block in `App.tsx` renders it
top-center using the DEC-029 design tokens. The gather lookup now
resolves ore nodes from the current zone's node list (the tutorial
node deliberately stays out of `ORE_NODE_CATALOG`, which Ashtrail
consumes wholesale), with identical behavior for all existing zones.

### Context

Phase 7 kickoff (TASK-702) asked for a small landing zone where a fresh
character learns the core verbs via staged prompts before reaching
Hearthmere, without touching `reset()` or session-start semantics that
Phase 1–6 tests depend on.

### Options Considered

1. A presentation-layer tutorial (prompt copy and step logic in Preact).
2. A new `"tutorial"` `ZoneKind` union member.
3. A core data module following the quest-stage pattern, with the zone
   as a plain wilderness catalog entry.

### Chosen Approach

Option 3. Core owns the step list, copy, ordering, and activation;
Phaser only forwards a read model; Preact only renders it. The zone
stays `"wilderness"` because nothing needed a new kind.

### Why

Keeping copy and ordering in core data preserves the DEC-005 boundary,
makes the sequence unit-testable without a browser, and mirrors how
`QuestDefinition.summary` already owns player-facing quest text.

### Tradeoffs

- Strict ordering means a verb performed early (for example picking up
  the only loot drop during the dodge step) is not banked, and that
  step can strand until the node/portal path is used; the always-open
  exit portal is the escape hatch.
- Tutorial completion is not persisted (per packet; persistence is
  TASK-705 territory).
- The tutorial enemy reuses the shared melee brain and geometric
  rendering; no bespoke art or behavior.

### Systems Affected

- Zone catalog (`world-zones.ts`) and new `tutorial.ts` core module
- Combat arena tracker integration, node lookup, and diagnostics
- Shell contracts, Phaser HUD forwarding, `App.tsx` prompt block,
  additive `styles.css` rules
- New tutorial unit tests and `tests/e2e/tutorial.spec.ts`

### Relationship to Earlier Decisions

`reset()` still spawns the Ashtrail prototype and the playable session
still starts in Hearthmere (DEC-025/026/027 unchanged). Consumes the
DEC-029 design tokens. Second accepted packet of the Phase 7 kickoff
(TASK-702); TASK-703's New Game flow will travel into this zone.

### Amended 2026-09-05 (TASK-702B, owner-directed)

The owner ruled that the exit portal must not appear until the tutorial
is effectively complete, which supersedes the "always-open portal is
the skip mechanism" paragraph above and the strict-ordering strand
tradeoff:

- **Gated portal.** The Hearthmere Road portal in Wakeshore Landing is
  hidden and non-interactable — absent from the interactables read
  model, the minimap, and F-interaction — until the five non-travel
  steps (move, attack, dodge, loot, gather) are all complete. It
  appears exactly when `travel` becomes the active prompt, and
  immediately on re-entry after full completion. Other zones' portals
  are untouched (one `visiblePortals` filter in the combat arena).
- **Banked completion.** Because the portal no longer offers an escape
  from a stranded state, `TutorialTracker` now banks every verb the
  moment it is performed in-zone, regardless of order; the prompt
  always shows the first incomplete step in the canonical order. There
  is no dedicated skip anymore — the tutorial is short enough that
  finishing it IS the exit.
- **Strand-proofing.** No action sequence can strand a step: move and
  dodge are always available; the scuttler's death banks attack at the
  instant it dies (the player is its only damage source) and every
  kill drops at least one item through the deterministic loot
  generator, so a pickup (which banks loot) is always available in the
  visit where the kill happened; the ore node self-respawns its
  charges; and each zone entry respawns the scuttler and clears stale
  ground loot, so progress banked across visits can always be resumed.
  No enemy-respawn timer was needed.
- The read model gained `stepNumber` (canonical position of the
  displayed step, which the HUD heading now uses) and `exitUnlocked`;
  `stepsCompleted` now counts banked steps. All other TASK-702
  semantics (activation only in-zone, `reset()` clearing, core-owned
  copy, TASK-703's New Game flow) are unchanged.

---

# DEC-031

### Status

Accepted.

### Date

2026-09-05

### Decision

Main-menu overlay state machine and "Loot Divers" branding. The shell
boots in a `menu` state: a full-screen Preact overlay (`MainMenu` in
`App.tsx`, driven by a `showMainMenu` prop from `main.tsx`) rendered
above the paused simulation. Phaser boot, the WebGL2 preflight, and boot
diagnostics are unchanged; while the menu is up the canvas is simply
never focused, so the existing focus-gated runner keeps the simulation
paused and gameplay menu shortcuts are inert. "New Game" dispatches a
new `world.travel` member of `WorldUiCommand` through the existing
`rarpg:world-command` event path (the adapter delegates to the same
validated `travelTo` the automation hook uses), dismisses the menu, and
focuses the canvas so input goes live in the tutorial zone with its
first prompt showing. "Continue" is visible but disabled ("No saved
hero yet") with zero persistence code behind it. Escape/pause behavior
is unchanged; there is no pause-to-menu flow.

**Automation bypass:** a `?autostart` query parameter (alongside the
existing `automation`/`fullFixture`/`persistenceTest` parameters in
`main.tsx`) skips the menu and reproduces the exact pre-menu boot,
including the initial canvas focus. Every pre-existing combat-mode e2e
spec adds `?autostart` to its `page.goto` call (19 one-line edits);
`boot.spec.ts` intentionally keeps a plain `/` load so the production
boot check also covers the real-player menu boot. Real players (no
query parameters) always see the menu; the new
`tests/e2e/main-menu.spec.ts` covers both paths. The explicit query
parameter was chosen over sniffing `__RARPG_COMBAT_TEST__` usage or
`navigator.webdriver` because several specs click or focus the canvas
before ever touching the automation hook, and the menu spec must be
able to exercise the true player-default path under Playwright.

**Branding:** the game is titled "Loot Divers" (owner decision,
superseding the "RARPG" working title). The owner's pixel-art title
logo and treasure-chest emblem live at
`public/assets/branding/logo.png` and
`public/assets/branding/favicon.png`; the logo is the menu's title art
and the emblem is the favicon, with the page `<title>` set to "Loot
Divers". The PNGs are referenced at source size (they are not
integer-grid pixel upscales, so a lossless downscale is impossible).
In-game diagnostic surfaces (e.g. the "RARPG Phase 6 vertical slice"
header) keep the working title for a future branding pass.

**Continue/save deferral:** the persistence subsystem serializes only
the Phase 0 synthetic fixture envelope; there is no character
snapshot/restore anywhere. A real character save DTO (progression,
generated items with affixes, loadout, equipment, materials, profession
XP, quest stage, tutorial completion, current zone) is TASK-705, owned
by the Gameplay Engineer with the Systems Designer as required schema
reviewer, reusing the DEC-014 generation/checksum/migration machinery.
DEC-014 is unchanged.

### Context

Phase 7 kickoff (TASK-703) asked for a boot-time fantasy main menu that
gates entry, starts a fresh character in the tutorial zone, reserves a
disabled Continue slot, and keeps every existing automation suite green.

### Options Considered

1. Menu bypass by auto-dismissing on first `__RARPG_COMBAT_TEST__` call.
2. Menu bypass via `navigator.webdriver` detection.
3. Explicit `?autostart` query parameter applied by existing specs.
4. New Game travel via a bespoke shell intent handled in `main.tsx`
   versus a new `WorldUiCommand` member on the existing event path.

### Chosen Approach

Option 3 for the bypass and the `WorldUiCommand` extension for travel.

### Why

Specs that click or focus the canvas before driving the hook would race
option 1; option 2 would hide the menu from the very spec that must
test it. The query parameter is explicit, keeps real-player semantics
untouched, and cost only mechanical one-line spec edits. Reusing the
world-command event keeps the UI presentation-only and gives the menu
the same zone-id validation as every other travel caller.

### Tradeoffs

- The menu backdrop is intentionally near-opaque, so the paused world
  is not visible behind it (cleaner showpiece, less HUD bleed-through).
- The favicon PNG is ~1 MB; acceptable locally, worth revisiting before
  web deployment (GitHub-hosted images are already planned).
- Idling at the menu keeps the Hearthmere session at tick 0 rather than
  a dedicated menu scene; acceptable because the simulation is fully
  paused and New Game travels regardless of elapsed wall time.

### Systems Affected

- `src/presentation/App.tsx` (MainMenu component, menu shell state)
- `src/presentation/shell-contracts.ts` (`world.travel` command)
- `src/main.tsx` (`?autostart` wiring, menu-conditional canvas focus)
- `src/presentation/styles.css` (additive menu rules on DEC-029 tokens)
- `src/adapters/phaser/combat-arena-presentation.ts` (travel delegation)
- `index.html` (title, favicon), `public/assets/branding/`
- New `tests/e2e/main-menu.spec.ts`; `?autostart` in existing specs;
  menu component tests in `tests/browser/ui-shell.component.test.tsx`

### Relationship to Earlier Decisions

The DEC-005 core/presentation boundary is unchanged (core untouched).
Consumes DEC-029 tokens as the theme's showpiece and travels into the
DEC-030 tutorial zone. DEC-014 persistence architecture is unchanged;
Continue ships with TASK-705. Third accepted packet of the Phase 7
kickoff (TASK-703), pending the TASK-704 QA gate.

---

# DEC-032

### Status

Accepted with owner sign-off on 2026-09-05: Cloudflare Pages for the game
site, the owner's existing DigitalOcean droplet + Postgres for the
backend, Cloudflare DNS/proxy for the domain split, and custom-domain
attachment to the Pages project. Pending details (not decisions): the
exact domain string (documents use `<yourdomain.com>` placeholders) and
the droplet facts (OS/RAM/IP/occupied ports) gathered in the owner
runbook's first step.

### Date

2026-09-05

### Decision

**Site hosting:** deploy the static Vite artifact to Cloudflare Pages from
the existing GitHub Actions gate — the deploy job publishes the exact
tested `dist/` artifact on green main pushes only, with immutable cache
headers for hashed assets and no-cache for `index.html`. The Vite base
path stays `/`; `?autostart` and the other DEC-031 query parameters work
identically on the deployed origin. The owner's purchased domain (DNS
already on Cloudflare) attaches to the Pages project at the apex and
`www`.

**Backend:** self-hosted on the owner's existing DigitalOcean droplet — a
Node/TypeScript API using Fastify, Postgres, and a Caddy reverse proxy,
all run via Docker Compose, served at `api.<yourdomain.com>` behind the
Cloudflare proxy in Full (strict) mode with a Cloudflare Origin CA
certificate on the droplet. Auth is owned and minimal: email/password with
argon2id hashing and opaque hashed session tokens in HttpOnly cookies.
Deployment is GitHub Actions over SSH as a dedicated low-privilege deploy
user running a repo-shipped pull-and-restart script. This supersedes the
plan draft's Supabase recommendation by owner directive. The owner's
manual steps (DNS records, Pages project, secrets, droplet hardening,
Docker, origin certificate, deploy user, backups) are specified in
`/docs/OWNER-SETUP-RUNBOOK.md`.

**Binding architectural stance:** the character save DTO (TASK-705) is
client-defined and backend-agnostic. The backend stores and returns
versioned, checksummed character envelopes plus identity; it never parses
payloads, never migrates blobs (migrations run client-side via the
DEC-014 ordered-migration machinery), and owns no game logic in this
phase. Server-side enforcement is limited to authentication, row
ownership, envelope-shape sanity, a size cap, and auth rate limiting.
Conflict policy is last-write-wins with a one-deep server-side revision
history.

**Economy trajectory:** the owner intends this infrastructure to
eventually track player gold, progress, characters, and an auction house.
The v1 schema positions for that without building it: `users` and
`characters` carry stable UUID keys from day one; when gold ships as a
game feature it lives inside the character blob; when trading/auction
house arrives, a documented extraction path adds `wallets` and append-only
`ledger_entries` tables, backfills balances from blobs once, and makes the
server authoritative for gold thereafter. The auction house itself is a
separate future epic with its own decision record and is explicitly not
part of Phase 7 work (vertical-slice rule).

**Trust model:** single-player trust. Anti-cheat and server-side
validation of save contents are explicitly out of scope until a shared
economy, trading, leaderboards, or multiplayer exist; whichever feature
introduces shared state must introduce server-authoritative handling of
that state (starting with the ledger extraction above) and must not treat
the blob store as sufficient.

### Context

Phase 7 reached the point (post TASK-704, GitHub remote and CI live at
`8d90245`) where the owner wants the site and database/accounts
groundwork before TASK-705 and saved progress. The game is a pure static
artifact (~1.57 MB JS + ~7 MB PNGs) with a deterministic,
framework-independent core and a DEC-014 envelope persistence layer that
generalizes directly to a character blob. The owner holds an existing
DigitalOcean droplet, a purchased domain with DNS on Cloudflare, and an
explicit desire for owned infrastructure that can grow into economy
tracking and an auction house.

### Options Considered

Hosting: GitHub Pages, Cloudflare Pages, Netlify, Vercel, DigitalOcean
(App Platform static / droplet). Backend: Supabase (Postgres + auth,
the Director's original recommendation), Firebase (Auth + Firestore),
Cloudflare Workers + D1/KV, self-hosted Node/Postgres on the owner's
DigitalOcean droplet. Full comparisons are recorded in
`/docs/tasks/PHASE7-INFRA-PLAN.md` §1.2 and §2.2.

### Chosen Approach

Cloudflare Pages for the static site (apex/`www` of the owner's domain);
self-hosted Fastify + Postgres in Docker Compose on the owner's droplet
behind a Cloudflare-proxied `api` subdomain, used strictly as a blob
store behind a client-owned `SaveGateway` port with IndexedDB as the
sibling local adapter.

### Why

Cloudflare Pages is the only zero-cost host with unlimited static
bandwidth, zero base-path churn now or after the custom domain, and cache
header control. For the backend, the owner overrode the managed-service
recommendation with grounds the Director accepts: the droplet is already
paid for (the Supabase pitch's main advantage was avoiding new cost/ops
for a v1 blob store), and the stated auction-house/economy trajectory
means a real owned API server becomes necessary anyway — building on it
now avoids a later Supabase-to-droplet migration and keeps all player
data under the owner's control. Fastify fits a repo whose validation
idiom is already JSON Schema/Ajv (DEC-011) at minimal dependency cost;
Docker Compose gives a solo owner a reproducible one-file stack with a
single volume to back up; Cloudflare Origin CA + Full (strict) is the
simplest correct TLS for a proxied-only origin (15-year cert, no renewal
automation); SSH pull-and-restart deploys avoid a container registry
while keeping a by-hand fallback.

### Tradeoffs

- The project now owns auth, TLS, backups, and patching — the
  security-sensitive surface the Supabase path avoided. Mitigations:
  argon2id + hashed opaque tokens (no JWT), a hardened droplet
  (dedicated users, key-only SSH, ufw, unattended-upgrades), Cloudflare
  proxy in front, daily dumps with a tested restore drill, and email
  verification/password reset deferred rather than half-built.
- Droplet cost (~$6+/month) is accepted as already sunk by the owner.
- A single droplet is a single point of failure with no staging
  environment; acceptable at hobby scale, revisit before the auction
  house epic.
- Last-write-wins can lose progress across simultaneous devices; the
  one-deep revision history is the recovery hatch, and merge UX is
  deferred.
- Client-side saves remain user-tamperable by design (documented trust
  model); nothing here is reusable as an economy-integrity mechanism
  until the ledger extraction lands.
- The roadmap's "host images on GitHub" bandwidth hedge is dropped as
  unnecessary under Cloudflare's bandwidth terms.

### Systems Affected

- CI/CD workflows (Pages deploy job now; API build/deploy jobs in
  TASK-707)
- New `server/` workspace (TASK-707) and droplet runtime
- Persistence (`SaveGateway` port, HTTP adapter in TASK-707)
- Main menu (auth UI, Continue)
- docs/ROADMAP.md Final Phase hosting/backend wording
- `/docs/OWNER-SETUP-RUNBOOK.md` (owner-executed infrastructure steps)

### Relationship to Earlier Decisions

DEC-015's immutable-artifact promotion is implemented (gate artifact →
deploy). DEC-017's deferred public-HTTPS obligation is discharged by
TASK-706. DEC-014 persistence machinery is reused unchanged in
direction; DEC-031's Continue deferral resolves via TASK-705. DEC-001
(single-player first) governs the trust model; the auction house remains
a deferred system requiring its own approval per the roadmap. Supersedes
the roadmap Final Phase's "DigitalOcean for the website / GitHub-hosted
images" wording: the droplet hosts the API, Cloudflare Pages hosts the
site and assets.

# DEC-033

## GitHub Actions CI scope: no Firefox e2e, hardware-sensitive specs skip on CI

Date: 2026-09-05

## Decision

The GitHub Actions gate (`.github/workflows/ci.yml`) runs the e2e suite on
chromium, edge, and webkit only, and ten hardware-sensitive specs skip
themselves when `CI` is set in the environment. The authoritative pre-merge
gate remains the full local four-browser matrix (chromium, edge, firefox,
webkit) with no skips, as exercised by QA and task owners.

## Reason

CI run #5 (the first full run on `main`) failed with 51 e2e failures traced
to two GitHub-hosted-runner limitations, not product defects:

1. Runners have no GPU, and headless Linux Firefox exposes no WebGL at all.
   The boot support gate correctly reports `data-app-state="unsupported"`,
   so all 37 Firefox specs fail. The game genuinely cannot run there.
2. Under software rendering the runner is slow enough that specs sampling
   transient mid-simulation state (pre-hit attack snapshots), frame-timing
   diagnostics, or pixel-exact canvas readbacks    fail systematically:
   `combat-arena` 27/286/566(480x720), `entity-lifecycle` "samples
   allocation and frame diagnostics" and "releases and reacquires one
   actor without stale ownership" (20 cycleActor rounds exceed the 30 s
   budget under software rendering, CI run #6) and "matches deterministic
   full fixture presentation" (screenshot baseline never stabilizes under
   software rendering, CI run #7), `isometric-world` 276(webkit)/323, and
   `item-loot-loop` 32 (webkit).

Skips are annotated inline with `DEC-033` and use the existing
`test.skip(condition, reason)` idiom (precedent: the chromium-only visual
baseline in `isometric-world.spec.ts`).

## Alternatives Considered

- Playwright retries in CI: rejected; the failures are systematic under
  software rendering, not flaky.
- Rewriting the specs to be timing-independent: preferred long-term for the
  mid-simulation sampling tests (QA already flagged the webkit dodge-poll
  pattern); tracked as tech debt, not a gate blocker.
- A self-hosted GPU runner: rejected as premature cost/ops for the
  vertical slice.

## Consequences

CI green means: typecheck, lint, content checks, unit, component, build,
and the e2e suite minus eight skips on three browser engines. Firefox
coverage and the skipped specs are validated only in the local gate, so
task completion reports must keep running the full matrix locally.

---

# DEC-034

## Character save: core-owned DTO, envelope codec seam, single local slot

Date: 2026-09-05 (TASK-705)

## Decision

1. **The character save DTO lives in core** (`src/core/character-save.ts`).
   `CharacterSave` is pure JSON-safe data capturing the complete persistent
   character: current zone, quest stage, banked tutorial steps (DEC-030
   amendment), progression (level/XP/attributes/passives/unspent points),
   profession levels and XP, all item locations (48-slot inventory layout,
   worn equipment, flasks), owned abilities, loadout assignments, and the
   instance-ID generator positions (craft/vendor/material serials plus the
   deterministic loot generator's seed, sequence counters, and Mulberry32
   state). `parseCharacterSave` — also core — validates untrusted values
   field by field against the content catalogs, so a value that parses is
   guaranteed restorable. This respects the DEC-005 boundary (persistence
   imports core, never the reverse) and keeps the DTO backend-agnostic per
   DEC-032: the envelope wrapping it is the blob a future backend stores
   verbatim behind the same repository port.
2. **The DEC-014 repository is generalized, not forked.**
   `IndexedDbSaveRepository` is now generic over payload/envelope types and
   receives a `SaveEnvelopeCodec` (create/decode/serialize). The Phase 0
   fixture envelope became `FIXTURE_SAVE_CODEC` with zero behavior change;
   the character envelope (`rarpg-character-save`, format version 1, no
   migrations yet) is a second codec built from the same exported field
   validators, checksum signing, and ordered-migration semantics. One
   generation/backup/checksum machine now serves both formats.
3. **One local save slot, its own database.** The character slot writes to
   `rarpg-character-save-v1` / `character:slot-1`, separate from the Phase 0
   fixture database so the two envelopes never share generation rotation.
4. **Save triggers: zone travel and page hide.** A zone-ID change observed
   on the combat HUD read model persists the character (this includes New
   Game's travel into the tutorial zone, which is how New Game overwrites
   the slot — there is no explicit delete). `pagehide`/`visibilitychange`
   also persist, but only after gameplay has started and never while the
   player is dead, so an idle main menu or a death screen can never
   clobber a good save. Saves are fire-and-forget with `console.warn` on
   failure: local persistence stays best-effort (DEC-014).
5. **Load on boot resolves the DEC-031 Continue deferral.** Boot attempts
   one load; missing, corrupt, checksum-failing, or newer-versioned slots
   all read as "no save" (Continue stays disabled, no crash) while backup
   recovery surfaces as a menu note. Continue restores the simulation via
   `CombatArenaSimulation.restoreCharacterSave`, which re-validates,
   resets transient state, restores persistent state, refills vitals, and
   re-enters the saved zone at its spawn point (DEC-030 re-entry
   semantics).

## Deliberately not persisted

Player position (zone re-entry spawns at the zone's entry point), health
and mana (refilled to recomputed maximums), enemies, ground loot, ability
cooldowns and in-flight executions, status effects, gathering progress,
node charges, and open forge/vendor UI. All of it is transient combat
state that normal zone entry already reconstructs, and persisting it would
couple the save format to per-tick simulation internals.

## Alternatives Considered

- Extending the fixture envelope with a character payload variant:
  rejected; the fixture is a Phase 0 technical artifact and mixing
  payloads in one format/database would entangle generation rotation and
  migration histories.
- Duplicating the repository for the character format: rejected as a DEC-014
  fork; the codec seam keeps one tested storage machine.
- Persisting full transient combat state (position, cooldowns, enemies):
  rejected; save points are zone-granular by design and the DTO stays
  stable across combat-internal refactors.
- An explicit "delete save" on New Game: rejected for now; the single slot
  is overwritten at the first save trigger, and the menu's confirmation UX
  is deferred until multi-character support is on the table.

## Consequences

- The Continue button enables whenever a valid save exists; its note line
  distinguishes fresh, resumable, and backup-recovered saves.
- Version bumps happen on the envelope (`formatVersion`), with ordered
  migrations and provenance identical to the fixture format; the migration
  chain is exercised by unit tests through an injected synthetic v1→v2.
- TASK-707's backend adapter implements the same `SaveRepository` port and
  ships the same envelope bytes; no DTO change is expected.
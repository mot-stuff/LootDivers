# Phase 0 Project Baseline

**Status:** Phase 0 complete; Phase 1 authorized
**Last updated:** 2026-09-04
**Authority:** DEC-016, DEC-017, and `PHASE_0_ARCHITECTURE.md`

## Approved technical baseline

- Browser-first, desktop-first 2D isometric ARPG.
- Phaser 4.2.1 and WebGL2 presentation.
- Strict TypeScript with framework-independent core rules.
- Tiled for the synthetic isometric fixture.
- Vite, Vitest, and Playwright for build and verification.
- IndexedDB behind a repository boundary for prototype local persistence.
- Preact/HTML/CSS remains available for DOM UI, but a full UI shell is not a
  Phase 0 gate.
- PixiJS remains only a fallback after a documented hard Phaser failure.
- WebGPU remains deferred beyond the vertical slice.

Local Git on `main` remains the source-control baseline. A remote, hosted CI,
branch protection, production host, and real Safari hardware are not currently
available and do not block the compact Phase 0 gate. By explicit owner choice,
the exact production artifact served over loopback with Chromium and Microsoft
Edge boot proof satisfies P0-G06 temporarily. Public HTTPS staging is deferred.

## Phase boundary

Phase 0 was a seven-task validation gate, not an infrastructure-completion
phase. P0-G07 passed on clean `main` at `3adfba3`, completing Phase 0 and
immediately authorizing Phase 1 combat.

Completed gate actions:

- rerun and repair only the compact acceptance checks;
- perform independent QA against P0-G01 through P0-G07.

Still not authorized:

- production deployment or production hosting selection;
- production launch, hosting hardening, backend, or multiplayer;
- new broad infrastructure work justified only by the superseded backlog.

Phase 1 combat implementation is authorized, but was not started by this Phase
0 closure task.

## Evidence mapping

- **P0-G01 Browser foundation — Complete:** former P0-001 and P0-003 were
  independently accepted.
- **P0-G02 Isometric fixture — Complete, recheck in G07:** former P0-006
  implementation and QA remediation were merged.
- **P0-G03 Simulation lifecycle — Complete:** former P0-004 and P0-008 were
  independently accepted.
- **P0-G04 Synthetic performance — Complete:** a fresh short headed Microsoft
  Edge run passed the current-machine sanity gate at 1920×1080 DPR 1 with WebGL2
  on an NVIDIA RTX 5070 Ti. Its p95 frame interval was 14 ms with zero intervals
  over 33.4 ms. It remains `INELIGIBLE` for Intel UHD 630 minimum-spec
  certification.
- **P0-G05 IndexedDB persistence — Complete, recheck in G07:** former P0-010
  implementation and QA remediation were merged.
- **P0-G06 Production artifact boot — Complete under DEC-017:** the production
  build passed; the exact artifact was served over loopback; Chromium smoke and
  a headed hardware-accelerated Microsoft Edge ready/WebGL2 check passed. Public
  HTTPS staging is deferred.
- **P0-G07 Independent QA — PASS:** clean `main` at `3adfba3` passed formatting,
  lint, typecheck, 156 unit tests, world checks, production build, all five
  transfer-budget gates, 26 Chromium smoke tests with one diagnostic skip, and
  two deterministic fixture/depth visual tests. Git remained clean.

G07 independently rechecked every compact criterion and is the final Phase 0
acceptance decision.

## Completed-early, non-gating scope

- **Former P0-005:** versioned content schemas, Ajv/semantic validation, stable
  IDs, and deterministic compiled output.
- **Former P0-007:** spatial hash, simple collision, navigation grid, bounded A*,
  scheduling, and local separation.
- **Former P0-009:** typed ability/effect schemas and deterministic execution
  contracts, merged at `d7025ee`.
- **Former P0-010 excess:** migrations, checksums, generations/backups,
  import/export, concurrency, fallback, and error UX.
- **Former P0-011:** Preact/canvas shell contracts, focus/resize behavior, and
  automated accessibility checks, implemented and remediated in merge
  `3dff65a`.

This code remains in place. Its advanced acceptance, expansion, and maintenance
move to the phase that first depends on it. A defect in this code blocks Phase 0
only if it breaks a compact gate command or criterion.

## Deferred acceptance obligations

The compact gate does not require:

- eligible minimum-reference hardware or five performance repetitions;
- branded browser, Firefox, WebKit, or real Safari completion;
- full content-compiler acceptance;
- advanced navigation validation;
- full ability-contract acceptance before combat prototyping;
- advanced persistence failure/recovery matrices;
- full UI shell or manual accessibility certification;
- forced WebGL context restoration;
- CI, rollback, production cache/header/security analysis, or remote automation;
- detailed production telemetry;
- multiplayer architecture beyond preserving simple boundaries.

## Phase 0 blockers

None. Phase 0 is complete and Phase 1 is authorized.

---

## Archived pre-DEC-016 baseline

Everything below this heading is retained only as historical evidence for the
former backlog. It is superseded by the compact baseline above and defines no
current blocker or authorization rule.

# Historical Phase 0 Project Baseline

**Task:** TASK-P0-001
**Status:** Complete; pending independent QA acceptance
**Last updated:** 2026-09-04

This document records the operational baseline for Phase 0. Technical details
remain authoritative in `PHASE_0_ARCHITECTURE.md`; architecture decisions remain
authoritative in `DECISIONS.md`.

## Owner-approved architecture

The project owner approved the Phase 0 architecture direction on 2026-09-04,
including:

- Phaser 4.2.1 as the initial framework;
- PixiJS as the conditional fallback after a documented hard Phaser gate
  failure;
- WebGL2 as the gameplay renderer baseline;
- no WebGPU dependency for the vertical slice;
- Preact with HTML/CSS for DOM UI;
- Tiled for isometric zone authoring;
- strict TypeScript with a framework-independent game simulation.

This approval authorizes Phase 0 foundation work only. It does not authorize
Phase 1 gameplay implementation.

## Source control baseline

- Local repository: Git, default branch `main`.
- Remote provider: local Git only for now, selected by the project owner on
  2026-09-04.
- CI provider: none until a remote is approved.
- Merge model after a remote is configured: reviewed pull requests into a
  protected `main`; no direct pushes except an explicitly documented emergency.
- Required checks will be added by TASK-P0-013 after the test commands exist.
- Task branch names and review rules are defined in `CONTRIBUTING.md`.
- Git LFS is not enabled until the remote provider, quotas, and binary-asset
  workflow are approved.

Local-only source control means server-side branch protection, pull requests,
off-device backup, and hosted CI are unavailable. Before shared development or
TASK-P0-013, the owner must approve a remote; its default branch must then be
protected with reviewed merges and required checks.

## Browser support baseline

Primary desktop targets:

- current stable Google Chrome;
- current stable Microsoft Edge;
- current stable Mozilla Firefox.

Compatibility target where practical:

- current stable Safari on macOS.

Browser versions are recorded in each acceptance report rather than hardcoded
indefinitely. At release gates, test the current stable version and the most
recent prior major version where automation and vendor availability permit.
Mobile browsers are outside the vertical-slice scope.

WebGL2 preflight is mandatory. Unsupported browsers receive an actionable error
instead of a Canvas fallback.

## Reference hardware

The project owner selected this initial minimum reference tier:

- Windows 10 or Windows 11;
- four-core CPU;
- 8 GB RAM;
- Intel UHD 630-class integrated GPU;
- 1920×1080 output at device-pixel ratio 1.

TASK-P0-002 must record the exact benchmark machine's CPU, GPU, RAM, operating
system build, browser versions, power mode, and driver before accepting results.
The class-level target above is not a substitute for reproducible machine
metadata.

Real macOS/Safari hardware is not currently available. Playwright WebKit is the
interim compatibility signal and must not be described as Safari certification.
Real Safari testing remains a release risk until hardware becomes available.

## Responsibility map

- Game Director: architecture, planning, prioritization, coordination,
  integration, and scope.
- Combat Engineer: player movement and combat, abilities, hit detection,
  projectiles, dodge, and combat feedback.
- Gameplay Engineer: enemies, AI, loot spawning, gathering, interactions, world
  gameplay, dungeons, and quests.
- Systems Designer: stats, progression, itemization, professions, crafting,
  economy, and balance.
- UI Engineer: HUD, inventory, equipment, tooltips, skill/profession interfaces,
  crafting, vendors, settings, and menus.
- QA Reviewer: independent acceptance, build/test/runtime validation,
  regression review, and architecture compliance.

Each corresponding workspace custom agent has normalized YAML frontmatter,
uses `model: inherit`, and passed a non-mutating direct load test on 2026-09-04.

## Phase boundaries

Allowed now:

- Phase 0 governance, tooling, validation, technical fixtures, synthetic stress
  harnesses, persistence fixtures, and deployment foundations described by the
  approved backlog.

Not allowed:

- Phase 1 movement or combat;
- playable attacks, enemies, damage, loot, gathering, or crafting;
- production game content;
- multiplayer/backend implementation;
- unapproved framework replacement.

## TASK-P0-001 completion record

- The architecture approval and unresolved future decisions are recorded.
- Local Git is initialized on `main`.
- Contribution, branch, review, line-ending, ignore, and binary-asset policies
  are documented.
- Browser targets and reference hardware are recorded.
- Ownership boundaries are recorded.
- All six custom Cursor agents have normalized metadata and passed direct,
  non-mutating load tests.

Hosted backup, branch protection, and CI remain unavailable by the owner's
local-only choice. This is accepted for TASK-P0-001 but must be revisited before
TASK-P0-013 or shared development.

## Subsequent Phase 0 completion status

- **TASK-P0-002:** Complete and independently accepted on 2026-09-04. The
  browser, performance, loading, and bundle measurement contract and its
  non-reference-machine dry-run evidence are recorded. Representative fixture
  gates remain dependency-bound and deferred.
- **TASK-P0-003:** Complete and independently accepted on 2026-09-04. The
  strict-TypeScript Phaser 4.2.1, Preact, and Vite browser foundation passes its
  clean install, static checks, unit tests, production build, transfer gates,
  WebGL2 diagnostics, and Chromium production smoke.
- **TASK-P0-004:** Complete and independently accepted on 2026-09-04. The
  framework-free deterministic foundation provides an injectable clock,
  bounded fixed-step runner, versioned seeded random state, typed
  command/event and identity contracts, explicit composition dependencies, and
  enforced core dependency boundaries.
- **TASK-P0-005:** Complete and independently accepted on 2026-09-04. The
  non-gameplay content foundation provides shared stable IDs, typed versioned
  schemas, Ajv and semantic validation, central synthetic registries, safe
  asset references, deterministic compiled manifests, and non-mutating
  generated-output freshness checks.
- **TASK-P0-007:** Complete pending independent acceptance on 2026-09-04. The
  framework-free technical foundation provides uniform spatial queries, simple
  collision tests, a compiled 128×128 navigation grid, bounded deterministic
  A*, a fair bounded request scheduler, local separation, and a deterministic
  diagnostic timing harness. Current-machine timing is explicitly
  `INELIGIBLE`; representative browser population acceptance remains with
  TASK-P0-008.
- **TASK-P0-008:** Complete and independently accepted on 2026-09-04. The
  technical lifecycle fixture provides opaque runtime IDs, fixed-capacity typed
  stores, complete cleanup, declared update order, interpolation, culling,
  pooled Phaser presentations, exact P0-002 synthetic populations, and bounded
  six-stage timing/allocation diagnostics without authoritative Phaser state or
  gameplay semantics. All available pinned gates passed. Strict performance
  remains `INELIGIBLE` pending eligible reference hardware and five fresh
  repetitions; branded Chrome and real Safari hardware are unavailable.
- **TASK-P0-010:** Complete pending independent acceptance on 2026-09-04. The
  synthetic local persistence foundation provides a framework-free repository
  and migration boundary, versioned checksummed envelopes, validated IndexedDB
  generations with last-known-good fallback, validated export/import, and
  actionable quota/blocked/error UX hooks. It does not define production state
  or introduce gameplay, accounts, cloud sync, backend, or anti-cheat systems.

The integrated P0-004/P0-005 result passed a clean pinned install, formatting,
warning-fatal lint, strict type-checking, 73 tests, production build, all
transfer gates, content validation/compilation/freshness checks, and Chromium
production smoke. These completions make TASK-P0-006, TASK-P0-010, and
TASK-P0-011 dependency-safe to start. They do not authorize those tasks,
TASK-P0-007 or other later work, Phase 1, or gameplay implementation.

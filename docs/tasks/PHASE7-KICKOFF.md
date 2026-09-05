# Phase 7 Kickoff — Director Task Packets

Director planning deliverable, 2026-09-05. Owner asks for Phase 7: a fantasy
UI restyle, a tutorial level, a main menu, and (future) accounts/saves.

Execution order is strictly serial: **TASK-701 → TASK-702 → TASK-703 →
TASK-704 (QA gate)**. One branch per task
(`feature/TASK-701-fantasy-ui-restyle`, etc.). Real character save/continue is
deferred to TASK-705 (stub below).

---

## Environment Notes (mandatory — include in every shell for every task)

- node/npm are NOT on PATH. Prepend in every shell:
  `$env:PATH = "c:\Users\tomal\Desktop\RARPG\.tools\node-v24.20.0-win-x64;" + $env:PATH`
- e2e serves the built dist: always `npm run build` before
  `node scripts/run-playwright.mjs`.
- Playwright "chrome" project cannot run (Chrome not installed); use
  `--project=chromium` (plus edge/firefox/webkit for full gates).
- `npm run format:check` has 5 pre-existing warnings in untouched files; do
  not chase them.
- A Vite dev server is running on localhost:5173 (leave it alone; HMR picks
  up changes).

---

# TASK-701 — Fantasy UI Restyle

## Owner

UI Engineer

## Objective

Replace the dark-blue "diagnostic" styling of the in-game UI with an original
fantasy visual identity, implemented CSS-first in
`src/presentation/styles.css`, with no behavior changes.

What "fantasy" means concretely for this packet:

- **Design tokens:** introduce CSS custom properties (`--ui-panel-bg`,
  `--ui-border`, `--ui-accent`, `--ui-text`, etc.) at `:root` so the theme is
  defined once. All restyled rules consume tokens.
- **Palette:** move from dark-blue/cyan diagnostic colors to a dark fantasy
  palette — deep charcoal/umber panel backgrounds, ember-gold or aged-brass
  accents and borders, warm parchment-toned primary text. Existing rarity
  colors (item labels, tooltips) must be preserved exactly; zone floor/edge
  colors in the minimap are simulation data and must not change.
- **Typography:** at most one display typeface for headings/panel titles,
  vendored locally under an open license (OFL) via `@font-face` — no CDN
  fonts, no copyrighted game fonts. Body/HUD text stays on a system stack for
  readability. If no suitable font is vendored, a well-chosen system serif
  stack for headings is acceptable.
- **Panel treatment:** consistent framed-panel style for inventory, character
  screen, vendor, forge, and paused overlay: layered/double borders, corner
  accents, subtle gradient or vignette — achieved with CSS (borders, shadows,
  gradients, optional small inline SVG ornaments). No raster image assets.
- **Ability bar:** slotted frames per ability with the themed border
  treatment; cooldown sweep and disabled/ready states remain functionally
  identical, restyled to match.
- **Vitals:** keep bars (do not copy orb layouts from existing ARPGs); frame
  them with the panel treatment; health/mana/XP retain distinguishable colors
  and readable numbers.
- **Minimap:** themed frame/border around the existing minimap; the map
  contents (zone colors, walkable border, entity dots) are untouched.
- **Readability:** maintain or improve text contrast; the HUD must stay
  readable over all three zone floor colors.

## Dependencies

None. First packet of Phase 7.

## Scope

- `src/presentation/styles.css` (primary).
- `src/presentation/App.tsx` — class-name and minimal markup changes only
  where styling requires (e.g. a wrapper for a border ornament). No logic,
  state, or event-handler changes.
- `index.html` only if a vendored font preload is needed.
- New font file(s) under `public/assets/` if a vendored OFL font is used
  (commit its license file alongside).
- Test updates in `tests/browser/ui-shell.component.test.tsx` /
  `tests/e2e/*.spec.ts` **only** where they assert on renamed class names;
  prefer keeping existing class names and roles stable so tests don't change.

## Out of Scope

- Main menu (TASK-703); tutorial UI (TASK-702).
- Any change to `src/core`, `src/adapters`, `src/persistence`.
- New UI features, settings screens, audio.
- Changes to HUD data content or read models.
- Renaming diagnostic/automation hooks.
- Restyling the Phase 0 persistence/automation panels beyond token
  inheritance (they are test-only surfaces).

## Acceptance Criteria

1. All in-game surfaces (ability bar, vitals, minimap frame, zone/quest
   labels, inventory, character screen, tooltips, vendor, forge, gathering
   progress, paused overlay, loot labels) render in the new theme with
   consistent tokens.
2. No behavior change: every interaction (keys I/C/F/Esc, drag-and-drop,
   ability activation, menus) works exactly as before.
3. No copyrighted or CDN-loaded assets; any vendored font is OFL-licensed
   with the license committed.
4. Rarity colors and minimap zone colors are unchanged.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:component`
   pass.
6. `npm run build` then `node scripts/run-playwright.mjs --project=chromium`
   passes; full matrix (chromium, edge, firefox, webkit) passes before
   handoff.
7. Screenshots of the HUD in all three zones plus open
   inventory/character/vendor/forge menus are attached to the completion
   report.

## Testing

Commands listed in the acceptance criteria; manual visual pass in the running
dev server across all three zones and all menus; confirm text contrast over
each zone floor color.

## Files / Systems

`src/presentation/styles.css`, `src/presentation/App.tsx` (class names),
`index.html`, `public/assets/` (optional font), UI test class-name
assertions.

## On acceptance

Record DEC-029 in `/docs/DECISIONS.md` and update the ROADMAP Phase 7 status
(see doc-update list at the bottom of this file).

---

# TASK-702 — Tutorial Level

## Owner

Gameplay Engineer

## Objective

A small core-owned tutorial zone where a fresh character learns the core
verbs — move, attack, dodge, pick up loot, gather ore, and travel — via
staged prompts, exiting into Hearthmere.

Director-decided shape:

- **New zone** in `ZONE_CATALOG` (`src/core/world-zones.ts`): a compact
  landing area (suggest an original name like "Wakeshore Landing" — do not
  reuse names from existing games). Contents: one very weak melee enemy (low
  damage, small aggro radius, normal rank — it must be nearly impossible to
  die to), one Veinshard ore node, one exit portal to Hearthmere. No vendor,
  no forge, no quest giver. `ZoneKind` may stay `"wilderness"` or gain a
  `"tutorial"` kind — implementer's choice; keep the union change minimal.
- **Core tutorial tracker**, following the existing quest-stage pattern: an
  ordered step list defined as data in core (suggest new
  `src/core/tutorial.ts`), each step with an id, display prompt text (core
  owns copy, like `QuestDefinition.summary` does), and a completion condition
  observed by the simulation: `move` (any WASD movement), `attack` (kill the
  tutorial enemy), `dodge` (perform a dodge roll), `loot` (pick up a dropped
  item with F), `gather` (complete one ore-node gather), `travel` (use the
  exit portal). Steps advance in order; **the exit portal is always usable
  regardless of step progress** — walking out is the skip mechanism, no extra
  skip UI.
- **Activation:** the tracker is active only while the tutorial zone is the
  current zone (entering it activates step 1 if not completed; leaving
  deactivates prompts). `reset()` and `new CombatArenaSimulation()` behavior
  must not change (Ashtrail prototype spawn, session start in Hearthmere) so
  Phase 1–6 tests stay valid.
- **Read model:** expose the active tutorial state (current step id, prompt
  text, steps completed count/total) through the combat HUD read model
  (`src/presentation/shell-contracts.ts`) and `diagnostics()`, the same way
  zone name and quest label are exposed today.
- **Presentation:** one new HUD prompt block in `App.tsx` rendering the
  current prompt (positioned prominently but not covering the ability bar),
  styled with the TASK-701 design tokens. Core stays presentation-agnostic;
  the Phaser adapter only forwards the read model.

## Dependencies

TASK-701 merged (you consume its CSS tokens and its final `App.tsx`).

## Scope

- `src/core/world-zones.ts`, new `src/core/tutorial.ts`,
  `src/core/combat-arena.ts` (tracker integration + read model),
  `src/core/index.ts` exports.
- `src/presentation/shell-contracts.ts` (tutorial HUD model).
- `src/adapters/phaser/combat-arena-presentation.ts` (HUD forwarding + test
  hook exposure).
- `src/presentation/App.tsx` — the tutorial prompt block only; do not touch
  other sections.
- `src/presentation/styles.css` — additive rules only, consuming TASK-701
  tokens.
- Unit tests; one new e2e spec.

## Out of Scope

- Main menu / New Game flow (TASK-703 wires entry; you only guarantee
  `travelTo` into the tutorial zone works from a fresh state).
- Any new abilities, items, or enemies beyond the one weak melee config.
- Persistence of tutorial completion.
- Crafting/vendor/quest steps inside the tutorial.
- Modal or blocking tutorial gating (prompts are advisory; nothing locks
  input).

## Acceptance Criteria

1. Traveling to the tutorial zone from a fresh simulation shows the first
   prompt; performing each verb in order advances prompts; completing
   `travel` through the exit portal lands the player in Hearthmere with the
   tutorial marked complete.
2. The exit portal works at any step (skip path).
3. The tutorial enemy drops loot on death (existing deterministic loot path)
   so the `loot` step is completable.
4. `reset()` still spawns the Ashtrail prototype; the default session still
   starts in Hearthmere; all existing unit and e2e suites pass.
5. Tutorial prompt copy lives in core data, not hardcoded in JSX.
6. New unit tests cover step ordering, out-of-order actions (e.g. dodging
   during the `move` step must not advance or break the sequence),
   skip-by-portal, and re-entry after completion (no prompts reappear).
7. New e2e spec (`tests/e2e/tutorial.spec.ts`) drives the full sequence via
   `__RARPG_COMBAT_TEST__` and asserts prompt progression through the HUD
   read model.
8. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:component`
   pass; `npm run build` then
   `node scripts/run-playwright.mjs --project=chromium` passes; full matrix
   before handoff.

## Testing

Commands listed in the acceptance criteria plus a manual playthrough in the
dev server: fresh load → travel to tutorial zone via test hook or portal →
complete all six steps → arrive in Hearthmere.

## Files / Systems

Core zone catalog, new tutorial module, combat arena read model, shell
contracts, Phaser HUD forwarding, `App.tsx` prompt block, tests.

## On acceptance

Record DEC-030 in `/docs/DECISIONS.md` and update the ROADMAP Phase 7 status
(see doc-update list).

---

# TASK-703 — Main Menu and New Game Flow

## Owner

UI Engineer

## Objective

A fantasy-themed main menu shown at boot that gates entry into the game:
"New Game" starts a fresh character in the tutorial zone; a visible but
disabled "Continue" slot reserves the future local-save flow.

Director-decided shape:

- **Presentation-layer overlay, not a boot restructure.** The simulation
  already boots paused; the menu is a full-screen Preact overlay in
  `App.tsx` rendered above the canvas while the app shell is in a new `menu`
  state. Phaser boot, WebGL preflight, and boot diagnostics are unchanged.
  Core is untouched except via existing commands.
- **Menu contents:** game title (owner's working title "RARPG" until told
  otherwise), "New Game" (primary), "Continue" (visible, disabled, with a
  short note such as "No saved hero yet" — this is the save/continue
  groundwork; no persistence code behind it), and the build/version line
  already available to the shell. Styled entirely with TASK-701 tokens; this
  screen should be the showpiece of the new theme.
- **New Game:** dismisses the menu, issues travel to the tutorial zone
  (TASK-702) via the existing world-command path, and unpauses. A page load
  is already a fresh simulation, so no reset call is needed — but the flow
  must be correct even if the user idled at the menu.
- **Automation compatibility (critical):** all existing e2e specs boot
  straight into gameplay expectations. Driving the game through
  `__RARPG_COMBAT_TEST__` (e.g. `setAutomationPaused`, `reset`, or any
  command) must bypass/dismiss the menu, or add a query parameter (e.g.
  `?autostart`) applied by existing specs — choose whichever keeps the
  existing suite green with minimal spec churn, and document the mechanism in
  the completion report. Real players (no query params, no automation) must
  always see the menu.
- **Escape/pause behavior:** unchanged. The menu appears at boot only;
  returning to the menu mid-session is out of scope.

## Dependencies

TASK-701 (theme tokens) and TASK-702 (tutorial zone must exist as the New
Game destination), both merged.

## Scope

- `src/presentation/App.tsx` (menu component + shell state).
- `src/presentation/shell-contracts.ts` (menu state/intents if needed).
- `src/main.tsx` (autostart/bypass wiring only).
- `src/presentation/styles.css` (additive menu rules).
- `src/adapters/phaser/combat-arena-presentation.ts` only if the bypass hook
  requires it.
- New `tests/e2e/main-menu.spec.ts`; minimal edits to existing specs if the
  bypass mechanism requires a query param.

## Out of Scope

- Any real save/load or IndexedDB character persistence.
- Settings, credits, character selection, or account UI.
- Audio.
- Changes to `src/core` or `src/persistence`.
- A pause-to-menu flow.

## Acceptance Criteria

1. A plain `npm run preview` / dev-server load (no query params) shows the
   main menu; the game is paused and not interactable behind it.
2. "New Game" lands the player in the tutorial zone with the first tutorial
   prompt visible and input live.
3. "Continue" is visible, clearly disabled, and does nothing.
4. All pre-existing e2e specs pass (with at most the documented one-line
   bypass changes).
5. New e2e spec covers: menu visible at boot → New Game → tutorial zone
   active → prompt shown; and the automation bypass path.
6. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:component`
   pass; `npm run build` then
   `node scripts/run-playwright.mjs --project=chromium` passes; full matrix
   before handoff.
7. Screenshot of the menu attached to the completion report.

## Testing

Commands listed in the acceptance criteria; manual check of both paths
(real-player menu flow and automation bypass) against the built dist.

## Files / Systems

`App.tsx` shell state + menu component, shell contracts, `main.tsx` wiring,
`styles.css`, e2e specs.

## On acceptance

Record DEC-031 in `/docs/DECISIONS.md` and update the ROADMAP Phase 7 status
(see doc-update list).

---

# TASK-704 — Phase 7 Kickoff QA Gate

## Owner

QA Reviewer (independent — implementing agents do not self-certify)

## Instructions

Run after TASK-703 merges. Same environment notes apply.

1. Verify every acceptance criterion of TASK-701, TASK-702, and TASK-703 end
   to end on the built dist (`npm run build` first). Full Playwright matrix:
   chromium, edge, firefox, webkit; skip the "chrome" project (Chrome not
   installed).
2. Regression-check the complete Phase 1–6 loop: combat, loot, progression,
   gather, craft, travel, quest, vendor, pack, elite, boss.
3. Confirm the barbarian sprite (DEC-028) renders correctly through the full
   menu → New Game → tutorial → Hearthmere flow (idle/run/attack/roll/death,
   movement-direction facing, cursor-oriented attacks, shadow and slash
   layers).
4. Confirm no copyrighted assets entered the repo (fonts must carry a
   committed OFL license; no CDN loads).
5. Confirm `reset()` semantics and all pre-existing unit/component/e2e
   suites are green.
6. Issue an explicit PASS/FAIL per packet with evidence (command output,
   screenshots).

---

# Execution, Sequencing, and File-Conflict Plan

Strictly serial: **TASK-701 → TASK-702 → TASK-703 → TASK-704**, one branch
per task (`feature/TASK-701-fantasy-ui-restyle`, etc.).

`App.tsx` and `styles.css` ownership windows (these files are the collision
zone — no parallel edits to them, ever):

1. **TASK-701** owns both exclusively first (class names + full restyle).
2. **TASK-702** then owns `App.tsx`, restricted to adding the tutorial
   prompt block, and `styles.css` restricted to additive rules.
3. **TASK-703** then owns `App.tsx` for the menu component and shell state,
   plus additive menu CSS.

If schedule pressure demands parallelism, the only safe split is TASK-702's
core-only portion (zone + tracker + unit tests) starting during TASK-701,
with its `App.tsx`/CSS integration held until 701 merges. The default is
serial.

Specialist involvement: no combat-engineer work is needed (the tutorial
teaches existing verbs; no new combat mechanics). No systems-designer work is
needed for 701–703; the Systems Designer becomes the required schema reviewer
for TASK-705.

---

# Save/Continue: Deferral Rationale and TASK-705 Stub

**Ships now (inside TASK-703):** a disabled "Continue" menu slot only. Zero
persistence code.

**Why deferred:** the IndexedDB persistence subsystem (`src/persistence/`)
today serializes only the Phase 0 synthetic fixture
(`FixtureSaveState = {label, counter, markers}`) — explicitly documented as
not implying production character DTOs. Zone travel keeps one live
`CombatArenaSimulation` in memory; there is no snapshot/restore of
progression, inventory, professions, or quest stage anywhere. Shipping
Continue requires designing a versioned character save DTO spanning
progression (XP/level/attributes/masteries), generated item instances with
affixes, ability stones, the LMB/Q/E/R loadout, equipment, materials,
profession XP, quest stage, tutorial completion, and current zone — plus
core snapshot/restore and a migration story. That is a schema-design task,
not a cheap rider on a UI packet; rushing it would bake in a bad save schema.

## TASK-705 (stub — queue after TASK-704 PASS; do not start now)

- **Owner:** Gameplay Engineer (implementation) with **Systems Designer as
  required schema reviewer**; UI Engineer enables the Continue button last.
- **Objective:** versioned character save DTO; snapshot/restore on
  `CombatArenaSimulation`; a character save format reusing the existing
  DEC-014 generation/checksum/migration machinery (alongside or replacing
  the fixture envelope); menu Continue enabled when a valid save exists.
- **Out of scope:** accounts, backend, cloud sync (client saves remain
  best-effort and user-tamperable per DEC-014; server-authoritative
  persistence is a later, separate decision).
- Record the accepted save architecture as a new DEC entry at acceptance.

---

# Doc-Update List

## `/docs/DECISIONS.md` (each recorded by the implementing agent at acceptance, existing DEC format)

- **DEC-029** (with TASK-701): Fantasy UI theme — CSS-first design-token
  restyle of the in-game shell; palette/typography/panel-treatment rules; at
  most one vendored OFL display font, no CDN fonts, no external asset packs,
  no raster UI images; rarity and minimap zone colors preserved;
  presentation-only (DEC-005 boundary unchanged).
- **DEC-030** (with TASK-702): Tutorial zone and core-owned tutorial
  progression — fourth `ZONE_CATALOG` zone; ordered six-step tracker
  (move/attack/dodge/loot/gather/travel) as core data following the
  quest-stage pattern; prompts exposed via HUD read model; portal-exit as the
  skip mechanism; `reset()` and session-start semantics preserved
  (DEC-025/026/027 unchanged).
- **DEC-031** (with TASK-703): Main-menu overlay state machine — boot-time
  Preact overlay above the paused simulation, New Game → tutorial-zone travel
  via existing world commands, the chosen automation-bypass mechanism, and
  explicit deferral of Continue/character save with rationale (persistence
  subsystem is fixture-only today; character save DTO is TASK-705 with
  Systems Designer schema review; DEC-014 unchanged).

## `/docs/ROADMAP.md` — Phase 7 status paragraph

Append after the existing DEC-028 sentence and update at each packet
acceptance:

> Phase 7 kickoff in progress: fantasy UI restyle (DEC-029) [open/shipped],
> tutorial level (DEC-030) [open/shipped], and main menu with New Game flow
> (DEC-031) [open/shipped]. Local save/continue and accounts remain deferred
> (the menu reserves a disabled Continue slot); sound, VFX, enemy and world
> art, balance, and performance polish remain open.

Finalize the wording (all three marked shipped) only after TASK-704 issues
PASS.

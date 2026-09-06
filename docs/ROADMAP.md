# Development Roadmap

## Phase 0 — Minimal Stack Validation

Goal: prove the browser stack is adequate, then begin combat immediately.

**Status:** Complete. Independent P0-G07 QA passed on 2026-09-04 at
`3adfba3`. Phase 1 is immediately authorized.

Phase 0 contains exactly seven dependency-ordered gates:

1. **P0-G01 Browser foundation** — toolchain, strict TypeScript, Phaser/WebGL2
   boot, core/adapter boundary.
2. **P0-G02 Isometric fixture** — one Tiled fixture and basic depth sorting.
3. **P0-G03 Simulation lifecycle** — bounded fixed step and minimal
   entity/component/presentation cleanup.
4. **P0-G04 Synthetic performance** — one short browser population test.
5. **P0-G05 IndexedDB persistence** — one fixture save/load round trip.
6. **P0-G06 Production artifact boot** — one production build served over
   loopback with Chromium and Microsoft Edge boot proof. Public HTTPS staging is
   deferred by the owner-approved DEC-017 exception.
7. **P0-G07 Independent QA** — lean acceptance of the six technical gates.

Dependencies and exact acceptance commands are authoritative in
[`PHASE_0_ARCHITECTURE.md`](PHASE_0_ARCHITECTURE.md).

Existing content compiler, navigation, ability-contract, advanced persistence,
and UI-shell work is retained but does not enlarge the gate. Full browser
matrix, advanced recovery, CI/CD and rollback, production hosting hardening,
detailed telemetry, and multiplayer preparation are deferred.

Exit criteria:

- P0-G01 through P0-G06 satisfy their minimal acceptance criteria;
- independent QA executes the lean gate and issues PASS;
- no blocker is inferred from explicitly deferred or non-gating work.

**Transition rule:** P0-G07 PASS completes Phase 0 and immediately authorizes
Phase 1. No additional architecture review or separate Director approval is
required.

---

## Phase 1 — Combat Prototype

Goal: prove that movement and combat feel good.

Features:

- player movement
- mouse aiming
- basic attack
- health
- damage
- dodge
- one enemy
- enemy death
- basic combat feedback

Exit criteria:

- movement feels responsive;
- player and enemy can damage one another;
- dodge and deaths work;
- no major runtime errors.

**Status:** Complete at `e6be497`. The playable prototype includes responsive
WASD movement, independent mouse aim, left-click melee, cooldown-only dodge,
health/damage/death feedback, a compact HP/MP/XP HUD, and one approved weak,
small common melee enemy.

---

## Phase 2 — Ability Framework

Goal: create reusable combat abilities.

The first character direction is melee-focused. Phase 4 may use passive points
to specialize and improve acquired abilities, but ability acquisition belongs
to the Ability Stone loot flow.

Features:

- ability base architecture
- cooldowns and resource costs
- melee, projectile, and area abilities
- buff/debuff support
- ability tags

Exit criteria:

- at least four abilities work;
- abilities use shared architecture;
- abilities can be configured without rewriting core logic.

The former P0-009 contract implementation is available as completed-early
infrastructure, but Phase 2 owns its gameplay integration and fitness.

**Status:** Complete. Independent Phase 2 QA passed on 2026-09-04 at `3a1ecb6`.
The accepted implementation includes shared-runtime Basic Cleave, Cinder Dart,
Winter Pulse, and Defiant Signal with real Mana, cooldowns, projectile/area
behavior, refreshing buffs/debuffs, tags, Phaser feedback, and a Preact action
bar.

---

## Phase 3 — Items and Loot

Goal: create the basic ARPG loot loop.

Features include item definitions, inventory, equipment, rarity, affixes, loot
drops, stat integration, readable tooltips, and Ability Stone slotting.

**Status:** Complete. Independent Phase 3 QA passed on 2026-09-04 at `fbf65b4`.
The accepted loop includes equipment slots, a 48-slot scrollable inventory,
common/magic/rare generation, deterministic enemy drops, equipment-derived
health/damage, readable tooltips, Ability Stone creation, and configurable
ability assignments. Gold and flask mechanics remain deferred.

An owner-requested follow-up (DEC-020) expanded the loop to nine equipment
slots with a paper-doll drag-and-drop panel, affix tiers 1–5, reserved Unique
rarity, rarity-colored ground loot name labels, manual F-key pickup, an I-key
inventory toggle, and LMB/Q/E/R ability keys.

---

## Phase 4 — Character Progression

Owner-requested UX for this phase: pressing C opens the character screen, with
an on-screen button placed to the right of the inventory button. Combat
loadout assignment (LMB/Q/E/R) belongs on that screen.

Features include XP, levels, attributes, a small passive/mastery system, level
requirements, and a respec prototype.

The current candidate attributes are Strength, Dexterity, Vitality, and
Intelligence. Passive points may be awarded on level-up and improve acquired
abilities; exact unlock and upgrade rules require Phase 4 design.

**Status:** Complete. Independent Phase 4 QA passed on 2026-09-05. The
accepted loop includes enemy-kill XP, uncapped levels, Strength / Dexterity /
Vitality / Intelligence, eight three-rank masteries, free Restore Training,
rarity-based item level requirements, a C-key character screen with the
on-screen button to the right of Inventory, and combat loadout assignment on
that screen. Progression is not persisted (DEC-014).

---

## Phase 5 — Profession Prototype

Initial professions: Mining and Smithing.

Features include resource nodes, gathering, profession progression, ore tiers,
simple crafting, and crafted-equipment integration. Woodcutting, Fletching,
tree tiers, and arrow production are later profession candidates after the
initial two-profession loop is proven.

**Status:** Complete (2026-09-05). Mining and Smithing shipped with world
resource nodes, gathering, profession XP/levels, three ore tiers, anvil
crafting, and crafted equipment feeding the combat stat pipeline.

---

## Phase 6 — Vertical Slice World

Features include one town, outdoor zone, dungeon, basic quest/vendor flow, five
enemy types, one elite, and one boss.

Exit criterion: a repeatable 20–30 minute combat, loot, progression, gathering,
crafting, and boss loop.

A compact top-right minimap is a candidate for this phase.

**Status:** Complete (2026-09-05). Hearthmere town, Ashtrail wilds (white
pack plus an elite), and the Hollowdeep dungeon boss shipped with zone
travel, a starter quest/vendor flow, cross-zone character persistence, and
the top-right minimap showing the walkable-area border. The world-session
QA gate passed.

---

## Phase 7 — Polish

Sound, VFX, combat feedback, UI polish, balance, performance, bug fixing, and
onboarding.
Import our character spritesheet, we will want to stop at this point and prompt us to do that, i have spritesheets for the first character.

**Status:** Character import done ahead of schedule. The owner-provided
barbarian spritesheets now render the player (idle, run, attack, dodge roll,
death across eight facings; the character faces the movement direction and
attacks orient to the cursor) per DEC-028 (2026-09-05).

Phase 7 kickoff complete: fantasy UI restyle (DEC-029) shipped, tutorial
level (DEC-030, amended 2026-09-05: gated exit portal with banked step
tracking) shipped, and main menu with New Game flow (DEC-031) shipped. The
independent TASK-704 QA gate passed on 2026-09-05. The menu carries the
owner's "Loot Divers" branding (title logo, favicon, page title). Local
save/continue and accounts remain deferred (the menu reserves a disabled
Continue slot; character saves are TASK-705); sound, VFX, enemy and world
art, balance, and performance polish remain open.

Infrastructure: the game auto-deploys to Cloudflare Pages
(lootdivers.pages.dev plus the owner's custom domain) on every green main
push (TASK-706, DEC-032), with a lossless PNG pass that halved the asset
payload. Accounts and the droplet backend are TASK-707, after TASK-705.

---

## Phase 8 - Main menu and system
We need a character picker as we will have multiple characters
Account creation which will tie into final phase
Title screen with settings
Escape menu when playing so they can exit, adjust settings/pause/change keybinds
The game name is Loot Divers

**Status:** First wave complete (2026-09-05), integration QA passed at
`1b3ff13`. Shipped: the accounts API and Postgres backend on the droplet
(TASK-707, DEC-032), the public homepage at `/` with login/signup/news and
the game at `/play/` (TASK-708, DEC-035), account-aware character
creation/selection with the animated barbarian preview (TASK-709, DEC-036),
death screen with town respawn and zero penalty (TASK-710, DEC-037), flasks
on keys 1–4 with the charge economy (TASK-711, DEC-038), and gold drops
with walk-over collection and the inventory counter (TASK-712, DEC-039).

Second wave complete (2026-09-05): required accounts for `/play/` with a
character-select logout button (TASK-714, DEC-040) and the in-game escape
menu with keybind remapping, settings, and save-then-exit options
(TASK-715, DEC-041).

In flight: account-aware homepage with server-only saves (TASK-716) and
server-side save validation (TASK-717) — the server rejects forged saves
(impossible gold, XP, attributes, item stats/affixes) instead of storing
opaque blobs. Owner directive (2026-09-05): cheat protection must cover
essentially everything a save can claim — stats, item mods, XP, gold — so
characters cannot be handed impossible power. v1 validates plausibility
(a state that could legally exist); full server authority over gameplay
is deferred. Still open from the wishlist: title-screen settings.


## Phase 9 - Map builder
We will need to build something so i can build towns
Zones/dungeons will be procedurally generated ideally using isometric tilesets


## Final Phase
Amended by DEC-032 (2026-09-05): the website deploys to Cloudflare Pages
(done, TASK-706); the DigitalOcean droplet hosts the future backend API
and Postgres database (TASK-707). The code is on GitHub
(mot-stuff/LootDivers); separate GitHub image hosting is unnecessary
under Cloudflare's bandwidth terms.
Auction house will be the multiplayer portion of the game so we will want to make sure we track each players gold and account etc.

Anti-cheat prerequisite (owner directive, 2026-09-05): before any trading
or auction house ships, item and gold legitimacy must be server-enforced.
TASK-717's save validation (schema, bounds, earnable-progression, legal
item mods) is the first layer; the trading economy additionally requires
server-authoritative item provenance (the server mints or verifiably
re-derives item instances, so a client can never introduce a fabricated
item into the shared economy) and server-side gold accounting for every
trade. A locally-simulated character state must never be tradeable
without that provenance layer.

Owner addition (2026-09-05): state validity is not enough, because a
modified client (billions of damage, move-speed hacks) *earns*
legal-looking loot unnaturally fast and dumps it on the market. The
pre-trading requirement therefore also includes rate-of-progression
enforcement: the server tracks elapsed play time per character (saves
already carry monotonic revisions and server-side timestamps) and bounds
XP, gold, kill counts, and item acquisition between saves against the
maximum a legitimate client could achieve; outliers are rejected or
flagged for review. The endgame answer remains server-authoritative
simulation for any shared-economy play, and that decision must be made
before multiplayer — not retrofitted after.

Owner clarification (2026-09-05): **Loot Divers is an MMO ARPG — there is
no single-player product.** The client-local simulation is a development
scaffold for proving gameplay, not the shipping architecture. The
server-authority migration is therefore not a contingency but a planned
phase: the deterministic core simulation moves to (or is verified by) the
server for all shared play, clients send inputs and render state, and the
plausibility/rate validation above becomes a transitional layer, not the
end state. GAME_VISION.md § Multiplayer carries the same amendment.

## Deferred systems

Do not build without approval: multiplayer, guilds, shared trading economy,
auction house, PvP, a giant passive tree, procedural world generation, massive
quest/endgame systems, or dozens of professions.

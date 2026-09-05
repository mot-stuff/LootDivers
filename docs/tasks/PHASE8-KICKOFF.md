# Phase 8 Kickoff — Accounts, Homepage, Character Creation, Death, Flasks, Gold

Director planning deliverable, 2026-09-05. Owner directive (paraphrased):
deploy the database with manual steps documented; a real game homepage with
login/signup/news; account creation flowing into a character-creation
screen (barbarian-only, named, with an idle-animation preview and a
character description); a death screen with respawn in the nearest town;
flask use on keys 1–4; gold drops and a gold counter in the inventory.
All of it was verbally signed off by the owner; no cost or third-party
sign-offs are newly required (flagged inputs in §7).

**State this plan is grounded in:**

- TASK-706 is live: the game deploys to Cloudflare Pages
  (lootdivers.pages.dev) on green main pushes (DEC-032 implementation
  status).
- TASK-705 is implemented on `feature/TASK-705-character-save`
  (`79ac8d9`, **not merged**; Systems Designer schema review in flight).
  DEC-034 (in that branch): core-owned `CharacterSave` DTO, generalized
  DEC-014 repository with codec seam, single local slot, save on zone
  travel + page hide, **never saves while dead** (death currently rewinds
  to the last save — TASK-710 closes this).
- `CharacterSave` v1 has **no gold field** (verified in the worktree DTO).
- Flasks equip into four slots and appear in the read model, but **no
  consumption mechanic exists** (no charges, no drink command; DEC-022
  deferred keys 1–4).
- `ZoneKind` already includes `"town"` (Hearthmere). The tutorial zone
  (Wakeshore Landing) and dungeon (Hollowdeep) are wilderness/dungeon.
- **The exact domain string is still unknown.** API CORS and cookie
  configuration require it; TASK-707 parameterizes it as `<yourdomain.com>`
  and lists it as a pre-implementation input.

Environment notes for every implementing shell: PATH prepend
`$env:PATH = "c:\Users\tomal\Desktop\RARPG\.tools\node-v24.20.0-win-x64;" + $env:PATH`;
build before e2e; local full matrix before handoff (DEC-033: CI runs
chromium/edge/webkit with documented skips); gameplay tasks run in
separate git worktrees off main, one branch per task.

---

# 1. Decisions Made in This Plan

Recorded here for review; each becomes a DEC entry at the owning task's
acceptance (§6).

1. **Site architecture (DEC-035 draft):** one Vite multi-page build in the
   existing repo and Pages project. `/` becomes the homepage
   (login/signup/news/Play — no Phaser, loads light); the game moves to
   `/play/`. All game boot logic, `?autostart`, and automation parameters
   are unchanged except the path (`/play/?autostart`); existing e2e specs
   get mechanical one-line `goto` edits (precedent: DEC-031's `?autostart`
   churn). Rejected: routing the homepage inside the game app (game JS on
   the landing page, menu-state entanglement) and a second Pages project
   (two deploys, cross-origin cookies).
2. **Character identity (DEC-036 draft):** `name` and `class` are **server
   columns**, not blob fields — the auction house and character list need
   server-visible identity — and the blob stays verbatim per DEC-032.
   Name uniqueness is **per-account**, case-insensitive (global uniqueness
   is an MMO-ism that invites name squatting; the future auction house can
   display `name` + account-scoped discriminator). Naming rule (one regex,
   shared client/server): `^[A-Za-z][A-Za-z0-9'\- ]{2,15}$`, trimmed, no
   consecutive separators, 3–16 chars. Class enum: `barbarian` only.
   **Four character slots per account** for v1.
3. **Auth origin policy (DEC-036 draft):** authenticated play is supported
   on the custom-domain origin only (`<yourdomain.com>` ↔
   `api.<yourdomain.com>` are same-site, so the HttpOnly session cookie
   flows with `SameSite=Lax`). `lootdivers.pages.dev` and localhost remain
   local-save-only play; automation always uses the local gateway.
4. **Offline/local story:** local-only play (DEC-034 behavior) **remains
   fully supported** — it is the automation path, the dev path, and the
   logged-out player path. The `SaveRepository` port gets a sibling HTTP
   adapter; nothing about the local adapter changes. Logged-out menu keeps
   New Game/local Continue plus a "Log in" pointer to the homepage;
   logged-in menu replaces them with server character select/create.
5. **Death rules (DEC-037 draft):** on death, a death screen overlay;
   "Respawn" places the player at the current zone's `respawnZoneId` with
   vitals refilled. Per-zone targets in zone data: Ashtrail → Hearthmere,
   Hollowdeep → Hearthmere, Wakeshore → Wakeshore (a tutorial death must
   not eject the player from the tutorial), Hearthmere → itself (safe zone,
   unreachable in practice). **v1 death penalty: none** (no XP/gold/item
   loss — vertical-slice choice, owner may tune later; flagged §7). A
   **new save trigger fires at respawn**, closing the DEC-034 rewind
   exploit (dying then reloading can no longer restore pre-death state).
6. **Gold in save v1 before merge (DEC-039 draft):** `CharacterSave` v1
   gains a top-level `gold: number` (integer ≥ 0, default 0) **on the
   unmerged 705 branch** — nothing has shipped, so this is free now and
   avoids a v2 migration days after v1. TASK-705B below coordinates this
   with the in-flight schema review. Gold lives in the blob (DEC-032
   ledger-extraction path stays future). Gold drops auto-collect on
   walk-over (distinct from F-pickup items — standard ARPG QoL, avoids
   F-key contention).
7. **Flasks (DEC-038 draft):** keys 1–4 drink the flask in the matching
   slot: instant restore (health or mana per flask type) scaled by the
   flask's rolled affixes; flasks hold charges, spend one per drink, gain
   charges on enemy kills, and refill on zone entry. Charges are
   transient (not persisted — consistent with DEC-034's "deliberately not
   persisted" combat state). Numbers come from the TASK-713 memo.
8. **News:** an owner-editable `news.json` in the repo, shipped with the
   homepage as a static asset. No database table, no API endpoint (the
   owner edits via a Git commit; revisit only if that workflow chafes).

---

# 2. v1 API Contract (authoritative for mocking)

TASK-707 implements exactly this; TASK-708/709 build UI against it
(mocked until 707 is live). Base URL `https://api.<yourdomain.com>`. All
bodies JSON. Auth is an opaque session token in an `HttpOnly; Secure;
SameSite=Lax` cookie; the server stores only the token hash (DEC-032).
Errors: `{ "error": { "code": string, "message": string } }` with
appropriate 4xx/5xx.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| POST | `/auth/signup` | `{email, password}` | 201 `{userId}` + session cookie (auto-login) |
| POST | `/auth/login` | `{email, password}` | 200 `{userId}` + session cookie |
| POST | `/auth/logout` | — | 204, clears cookie |
| GET | `/auth/session` | — | 200 `{userId, email}` or 401 |
| GET | `/characters` | — | 200 `[{id, name, class, level, updatedAt}]` |
| POST | `/characters` | `{name, class: "barbarian"}` | 201 `{id}`; 409 duplicate name (per-account, case-insensitive); 422 invalid name; 403 slot limit (4) |
| GET | `/characters/:id` | — | 200 `{id, name, class, level, envelope}` (`envelope: null` if never saved → client starts the fresh new-character flow) |
| PUT | `/characters/:id/save` | `{envelope, level}` | 200 `{revision}`; 413 over 1 MB cap; 422 envelope-shape failure |
| DELETE | `/characters/:id` | — | 204 (frees a slot; UI requires typed confirmation) |
| GET | `/healthz` | — | 200 `{status: "ok"}` |

Server rules: every character route filters by the session's `user_id`;
`level` is a client-supplied metadata column for list display (server
never parses the envelope — DEC-032); save is last-write-wins with the
previous revision retained one deep; auth endpoints are rate-limited.
Password hashing argon2id. Email verification/password reset: not in v1.

---

# 3. Task Packets

## TASK-705B — Gold Field + TASK-705 Merge Gate

### Owner

Gameplay Engineer (the 705 author, on the existing
`feature/TASK-705-character-save` worktree), with the Systems Designer
review already in flight; Director merges.

### Objective

`CharacterSave` v1 gains `gold: number` (integer ≥ 0, default 0, parsed
and clamped in `parseCharacterSave`, round-tripped in snapshot/restore
with the simulation's gold state — a plain counter the combat arena owns,
initially always 0 since drops arrive in TASK-712). Then TASK-705 merges
to main after the Systems Designer verdict.

### Dependencies

The in-flight Systems Designer schema review. **Whoever merges 705 must
see this packet:** the review verdict should explicitly cover the gold
field so v1 ships once, complete. If the review has already concluded
before this lands, the field is added as a review-addendum commit and the
reviewer re-checks only the delta.

### Scope

`src/core/character-save.ts`, `src/core/combat-arena.ts` (gold state +
snapshot), the 705 unit tests, DEC-034 text (one added field sentence).

### Out of Scope

Gold drops, UI counter, spending (TASK-712). Any other DTO change.

### Acceptance Criteria

1. Save → reload → Continue round-trips a nonzero gold value (unit test
   sets it directly; no drops exist yet).
2. `parseCharacterSave` rejects negative/non-integer gold.
3. All 705 branch suites stay green; Systems Designer sign-off recorded;
   merged to main with CI green.

### Testing

705 branch unit/component/e2e suites plus the new round-trip case.

---

## TASK-707 — API + Database on the Droplet

### Owner

Gameplay Engineer (server implementation; first backend code in the
repo), **Director reviews architecture before merge**. QA Reviewer runs
the epic acceptance (§ TASK-714).

### Pre-implementation inputs (owner)

1. **The domain string** — required for CORS origin allow-list and cookie
   scope. Parameterized as `<yourdomain.com>` until supplied; development
   proceeds with localhost CORS, but the production config cannot be
   finalized without it.
2. Runbook Part A remains complete (it is).

### Objective

The DEC-032 backend, live: `server/` workspace (Fastify + TypeScript,
Postgres, plain SQL migrations run automatically at API startup, Docker
Compose with `postgres`/`api`/`caddy`, Caddy TLS via the staged
Cloudflare Origin certificate), implementing exactly the §2 contract at
`https://api.<yourdomain.com>`; GitHub Actions deploys it over SSH
(runbook step 10 secrets) on green main pushes; the client gains the
HTTP `SaveRepository` adapter behind the existing port (no DTO changes —
DEC-034 consequence #3 honored).

### Dependencies

TASK-705B merged (the envelope/codec the adapter ships). Owner runbook
Part A (done). Domain string for production config.

### Scope

- `server/`: Fastify app (auth, characters, healthz per §2), `schema.sql`
  + ordered migrations, Dockerfile, `docker-compose.yml`, `Caddyfile`,
  `backup.sh`, `deploy.sh`; own tsconfig; unit tests against a test
  Postgres (compose service) or in-memory fake — decide and document.
- Tables: `users`, `sessions`, `characters` per the infra plan §2.4
  schema plus `class text not null default 'barbarian'` and the
  per-account unique index `unique (user_id, lower(name))`.
- `.github/workflows/`: server typecheck/lint/test job in the gate; SSH
  deploy job (pull-and-restart script) after gates on main pushes.
- Client: HTTP `SaveRepository`/gateway adapter + session probe
  (`GET /auth/session` on boot at the custom-domain origin only, §1.3) —
  **adapter and wiring only; menu UI is TASK-709.**
- `docs/OWNER-SETUP-RUNBOOK.md` Part B: keep in sync if implementation
  deviates from the refreshed steps (refreshed with this plan).
- CORS: allow `https://<yourdomain.com>`, `https://www.<yourdomain.com>`;
  credentials on; localhost origins in development mode only.

### Out of Scope

- Anti-cheat / envelope content validation beyond shape + size (DEC-032
  trust model). Wallets/ledger/auction house (future epic). Email
  verification, password reset, OAuth. Any menu/homepage UI. Multiplayer.

### Acceptance Criteria

1. Owner executes runbook Part B steps 12–14 as written (or the packet
   updates them) and the stack comes up on the droplet.
2. `https://api.<yourdomain.com>/healthz` returns 200 through the
   Cloudflare proxy (Full strict).
3. Contract conformance: every §2 row behaves as specified, including the
   409/422/403/413 cases, verified by server tests plus a documented
   curl script.
4. Ownership isolation negative test: authenticated user A cannot read
   or write user B's characters.
5. Signup → create character → play on the custom domain → save fires on
   zone travel → row visible via `psql` → second browser login →
   character list shows it (client-side select UI may be TASK-709's mock
   until it merges; the API path is provable with curl).
6. A green main push auto-deploys the API; a red gate deploys nothing.
7. Backup: one `backup.sh` dump produced and restored into a scratch
   database (documented drill).
8. Full local gate + CI green; Director architecture review recorded;
   DEC-036 recorded at acceptance.

### Testing

Server unit tests, curl conformance script, the two-browser round trip,
the restore drill.

### Files / Systems

`server/**`, `.github/workflows/`, client persistence adapter,
`docs/OWNER-SETUP-RUNBOOK.md`, `docs/DECISIONS.md`.

---

## TASK-708 — Homepage and Site Restructure

### Owner

UI Engineer.

### Objective

`/` becomes a real game-site homepage: Loot Divers branding, Play button
(→ `/play/`), login/signup forms (against the §2 contract; mocked until
TASK-707 is live), a news section rendered from a repo-owned
`news.json`, and footer basics. The game moves intact to `/play/` as a
second Vite entry.

### Dependencies

None hard (contract is §2 of this doc; mock until 707). Merges before
TASK-709. Coordinate the e2e `goto` churn window with in-flight tasks
(§5).

### Scope

- Vite multi-page config: `index.html` (homepage) + `play/index.html`
  (game shell, current `index.html` content); no `base` change; shared
  `/assets/`.
- Homepage source (suggest `src/home/`): static-first, Preact only if
  forms warrant it; styled with the DEC-029 tokens for brand continuity;
  original copy only.
- `public/news.json` (or `src/home/news.json` imported at build):
  `[{date, title, body}]`; seed it with real entries (Phase 7 ship
  notes). Owner edits via Git commits.
- Auth forms: signup/login calling the §2 endpoints with credentials;
  success routes to `/play/`; graceful "server unavailable" state (the
  homepage must not break when the API is down or unimplemented).
- E2e churn: every existing spec's `page.goto("/…")` →
  `page.goto("/play/…")` (mechanical, one line each); `boot.spec.ts`
  covers `/play/` real-player boot; new `homepage.spec.ts` (loads, news
  renders, Play navigates, forms validate client-side).
- CI post-deploy smoke: add homepage checks (`/` 200 + title, `/play/`
  200).

### Out of Scope

- Character creation/select UI (TASK-709). Menu changes inside the game
  beyond none-or-a-"Log in" pointer. Server code. Settings/credits/
  forum/account-management pages. Analytics.

### Acceptance Criteria

1. `https://…/` renders the homepage (no Phaser loaded — verify no game
   chunk request); `/play/` boots the game exactly as `/` does today,
   including `?autostart` and the other DEC-031 parameters.
2. News renders from the repo file; adding an entry requires only editing
   that file.
3. Auth forms validate locally (email shape, password ≥ 8) and complete
   against the real API once 707 is live (until then: documented mock).
4. Full pre-existing suite green with only the documented `goto` edits;
   new homepage spec green; CI + post-deploy smoke green.
5. DEC-035 recorded at acceptance.

### Testing

Suites above; manual pass on the built dist: homepage → Play → menu →
New Game; lighthouse-style sanity that `/` stays under ~200 KB
transferred (excluding the logo).

---

## TASK-709 — Character Creation and Select in the Game Menu

### Owner

UI Engineer (menu/UI), consuming TASK-707's client adapter as-is.

### Objective

The authenticated main-menu flow: when a session exists (custom-domain
origin), the menu replaces New Game/Continue with **character select**
(up to 4 server characters: name, class, level) and **Create
Character** — a barbarian class card with a canvas/CSS idle-animation
preview (south-facing row of
`public/assets/characters/barbarian/Idle.png`, 15 frames of the
1920×1024 8-row sheet), an original character description (no
copyrighted lore), and name entry validating the §1.2 rule with
server-error surfacing (409/422/403). Selecting a character loads its
envelope through the gateway (fresh characters with `envelope: null`
start at the tutorial like New Game). Logged-out behavior is unchanged
(local New Game/Continue + "Log in" pointer to the homepage);
`?autostart` and all automation stay purely local.

### Dependencies

TASK-705B merged (restore path), TASK-708 merged (menu is reached via
`/play/`; homepage handles auth), TASK-707 for end-to-end reality
(develop against a mocked gateway first if 707 is still in flight — the
§2 contract is binding).

### Scope

`src/presentation/App.tsx` (menu states: logged-out / select / create),
`src/presentation/styles.css` (additive, DEC-029 tokens),
`src/main.tsx` (session-aware menu wiring), shell contracts (menu
intents), component tests, new `tests/e2e/character-create.spec.ts`
(mock-gateway path; a real-API smoke is a documented manual/QA step).

### Out of Scope

Any change to the save DTO, core simulation, or server. Local→server
save upload/migration (deferred, §7). Character rename/appearance
options. Death/flask/gold UI (their packets own their HUD).

### Acceptance Criteria

1. Logged-in: select screen lists server characters; create flow
   validates the name rule client-side with identical server rules
   enforced; the idle preview visibly animates; description text is
   original.
2. Fresh character → tutorial with first prompt; existing character →
   restored state (705 semantics).
3. Slot limit and duplicate-name server errors surface readably.
4. Logged-out and automation paths byte-identical to pre-709 behavior;
   full suite green locally and in CI.
5. DEC-036 (identity/menu composition portions) recorded at acceptance
   if 707 hasn't already recorded it; otherwise amend.

### Testing

Component + e2e (mocked gateway); manual two-browser pass against the
live API; full local matrix.

---

## TASK-710 — Death Screen and Town Respawn

### Owner

Combat Engineer (death lifecycle, combat states, respawn; the death
overlay UI block rides in this packet to keep one owner in `App.tsx`
during its window).

### Objective

Implement §1.5: core-owned death → death-screen read model → respawn
command → arrive at the zone's `respawnZoneId` (new per-zone field:
Ashtrail → Hearthmere, Hollowdeep → Hearthmere, Wakeshore → Wakeshore,
Hearthmere → Hearthmere) with vitals refilled and transient state reset
(existing zone-entry semantics). No XP/gold/item loss in v1. A save
fires at respawn (new trigger alongside DEC-034's zone-travel/page-hide)
so death outcomes persist and the rewind exploit closes.

### Dependencies

TASK-705B merged (save trigger integration). Independent of
707/708/709; runs in a parallel worktree.

### Scope

`src/core/world-zones.ts` (`respawnZoneId`), `src/core/combat-arena.ts`
(death state machine, respawn command, diagnostics), shell contracts +
Phaser forwarding, `App.tsx` death overlay (DEC-029 tokens; shown only
while dead; Respawn button emits the command), save-trigger wiring in
`src/main.tsx`, unit tests (respawn targets per zone, no-loss
invariants, save-at-respawn), one e2e spec (die in Ashtrail → overlay →
respawn in Hearthmere → reload → still Hearthmere).

### Out of Scope

Death penalties (XP/gold/durability — future tuning), hardcore mode,
death animations beyond the existing sprite death row, enemy respawn
changes, spectator/delay mechanics.

### Acceptance Criteria

1. Dying anywhere shows the death screen (input to gameplay locked;
   simulation may keep ticking enemies); Respawn lands in the mapped
   town/zone with full vitals; inventory/XP/quest state untouched.
2. Tutorial death respawns in Wakeshore with banked steps intact.
3. Reload-after-death (before pressing Respawn) and
   reload-after-respawn both resume post-death state — the pre-death
   rewind is gone (e2e-verified).
4. `reset()` and all Phase 1–6 suites unchanged and green.
5. DEC-037 recorded at acceptance.

### Testing

Unit + e2e above; manual death in each unsafe zone on the built dist.

---

## TASK-711 — Flask Drinking on Keys 1–4

### Owner

Combat Engineer (core consumption + input + HUD flask row — same
one-owner-in-`App.tsx` rationale as 710; UI Engineer reviews token
usage). TASK-713 numbers are a dependency.

### Objective

Implement §1.7: `useFlask(slot)` core command bound to keys 1–4; instant
health/mana restore per flask type scaled by rolled affixes; charge
model (max charges, one per drink, gain on kills, refill on zone entry,
transient); HUD flask row showing the four slots with charge state and
keybind labels; empty-slot/empty-charges feedback. Numbers (base
restore, base charges, per-kill gain, any shared drink cooldown) come
from the TASK-713 memo verbatim.

### Dependencies

TASK-710 merged (its `App.tsx`/combat-arena window closes first;
death/respawn interacts with vitals). TASK-713 memo accepted.

### Scope

`src/core/combat-arena.ts` + a small flask module, item catalog flask
affix interpretation (existing recovery/charge affixes become live),
combat input adapter (keys 1–4), shell contracts + HUD flask row in
`App.tsx`/`styles.css`, unit tests (charges, affix scaling, dead/full
no-ops), one e2e spec.

### Out of Scope

Flask persistence of charges, new flask types/affixes, drag-to-assign
flask UI changes, buff-granting flasks, numbers design (713 owns it).

### Acceptance Criteria

1. With a health flask in slot 1, key 1 restores the memo's amount and
   spends one charge; empty charges and full health are no-ops with
   feedback; mana flask mirrors via its slot.
2. Kills add charges per the memo; zone entry refills.
3. Dead players cannot drink; keys 1–4 do nothing in menus/text entry.
4. Full suite green; DEC-038 recorded at acceptance.

### Testing

Unit + e2e above; manual: equip both flask types, fight the Ashtrail
pack drinking through it.

---

## TASK-712 — Gold Drops and Inventory Gold Counter

### Owner

Gameplay Engineer (loot spawning), after TASK-707. TASK-713 numbers are
a dependency.

### Objective

Enemies drop gold per the TASK-713 table (per-kill roll scaled by rank:
normal/elite/boss; deterministic through the existing seeded loot
generator so replays stay reproducible); gold renders as a distinct
world drop that **auto-collects on walk-over** into the character's gold
total (the 705B field); the inventory panel shows a gold counter. Gold
persists via the save (blob field; DEC-032 ledger extraction stays
future — nothing spends gold yet, the vendor still barters ore).

### Dependencies

TASK-705B merged (field exists), TASK-713 memo, TASK-707 completed by
the same owner first (§5 sequencing; no technical dependency).

### Scope

`src/core/enemy-loot.ts` (gold roll in the deterministic generator),
`src/core/combat-arena.ts` (gold drops, walk-over collection, total),
Phaser world drop presentation (coin marker + amount label), inventory
UI gold counter line (small addition; coordinate the `App.tsx` window
with 709/711 per §5), unit tests (rank scaling, determinism, save
round-trip with nonzero gold), one e2e spec (kill → walk over →
counter increments → reload → persists).

### Out of Scope

Spending gold (vendor gold prices are a future economy task), wallets/
ledger tables, gold from chests/quests, pickup radius tuning beyond the
walk-over default, drop numbers design (713 owns it).

### Acceptance Criteria

1. Kills drop gold per the memo table; the same seed reproduces the same
   rolls; boss > elite > normal on expectation.
2. Walk-over collects instantly (no F key); counter updates; reload
   persists the total.
3. Full suite green; DEC-039 recorded at acceptance (with the 705B field
   note).

### Testing

Unit + e2e above; manual Hollowdeep run (Bruiser + Embercleft drops).

---

## TASK-713 — Systems Numbers Memo (Flasks, Gold, Death Cost)

### Owner

Systems Designer. **Design memo only — no code.** Launches immediately
in wave 1.

### Objective

A short committed memo (`docs/tasks/TASK-713-NUMBERS.md`) specifying:
flask base restore amounts (health/mana), base/max charges, per-kill
charge gain, any shared drink cooldown, and how the existing DEC-022
flask affixes scale each; the gold drop table (per-rank base ranges and
expected values vs. the DEC-023 XP curve so gold/hour tracks kill
difficulty); a recommendation confirming or amending the v1
no-death-penalty rule; and (advisory) whether Common/Magic/Rare should
modulate gold. Balance targets stated as playtest hypotheses, not
certainties.

### Dependencies

None. Consumed by 711 and 712.

### Acceptance Criteria

Every number 711/712 need exists with one-line rationale; Director
accepts the memo; deviations later require editing the memo, not
scattering constants.

---

## TASK-714 — Phase 8 Kickoff QA Gate

### Owner

QA Reviewer (independent; implementers do not self-certify).

### Instructions

After 707–712 merge: verify each packet's acceptance criteria on the
built dist and the live site (homepage → signup → create character →
tutorial → die → respawn → flasks → gold → save → second-browser
continue); regression the full Phase 1–7 loop including local-only and
`?autostart` paths; confirm the API negative tests (ownership, slot
limit, name rules) against the live droplet; confirm no copyrighted
content entered homepage/lore text; full local four-browser matrix
(DEC-033 skips documented); explicit PASS/FAIL per packet with evidence.

---

# 4. Sequencing and Launch Order

```
NOW      TASK-705B (gold field) → Systems Designer verdict → merge 705
WAVE 1   TASK-707 (Gameplay)  ∥  TASK-708 (UI)  ∥  TASK-710 (Combat)  ∥  TASK-713 (Systems, memo)
WAVE 2   TASK-709 (UI, after 708+705B; mock 707 if needed)
         TASK-711 (Combat, after 710 + 713)
         TASK-712 (Gameplay, after 707 + 713 + 705B)
WAVE 3   TASK-714 (QA gate)
```

- Wave 1 is safe parallelism: four different owners, disjoint files
  (server/, homepage entry, combat core, docs), each in its own worktree
  like 705/706.
- **`App.tsx`/`styles.css` ownership windows (the collision zone):**
  TASK-710 (death overlay) → TASK-711 (flask row) → TASK-708's game-side
  edits if any (it mostly lives in the new homepage entry) → TASK-709
  (menu rewrite, biggest, last). No parallel edits to these two files,
  ever.
- **E2e spec churn window:** TASK-708's `/play/` goto edits touch ~20
  specs — 708 should merge before 709/711/712 write their new specs (or
  those specs are written `/play/`-native per this plan).
- TASK-712 sits after 707 purely because both belong to the Gameplay
  Engineer; if a second gameplay-capable agent frees up, 712 can start
  any time after 705B + 713.

---

# 5. Runbook Part B Refresh

`docs/OWNER-SETUP-RUNBOOK.md` Part B (steps 12–15) is refreshed alongside
this plan to the concrete layout TASK-707 will produce (`server/`
workspace, compose file pulled via the deploy checkout at
`/opt/lootdivers/app`, `.env` variables, automatic startup migrations,
`server/backup.sh` cron). The owner executes Part B **when TASK-707
merges**, not before. If 707's implementation deviates, updating the
runbook is inside 707's scope (acceptance criterion 1).

---

# 6. Proposed Decision Records (drafted here, recorded at acceptance)

- **DEC-035 (with TASK-708):** Site architecture — one Vite multi-page
  build; `/` homepage, `/play/` game; repo-file news; automation
  parameters preserved at `/play/`; alternatives (in-app routing, second
  Pages project) rejected as above.
- **DEC-036 (with TASK-707, amended by 709 if needed):** Accounts and
  character identity — server columns for name/class/level metadata,
  per-account case-insensitive uniqueness, naming rule regex, 4 slots,
  argon2id + hashed opaque session cookies, custom-domain-only
  authenticated play, local gateway retained for logged-out/dev/
  automation; blob stays verbatim (DEC-032/034 unchanged).
- **DEC-037 (with TASK-710):** Death and respawn — death screen,
  per-zone `respawnZoneId` town respawn, vitals refilled, v1 zero death
  penalty, save-at-respawn closing the DEC-034 rewind.
- **DEC-038 (with TASK-711):** Flask consumption — keys 1–4, instant
  affix-scaled restore, transient charge model per the TASK-713 memo.
- **DEC-039 (with TASK-712, plus a DEC-034 amendment note from 705B):**
  Gold — save v1 field, deterministic rank-scaled drops, walk-over
  collection, blob-resident per DEC-032 with the ledger extraction still
  future.

No new owner sign-offs are required — the directive covers all of the
above verbally, and no new third-party accounts or costs are introduced.

---

# 7. Owner Inputs and Flags

1. **Domain string (blocking for 707's production config):** the only
   hard missing input. Everything else proceeds.
2. **Character slots = 4** (changeable cheaply; say the word).
3. **v1 death penalty = none** — deliberate vertical-slice choice;
   TASK-713 will recommend whether a later cost (gold fee, XP debt) fits
   the economy.
4. **News editing = Git commits** to a repo JSON file; if you want a
   no-Git editing path later, that becomes a small API/admin feature.
5. **Local-save upload** ("adopt my offline character into my account")
   is deferred — flagged as a nice-to-have, not in any packet.

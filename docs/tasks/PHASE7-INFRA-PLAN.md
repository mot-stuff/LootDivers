# Phase 7 Infrastructure Plan — Site, Database/Accounts, Sequencing

Director planning deliverable, 2026-09-05. Owner directive: before TASK-705
(character save DTO) and the eventual accounts/saved-progress work, build out
"the site and db/ci". CI shipped at `8d90245`
(`.github/workflows/ci.yml`: typecheck, lint, content checks, unit, component,
build, 4-browser e2e on push/PR to main). This document plans the remaining
two legs — game deployment and the accounts/cloud-save backend — plus
sequencing. **This is a plan only; no implementation accompanies it.**

Repository facts this plan is grounded in:

- The game is a static Vite build: one ~1.57 MB hashed JS chunk (Phaser
  dominates), ~26 KB CSS, `index.html`, and ~7 MB of PNGs under
  `public/assets/` (branding logo 1.6 MB, favicon 968 KB, barbarian
  spritesheets ~4.5 MB). No server component exists today.
- `vite.config.ts` does not set `base`; the artifact assumes it is served
  from the origin root (`/`).
- The `?autostart`, `automation`, `fullFixture`, and `persistenceTest` query
  parameters (DEC-031) must keep working on the deployed site so remote
  smoke tests can bypass the main menu.
- `src/persistence/` is the DEC-014 machinery: versioned envelopes
  (`SaveEnvelopeV2`), SHA-256 checksums, ordered migrations with provenance,
  generation/backup rotation, export/import — currently carrying only the
  Phase 0 `FixtureSaveState`. TASK-705 gives it a real character payload.
- The roadmap Final Phase records owner intent: DigitalOcean for the
  website, an already-owned URL, GitHub for code and image hosting "so we
  don't use up bandwidth." This plan honors that intent where it still makes
  sense and flags where a better free option now exists (see §1.4).

---

# 1. Site — Game Deployment

## 1.1 Requirements

- Serve the exact CI-tested static artifact from the GitHub repo, deployed
  automatically when main is green (DEC-015: immutable artifact promotion).
- Zero or near-zero cost for a solo owner at hobby traffic.
- Handle the payload without bandwidth anxiety: a cold load is ~2.6 MB of
  JS/CSS/HTML plus up to ~7 MB of PNGs as zones/menus load them.
- Custom domain later (the owner already owns a URL); HTTPS required.
- No base-path or query-parameter breakage: `?autostart` and friends must
  work identically to loopback preview.
- Long-cache hashed assets (`dist/assets/*`), never-stale `index.html`.

## 1.2 Candidates

**GitHub Pages.** Free, lives inside the repo we already have, deploys via
`actions/deploy-pages` from the existing workflow. Two real costs: (a)
project sites serve from `https://<user>.github.io/LootDivers/`, so
`vite.config.ts` needs `base: "/LootDivers/"` — a code change with e2e
implications, which then needs undoing or conditionalizing when the custom
domain (served from `/`) arrives; (b) no control over response headers, so
no immutable-cache tuning, and a soft 100 GB/month bandwidth budget that a
~10 MB payload could plausibly dent if the game gets shared around. Usage
limits also formally position Pages for project sites rather than
applications.

**Cloudflare Pages.** Free tier with unlimited static bandwidth and
unlimited requests; serves from the origin root (no `base` change, custom
`*.pages.dev` subdomain immediately); `public/_headers` file gives exact
cache-control per path; free custom domain attachment later; per-PR preview
deployments; deployable from GitHub Actions via `wrangler pages deploy` so
the CI gate stays the sole promotion authority. File limits (25 MB/file,
20k files) are far above our needs. Also the natural on-ramp if the backend
ever lands on Workers/D1 (§2), without committing us to that.

**Netlify.** Free tier is 100 GB bandwidth + 300 build minutes/month.
Competent, but no advantage over Cloudflare for a pure static artifact, and
the bandwidth cap is the thing we most want to eliminate.

**Vercel.** Hobby tier is non-commercial with 100 GB bandwidth; optimized
for frameworks/SSR we don't use. Same verdict as Netlify.

**DigitalOcean (roadmap Final Phase intent).** App Platform's free static
tier includes only ~1 GiB outbound transfer/month — unworkable for our
payload — and a droplet is ~$6+/month plus TLS/patching/ops burden for
what is currently a folder of files. DigitalOcean remains a sensible home
for the *backend/API* in the final phase if the owner prefers it; it is the
wrong tool for free static game hosting today.

## 1.3 Recommendation

**Cloudflare Pages**, deployed from the existing GitHub Actions workflow.

One-line rationale: it is the only zero-cost option with unlimited
bandwidth, needs no base-path code change now or when the custom domain
arrives, and gives us cache-header control for the hashed artifact.

Runner-up: GitHub Pages, acceptable if the owner prefers zero new accounts,
at the cost of a base-path change (and later un-change), no cache-header
control, and a bandwidth ceiling.

## 1.4 Note on the roadmap's "host images on GitHub" intent

That intent was a bandwidth hedge. With Cloudflare's unlimited static
bandwidth, splitting images to a separate GitHub-served origin buys nothing
and costs a second asset pipeline plus CORS/caching complexity. Recommend
dropping it; the roadmap line can be amended when DEC-032 is accepted.
Separately, DEC-031 already flagged the 968 KB favicon; TASK-706 includes a
lossless PNG optimization pass (no resizing, no visual change) to shrink
first-load weight.

## 1.5 Pipeline design

Extend `.github/workflows/ci.yml` (or a sibling `deploy.yml` triggered by
`workflow_run`; implementer's choice — same-file `needs:` is simpler):

1. The existing `gates` job additionally uploads `dist/` as a workflow
   artifact (it already builds it before e2e).
2. A `deploy` job with `needs: gates`, gated
   `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`,
   downloads that artifact and runs
   `wrangler pages deploy` against the Pages project, using
   `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets. The
   deployed bytes are exactly the tested bytes — no rebuild.
3. A `public/_headers` file ships `cache-control: public, max-age=31536000,
   immutable` for `/assets/*` and `no-cache` for `/` and `/index.html`.
4. Post-deploy smoke: one Playwright check against the live URL
   (`?autostart`, assert the WebGL2 boot diagnostic) — either as a final CI
   step or a manual QA command in v1; the task packet makes it required.

PR builds do not deploy (the gate already validates them). Preview
deployments per PR are a free Cloudflare feature we can turn on later; not
required for v1.

---

# 2. Database, Accounts, Cloud Saves

## 2.1 Architectural stance (binding for this phase)

**The save DTO is client-defined and backend-agnostic.** TASK-705 defines a
versioned character envelope (DEC-014 machinery: format id, formatVersion,
revision, checksum, migration provenance, payload). The backend's entire job
is: authenticate a user, store their character blobs, and return them. It
never parses the payload, never computes game state, and never becomes a
schema authority. Game logic does not move server-side in this phase. This
keeps the deterministic core intact, keeps every backend candidate
swappable, and keeps TASK-705 fully decoupled from backend selection.

**Trust model: single-player trust, explicitly documented.** The client is
untrusted in principle (GAME_VISION "Client Trust"), but until multiplayer,
trading, or leaderboards exist there is nothing to protect from the player
but their own save file. Anti-cheat, server-side validation of blob
contents, and authoritative simulation are **out of scope** and recorded as
such in DEC-032. The server enforces only: valid session, blob belongs to
user, envelope-shape sanity, and a size cap (recommend 1 MB/character to
start). When the auction house / shared economy arrives (Final Phase), that
feature — not this one — must introduce server-authoritative state; this
blob store must not be mistaken for it.

## 2.2 Candidates

**Supabase (Postgres + Auth).** First-party email/password auth (plus OAuth
later), managed Postgres, and row-level security meaning the v1 blob store
needs **zero custom server code**: `supabase-js` from the client, one
`characters` table, RLS policy `user_id = auth.uid()`. Free tier: 500 MB
database, 50k monthly active users — orders of magnitude above need.
Lock-in is low where it matters: the data is plain Postgres (one `pg_dump`
away from the owner's DigitalOcean/Postgres final-phase intent), and the
client touches it only through a thin `SaveGateway` adapter we own. Known
wart: free projects pause after ~1 week of inactivity and need a dashboard
unpause — annoying, visible, and acceptable at hobby scale (documented in
the epic packet).

**Firebase (Auth + Firestore).** Auth is equally easy, but Firestore is a
proprietary NoSQL API (highest lock-in of the candidates) and its 1 MB
document limit sits uncomfortably close to a growing character blob
(items × affixes × materials × quest state). Escaping to Postgres later is
a real migration, not an export. Not recommended.

**Cloudflare Workers + D1/KV.** Generous free tier (D1: 5 GB, 5M
reads/day), pairs with the Pages hosting choice, and D1 is SQLite
(exportable). The decisive cost: **no first-party auth product** — we would
hand-roll or adopt a library for password hashing, sessions, email
verification, and password reset. That is precisely the security-sensitive
code a solo project should not own for a v1 whose only feature is
load/save. Strong second choice if the owner strongly prefers a
single-vendor setup.

**Self-hosted Node + Postgres (DigitalOcean droplet).** Maximum control and
matches the roadmap's Final Phase words, but costs real money now
(~$6–12/month), plus TLS, backups, patching, and hand-rolled auth — all for
a v1 that a managed free tier serves better. The right time for
DigitalOcean is when a real API server exists (auction house, multiplayer);
choosing Supabase-on-Postgres now keeps that door open with a trivial data
migration.

## 2.3 Recommendation

**Supabase**: managed Postgres + first-party auth, zero custom server code
for the blob model, $0 at hobby scale, and plain-Postgres data that can move
to the owner's DigitalOcean plan later with a dump/restore.

One-line rationale: it is the only candidate where accounts + cloud saves
require no security-sensitive code we write ourselves, at zero cost, without
meaningful lock-in.

## 2.4 Minimal v1 surface

Client-side, everything hides behind a `SaveGateway` port (name indicative)
so IndexedDB (TASK-705) and Supabase (TASK-707) are sibling adapters:

- `signUp(email, password)` / `signIn(email, password)` / `signOut()` /
  `session()` — delegated wholesale to Supabase Auth.
- `listCharacters()` → `[{characterId, name, level, updatedAt}]` — from
  metadata columns the client writes alongside the blob (server never
  derives them from the payload).
- `saveCharacter(characterId, envelope)` — upsert.
- `loadCharacter(characterId)` → envelope.

Nothing else: no leaderboards, no telemetry, no trading, no admin surface.

Indicative table (final shape is TASK-707 work):

```sql
create table characters (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  name         text not null,
  level        integer not null default 1,
  format_version integer not null,
  revision     integer not null,
  blob         jsonb not null,        -- the DEC-014 envelope, opaque
  checksum     text not null,
  updated_at   timestamptz not null default now()
);
-- RLS: user_id = auth.uid() for select/insert/update/delete
```

## 2.5 Blob versioning and migration strategy

- The envelope's `formatVersion` + `migrationProvenance` (already in
  `src/persistence/contracts.ts`) are the versioning mechanism; the server
  stores `format_version` as an opaque integer column for observability
  only.
- **Migrations run client-side**, using the existing DEC-014 ordered
  migration machinery: load blob → if older version, migrate in memory →
  play → next save writes the current version. The server never migrates.
- A client older than a stored blob refuses to load it with a clear
  "update your game" error (client-side check; the static host always
  serves the newest client, so this is a cached-tab edge case).
- Conflict policy for v1: **last-write-wins**, with the server retaining
  the previous blob revision per character (one-deep history, mirroring
  the local generation/backup pattern) so a bad overwrite is recoverable.
  Multi-device merge UX is explicitly deferred.

## 2.6 Local/cloud relationship

IndexedDB (TASK-705) remains the always-on local save; cloud save is a
sync layer above it, not a replacement. Offline play keeps working; sign-in
enables push/pull of the same envelope. This is why TASK-705 must not know
anything about Supabase.

---

# 3. Sequencing

Confirmed with one refinement:

- **TASK-705 (character save DTO + local save/load) and TASK-706 (site
  deployment) run in parallel.** Zero file overlap: 705 touches
  `src/core` snapshot/restore, `src/persistence`, and the Continue button;
  706 touches `.github/workflows/`, `public/_headers`, and docs. Different
  owners, different branches.
- **TASK-707 (accounts/cloud saves) starts only after both** TASK-705
  merges (the blob it stores must exist) **and the owner signs off on
  DEC-032's backend direction** (third-party account creation — see §5).
  Site deployment (706) is not a hard dependency of 707, but in practice
  it lands first and gives QA a real origin to test auth against.

Proposed order: **TASK-706 ∥ TASK-705 → TASK-707.**

---

# 4. Task Packets

## TASK-706 — Site Deployment (Cloudflare Pages)

### Owner

Director (infra/workflow work, matching CI ownership), with QA Reviewer
verifying the live deployment independently.

### Objective

Every green push to main automatically publishes the CI-tested `dist/`
artifact to a public HTTPS URL on Cloudflare Pages; the deployed game is
byte-identical to what the gate tested and boots correctly for both real
players and automation.

### Dependencies

CI workflow (`8d90245`) merged — done. **OWNER SIGN-OFF required before
starting:** Cloudflare account creation (§5). Custom domain attachment is a
separate later owner action, not part of this task.

### Scope

- `.github/workflows/ci.yml` (artifact upload + deploy job) or a sibling
  `deploy.yml`.
- New `public/_headers` (cache policy).
- Lossless PNG optimization pass over `public/assets/` (oxipng/equivalent;
  no resizing, no palette reduction that changes pixels).
- GitHub repo secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) —
  values supplied by the owner.
- Docs: ROADMAP Final Phase hosting note, DEC-032 recording at acceptance.

### Out of Scope

- Custom domain wiring (later owner action; the `*.pages.dev` URL is v1).
- Any change to `vite.config.ts` `base`, game code, or query parameters.
- Preview deployments per PR, staging environments, rollback automation.
- Backend of any kind; analytics; error reporting.
- Resizing or visually altering branding/spritesheet art.

### Acceptance Criteria

1. A push to main that passes the full gate suite auto-publishes to the
   Pages URL; a push that fails any gate publishes nothing.
2. The deployed bytes are the gate-job artifact (no rebuild in the deploy
   job).
3. The live URL with no query parameters shows the Loot Divers main menu;
   New Game reaches the tutorial zone with input live.
4. The live URL with `?autostart` boots straight into gameplay exactly as
   on loopback preview (base path `/` intact, all assets 200).
5. `/assets/*` responses carry `max-age=31536000, immutable`;
   `/index.html` is `no-cache` (verified with curl or browser devtools).
6. PNG optimization is byte-lossless per-pixel (tool-verified) and the
   total `public/assets/` weight is reported before/after.
7. One Playwright smoke run against the live URL passes (documented
   command; wired into CI post-deploy if straightforward, otherwise a
   recorded manual QA step).

### Testing

CI run on a trivial main push; live-URL manual pass (menu, New Game,
tutorial prompt, `?autostart`); header inspection; QA Reviewer repeats
independently and issues PASS/FAIL.

### Files / Systems

`.github/workflows/`, `public/_headers`, `public/assets/` (optimized
bytes), `docs/ROADMAP.md`, `docs/DECISIONS.md` (DEC-032 at acceptance).

---

## TASK-705 — Character Save DTO and Local Save/Load (refreshed)

Refreshed from the PHASE7-KICKOFF.md stub against the current codebase
(post TASK-702B/703/704, commit `8d302e0`).

### Owner

Gameplay Engineer (implementation) with **Systems Designer as required
schema reviewer** (sign-off on the DTO before the persistence wiring is
built on it); UI Engineer enables the Continue button last.

### Objective

A versioned character save DTO and `CombatArenaSimulation`
snapshot/restore, persisted through the DEC-014 IndexedDB machinery, with
the main-menu Continue button enabled when a valid save exists.

The DTO must capture, minimally:

- character progression: XP, level, unspent/spent attribute points,
  attribute allocations, mastery ranks (DEC-023);
- generated item instances with base id, rarity, rolled affixes with
  tiers/values, origin (dropped/crafted), and stack counts where
  applicable (DEC-019–022);
- inventory contents (48 slots), all nine equipment slots, flask slots;
- ability ownership and the LMB/Q/E/R loadout (DEC-019/023);
- materials/ore stacks and Mining/Smithing profession XP (DEC-024);
- quest stage (Roadwarden) and vendor-relevant state (DEC-025);
- tutorial banked-step state per the DEC-030 amendment (`TutorialTracker`
  banks verbs individually; persist the banked set, not just a boolean);
- current zone id; player position may reset to the zone spawn point
  (implementer's choice, document it).

Persistence shape: a new envelope format id (e.g.
`rarpg-character-save`, version 1) reusing the existing
generation/checksum/backup/migration machinery — generalize
`SaveRepository` over payload type or add a sibling repository; do not
break the Phase 0 fixture envelope or its tests. **Design for the DTO to
be backend-agnostic (§2.1): no IndexedDB-specific or Supabase-specific
types may leak into the DTO module.**

Save triggers for v1: explicit save on zone travel and on `pagehide`/
`visibilitychange` (tab close/hide), plus load-on-Continue. No
autosave-interval tuning in this packet.

### Dependencies

TASK-704 PASS (done, `8d302e0`). No dependency on TASK-706 or any backend.

### Scope

- New DTO module (suggest `src/core/character-save.ts` or
  `src/persistence/character-*.ts` split along the existing
  core/persistence boundary — schema reviewer approves placement).
- `src/core/combat-arena.ts` (+ related core modules): snapshot/restore.
- `src/persistence/`: character envelope, repository generalization,
  migrations scaffold (v1 has no migrations; the ordered-migration hook
  must exist).
- `src/main.tsx`, `src/presentation/App.tsx`, shell contracts: Continue
  enablement, save-trigger wiring.
- Unit tests (round-trip, checksum, corrupt-generation fallback),
  component tests (Continue states), one new e2e spec (play → save →
  reload → Continue → state verified).

### Out of Scope

- Accounts, backend, cloud sync (TASK-707).
- Multiple character slots / character picker (Phase 8); v1 is one save
  slot.
- Settings persistence, keybind persistence.
- Any anti-tamper measure beyond the existing checksum (single-player
  trust model, §2.1).

### Acceptance Criteria

1. Full loop: fresh New Game → play (gain XP, loot, equip, craft, travel)
   → reload page → Continue is enabled → Continue restores progression,
   inventory, equipment, loadout, materials, profession XP, quest stage,
   tutorial banked steps, and current zone.
2. A corrupt or checksum-failing active generation falls back to the
   backup generation (existing DEC-014 semantics) with a visible status.
3. Fresh profile (no save) shows Continue disabled with the existing "No
   saved hero yet" note; New Game with an existing save overwrites only
   per an explicit design choice documented in the completion report.
4. `reset()` and default-session semantics are unchanged; all Phase 1–6
   suites stay green.
5. Systems Designer schema review is recorded before the UI enablement
   lands.
6. Full local gate (`typecheck`, `lint`, `content:check`, unit, component,
   build, chromium e2e; full matrix before handoff) passes; CI green.
7. New DEC entry recording the accepted save architecture at acceptance.

### Testing

Commands above; manual playthrough of criterion 1 on the built dist;
export/import sanity check via the existing persistence panel if
applicable.

### Files / Systems

Core snapshot/restore, persistence envelope/repository, shell contracts,
`App.tsx`/`main.tsx`, styles (minor), tests.

---

## TASK-707 — Accounts and Cloud Saves (epic, coarse)

### Owner

Director decomposes at kickoff; expected split: Gameplay Engineer
(SaveGateway adapters, sync flow), UI Engineer (auth/account UI), QA
Reviewer (independent gate). Systems Designer is consulted only if the DTO
needs changes (it should not).

### Objective

A signed-in player's character persists to Supabase and can be continued
from another browser/machine: signup/login, save push on the TASK-705
triggers, load/list on Continue. Local IndexedDB saves keep working
signed-out.

### Dependencies

TASK-705 merged (the envelope exists). **DECISION CHECKPOINT: owner
sign-off on DEC-032 backend direction (§5) — Supabase account creation,
project region, and email confirmation settings — before any implementation
begins.** TASK-706 live URL available for end-to-end QA (soft dependency).

### Scope (indicative — final packets at decomposition)

- Supabase project setup (owner-assisted), `characters` table + RLS.
- Client `SaveGateway` port with IndexedDB and Supabase adapters; sync
  policy per §2.5 (last-write-wins, one-deep server-side revision
  history).
- Auth UI: signup/login/logout on the main menu; session persistence.
- Size cap and envelope-shape sanity check on save.
- Tests: unit (gateway contract, conflict policy), component (auth UI),
  e2e against a test project or mocked gateway (decide at decomposition).

### Out of Scope

- Anti-cheat, server-side validation of blob contents, authoritative
  simulation (§2.1 — documented trust model).
- Multiple character slots (Phase 8), trading, leaderboards, telemetry,
  moderation, OAuth providers, password-reset polish beyond Supabase
  defaults.
- Any migration of game logic server-side.

### Acceptance Criteria (epic-level)

1. Signup → play → save lands in Supabase (visible in table editor) →
   different browser → login → Continue restores the character.
2. Signed-out play is unchanged (local saves only, no errors, no nags
   beyond a sign-in affordance).
3. RLS verified: one user cannot read/write another's rows (negative
   test).
4. The DTO module remains backend-agnostic (no Supabase imports outside
   the adapter).
5. Full gate suite green; independent QA PASS; DEC entry recording the
   accepted implementation.

### Testing

Defined per-packet at decomposition; epic-level: the two-browser
round-trip above plus the RLS negative test.

---

# 5. DEC-032 Draft — DO NOT APPEND TO DECISIONS.md YET

Items marked **[OWNER SIGN-OFF]** must be explicitly approved by the owner
before the corresponding implementation starts. The Director may not
self-approve them: they involve third-party accounts, potential cost, and
the owner's domain.

---

## DEC-032 (DRAFT — pending owner sign-off)

### Status

Draft. Hosting direction pending owner sign-off on Cloudflare account
creation; backend direction pending owner sign-off on Supabase account
creation. Custom-domain attachment is deferred to a separate owner action.

### Date

2026-09-05

### Decision

**Hosting:** deploy the static Vite artifact to Cloudflare Pages from the
existing GitHub Actions gate — the deploy job publishes the exact tested
`dist/` artifact on green main pushes only, with immutable cache headers
for hashed assets and no-cache for `index.html`. The Vite base path stays
`/`; `?autostart` and the other DEC-031 query parameters work identically
on the deployed origin. **[OWNER SIGN-OFF: create the Cloudflare account
and Pages project; supply API token/account id as repo secrets.]**
**[OWNER SIGN-OFF (later, separate): attach the owner's custom domain.]**

**Backend direction for accounts/cloud saves:** Supabase (managed Postgres
+ first-party auth), used strictly as a blob store per the binding stance
below. **[OWNER SIGN-OFF: create the Supabase project (free tier) and
approve email/password auth; confirm this supersedes or defers the
roadmap's DigitalOcean-for-website intent — DigitalOcean remains the
candidate home for a future real API server (auction house/multiplayer),
and Supabase's plain Postgres keeps that migration to a dump/restore.]**

**Binding architectural stance:** the character save DTO (TASK-705) is
client-defined and backend-agnostic. The backend stores and returns
versioned, checksummed character envelopes plus identity; it never parses
payloads, never migrates blobs (migrations run client-side via the DEC-014
ordered-migration machinery), and owns no game logic. Server-side
enforcement is limited to authentication, row ownership (RLS),
envelope-shape sanity, and a size cap. Conflict policy is last-write-wins
with a one-deep server-side revision history.

**Trust model:** single-player trust. Anti-cheat and server-side
validation of save contents are explicitly out of scope until a shared
economy, trading, leaderboards, or multiplayer exist; whichever feature
introduces shared state must introduce server-authoritative handling of
that state and must not treat this blob store as sufficient.

### Context

Phase 7 reached the point (post TASK-704, GitHub remote and CI live at
`8d90245`) where the owner wants the site and database/accounts groundwork
before TASK-705 and saved progress. The game is a pure static artifact
(~1.57 MB JS + ~7 MB PNGs) with a deterministic, framework-independent
core and a DEC-014 envelope persistence layer that generalizes directly to
a character blob.

### Options Considered

Hosting: GitHub Pages, Cloudflare Pages, Netlify, Vercel, DigitalOcean
(App Platform static / droplet). Backend: Supabase, Firebase
(Auth + Firestore), Cloudflare Workers + D1/KV, self-hosted Node/Postgres
on DigitalOcean.

### Chosen Approach

Cloudflare Pages for hosting; Supabase as a blob-store backend behind a
client-owned `SaveGateway` port with IndexedDB as the sibling local
adapter.

### Why

Cloudflare Pages is the only zero-cost host with unlimited static
bandwidth, zero base-path churn now or after the custom domain, and cache
header control. Supabase is the only backend candidate where accounts plus
cloud saves require no security-sensitive custom server code, at $0 hobby
scale, storing plain Postgres that can later move to the owner's
DigitalOcean plan with a dump/restore. Firebase's document limit and
proprietary API, Workers+D1's hand-rolled auth, and a droplet's cost/ops
burden all lose to that combination for a v1 whose entire surface is
signup/login and load/save.

### Tradeoffs

- Two third-party accounts (Cloudflare, Supabase) enter the project.
- Supabase free projects pause after ~1 week of inactivity and need a
  manual unpause; acceptable at hobby scale, revisit if it bites.
- Last-write-wins can lose progress across simultaneous devices; the
  one-deep revision history is the recovery hatch, and merge UX is
  deferred.
- Client-side saves remain user-tamperable by design (documented trust
  model); nothing here is reusable as an economy-integrity mechanism.
- The roadmap's "host images on GitHub" bandwidth hedge is dropped as
  unnecessary under Cloudflare's bandwidth terms.

### Systems Affected

- CI/CD workflow and deployment
- Persistence (`SaveGateway` port, Supabase adapter in TASK-707)
- Main menu (auth UI, Continue)
- docs/ROADMAP.md Final Phase hosting/backend wording

### Relationship to Earlier Decisions

DEC-015's immutable-artifact promotion is implemented (gate artifact →
deploy). DEC-017's deferred public-HTTPS obligation is discharged by
TASK-706. DEC-014 persistence machinery is reused unchanged in direction;
DEC-031's Continue deferral resolves via TASK-705. DEC-001 (single-player
first) governs the trust model.

---

# 6. Owner Sign-off Checklist (blocking items only)

1. **Cloudflare account + Pages project** (blocks TASK-706 start).
2. **Supabase project + email/password auth** (blocks TASK-707 start; not
   needed for TASK-705/706).
3. **DigitalOcean intent** — confirm DO is deferred to a future real API
   server rather than the static site (roadmap wording will be amended).
4. **Custom domain** — later, whenever the owner wants it on the Pages
   project; zero code impact.

TASK-705 requires no sign-off and can start immediately.

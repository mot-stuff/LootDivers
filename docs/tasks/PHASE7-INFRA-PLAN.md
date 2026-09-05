# Phase 7 Infrastructure Plan — Site, Database/Accounts, Sequencing

Director planning deliverable, 2026-09-05. Owner directive: before TASK-705
(character save DTO) and the eventual accounts/saved-progress work, build out
"the site and db/ci". CI shipped at `8d90245`
(`.github/workflows/ci.yml`: typecheck, lint, content checks, unit, component,
build, 4-browser e2e on push/PR to main). This document plans the remaining
two legs — game deployment and the accounts/cloud-save backend — plus
sequencing. **This is a plan only; no implementation accompanies it.**

> **Update 2026-09-05 (owner decisions recorded — see DEC-032 in
> `/docs/DECISIONS.md`):** the owner signed off on Cloudflare Pages for the
> site, confirmed the domain is purchased with DNS on Cloudflare, and
> **overrode §2.3's Supabase recommendation: the backend and Postgres
> database will be self-hosted on the owner's existing DigitalOcean
> droplet**, motivated by the desired trajectory toward tracking player
> gold, progress, characters, and eventually an auction house. §2.2–2.3 are
> retained below as the evaluation record; TASK-707 now names the concrete
> self-hosted stack. The owner's manual steps live in
> `/docs/OWNER-SETUP-RUNBOOK.md`.

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

## 2.3 Recommendation — SUPERSEDED BY OWNER DECISION

Original recommendation (2026-09-05, morning): **Supabase** — managed
Postgres + first-party auth, zero custom server code for the blob model,
$0 at hobby scale, and plain-Postgres data that can move to the owner's
DigitalOcean plan later with a dump/restore.

**Owner decision (2026-09-05, recorded in DEC-032): self-hosted on the
owner's existing DigitalOcean droplet** — Node/TypeScript API (Fastify) +
Postgres, run via Docker Compose, behind Caddy with a Cloudflare Origin
certificate on `api.<yourdomain.com>` (Cloudflare-proxied). The droplet
already exists (sunk cost), and the owner explicitly wants owned
infrastructure that can grow into tracking player gold, progress,
characters, and an auction house — a server-authoritative trajectory that
self-hosted Postgres serves directly, eliminating the later
Supabase-to-droplet migration. The tradeoff accepted with it: we now own
auth (argon2id password hashing + opaque session tokens — no JWT
complexity), TLS, backups, and patching; the runbook and epic packet
mitigate each.

## 2.4 Minimal v1 surface (updated for the self-hosted decision)

Client-side, everything hides behind a `SaveGateway` port (name indicative)
so IndexedDB (TASK-705) and the droplet API (TASK-707) are sibling
adapters. The HTTP surface on `api.<yourdomain.com>`:

- `POST /auth/signup`, `POST /auth/login`, `POST /auth/logout`,
  `GET /auth/session` — email/password with argon2id hashing; opaque
  session token in an `HttpOnly` cookie backed by a `sessions` table.
- `GET /characters` → `[{characterId, name, level, updatedAt}]` — from
  metadata columns the client writes alongside the blob (server never
  derives them from the payload).
- `PUT /characters/:id` — upsert the envelope (size cap, shape sanity).
- `GET /characters/:id` → envelope.
- `GET /healthz` — deploy/uptime probe.

Nothing else: no leaderboards, no telemetry, no trading, no admin surface.

Indicative schema (final shape is TASK-707 work). Designed so the economy
trajectory adds tables without migrating these:

```sql
create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,          -- argon2id
  created_at    timestamptz not null default now()
);

create table sessions (
  token_hash  text primary key,         -- server stores only the hash
  user_id     uuid not null references users (id) on delete cascade,
  expires_at  timestamptz not null
);

create table characters (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users (id) on delete cascade,
  name           text not null,
  level          integer not null default 1,
  format_version integer not null,
  revision       integer not null,
  blob           jsonb not null,        -- the DEC-014 envelope, opaque
  checksum       text not null,
  updated_at     timestamptz not null default now()
);
-- ownership enforced in the API layer: every query filters by the
-- session's user_id
```

**Economy/gold trajectory (owner scope signal — design note, not v1
work):** when gold ships as a game feature, it lives **inside the
character blob** like every other stat — v1 stays a pure blob store. The
documented extraction path for when trading/auction house arrives: add
`wallets` (character_id, balance) and `ledger_entries` (append-only:
wallet_id, delta, reason, reference, created_at) tables; a one-time
migration seeds each wallet from the blob's gold field; from then on the
server's wallet balance is authoritative, the blob's gold field becomes a
client-side display cache, and every gold mutation that touches shared
economy flows through a ledger entry. Because `users` and `characters`
have stable UUID keys from day one, that migration adds tables and one
backfill — it never reshapes existing ones.

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
anything about the backend.

---

# 3. Sequencing

Confirmed with one refinement:

- **TASK-705 (character save DTO + local save/load) and TASK-706 (site
  deployment) run in parallel.** Zero file overlap: 705 touches
  `src/core` snapshot/restore, `src/persistence`, and the Continue button;
  706 touches `.github/workflows/`, `public/_headers`, and docs. Different
  owners, different branches.
- **TASK-707 (accounts/cloud saves) starts only after both** TASK-705
  merges (the blob it stores must exist) **and the owner completes the
  runbook's Part A droplet preparation** (`/docs/OWNER-SETUP-RUNBOOK.md`
  steps 1–10; the DEC-032 backend sign-off itself is already recorded).
  Site deployment (706) is not a hard dependency of 707, but in practice
  it lands first and gives QA a real origin to test auth against.

Proposed order: **TASK-706 ∥ TASK-705 → TASK-707.** TASK-705 remains the
next implementation work and does not block on any owner manual step.

---

# 4. Task Packets

## TASK-706 — Site Deployment (Cloudflare Pages)

**Status: shipped 2026-09-05** (Director). The gates job uploads `dist/`
and a `deploy` job publishes the exact tested artifact via
`wrangler pages deploy` on green main pushes; `public/_headers` ships
immutable caching for hashed build output and a 4-hour revalidating
policy for unhashed art (a deliberate refinement of criterion 5 below —
`/assets/branding/*` and `/assets/characters/*` are stable filenames
whose bytes change with art updates, so blanket-immutable would serve
stale art); the lossless PNG pass cut `public/assets/` from 7,810,859 to
3,910,077 bytes (−49.9%, every rewritten file pixel-verified identical).
Live at https://lootdivers.pages.dev plus the owner-attached custom
domain.

### Owner

Director (infra/workflow work, matching CI ownership), with QA Reviewer
verifying the live deployment independently.

### Objective

Every green push to main automatically publishes the CI-tested `dist/`
artifact to a public HTTPS URL on Cloudflare Pages; the deployed game is
byte-identical to what the gate tested and boots correctly for both real
players and automation.

### Dependencies

CI workflow (`8d90245`) merged — done. Owner sign-off recorded in DEC-032.
Owner manual prerequisites: runbook steps 3–4 (Pages project + GitHub
secrets); the custom-domain attach (runbook step 5) can happen before or
after the first deploy.

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

- Custom domain wiring (owner runbook step 5 — dashboard-only, zero code
  impact; acceptance below runs against whichever of `*.pages.dev` or the
  domain is live).
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

## TASK-707 — Accounts and Cloud Saves on the Droplet (epic, coarse)

### Owner

Director decomposes at kickoff; expected split: Gameplay Engineer (API
service + SaveGateway adapters + sync flow — first backend code in the
repo, Director reviews architecture), UI Engineer (auth/account UI), QA
Reviewer (independent gate). Systems Designer is consulted only if the DTO
needs changes (it should not).

### Objective

A signed-in player's character persists to Postgres on the owner's
DigitalOcean droplet and can be continued from another browser/machine:
signup/login, save push on the TASK-705 triggers, load/list on Continue.
Local IndexedDB saves keep working signed-out.

### Concrete stack (per DEC-032)

- **API: Node/TypeScript + Fastify.** Why Fastify over alternatives: the
  repo has zero backend dependencies today, so the bar is "smallest
  competent TypeScript HTTP server." Fastify is TypeScript-first, has a
  small dependency tree, and validates request/response bodies with JSON
  Schema — the same validation model the content pipeline already uses
  (Ajv, DEC-011), so agents work with one schema idiom across the project.
  Express brings less (no built-in validation, weaker TS); NestJS brings
  far more framework than a five-endpoint API justifies.
- **Auth: owned, minimal.** Email/password with argon2id hashing; opaque
  random session tokens (server stores only the token hash) in `HttpOnly;
  Secure; SameSite` cookies backed by a `sessions` table. No JWT, no
  OAuth, no email verification in v1 (password reset deferred; documented
  limitation).
- **Database: Postgres** in Docker with a named volume; plain SQL
  migrations checked into the repo (no ORM required for three tables —
  decomposition may pick a thin query layer like `postgres`/`pg`).
- **Runtime: Docker Compose** on the droplet — `postgres`, `api`, `caddy`
  services; Caddy terminates TLS with the Cloudflare Origin certificate
  (runbook step 9) behind the proxied `api.<yourdomain.com>` record,
  Cloudflare mode Full (strict).
- **Deploy: GitHub Actions → SSH.** After the gate passes on main, a
  deploy job SSHes to the droplet as the `deploy` user (runbook step 10
  secrets) and runs a repo-shipped pull-and-restart script
  (`git pull && docker compose up -d --build`). Chosen over a container
  registry: no registry account, one moving part, and the manual fallback
  is the same script run by hand.
- **Repo layout:** a `server/` workspace isolated from the game build
  (the Vite artifact must not grow); its own tsconfig, tests in the
  existing Vitest setup, linted by the existing ESLint config.

### Dependencies

TASK-705 merged (the envelope exists). Owner runbook Part A complete
(droplet hardened, Docker installed, origin cert staged, deploy secrets
set — `/docs/OWNER-SETUP-RUNBOOK.md` steps 1–10). Owner runbook Part B
steps 12–14 are performed by the owner during this task's rollout.
TASK-706 live site available for end-to-end QA (soft dependency).

### Scope (indicative — final packets at decomposition)

- `server/`: Fastify API (auth + characters + healthz), SQL migrations,
  Dockerfile, `docker-compose.yml`, Caddyfile, backup script, deploy
  script.
- `.github/workflows/`: API CI job (typecheck/lint/test) + SSH deploy job.
- Client `SaveGateway` port with IndexedDB and HTTP adapters; sync policy
  per §2.5 (last-write-wins, one-deep server-side revision history).
- Auth UI: signup/login/logout on the main menu; session persistence.
- Size cap (1 MB/character to start) and envelope-shape sanity check on
  save; rate limiting on the auth endpoints.
- CORS locked to the game origins (`<yourdomain.com>`, `www`,
  `lootdivers.pages.dev`).
- Tests: unit (gateway contract, conflict policy, auth flows against a
  test Postgres or in-memory fake — decide at decomposition), component
  (auth UI), e2e with a mocked gateway; one documented staging smoke
  against the real droplet.

### Out of Scope

- Anti-cheat, server-side validation of blob contents, authoritative
  simulation (§2.1 — documented trust model).
- Multiple character slots (Phase 8), leaderboards, telemetry,
  moderation, OAuth providers, email verification/password reset.
- **The auction house and any shared economy — see Future trajectory
  below.** Nothing in this epic implements trading, wallets, or ledgers.
- Any migration of game logic server-side.

### Future trajectory (design constraint, not deliverable)

The owner's stated direction is infrastructure that can eventually track
player gold, progress, characters, and an auction house. This epic
positions for that without building it: stable UUID keys on `users` and
`characters` from day one, and the §2.4 ledger-extraction path (add
`wallets` + append-only `ledger_entries`, backfill gold from the blob,
server becomes authoritative for gold thereafter) documented as the
gateway to trading. **The auction house itself is a separate future epic**
gated on the vertical-slice rule and its own decision record: it is the
moment the trust model flips (server-authoritative gold and item custody,
listing/bid/settlement transactions, blob-vs-ledger reconciliation), and
it must not be smuggled in through this packet.

### Acceptance Criteria (epic-level)

1. Signup → play → save lands in droplet Postgres (visible via `psql` in
   the container) → different browser → login → Continue restores the
   character.
2. Signed-out play is unchanged (local saves only, no errors, no nags
   beyond a sign-in affordance).
3. Ownership enforced: an authenticated user cannot read or write another
   user's characters (negative test at the API layer).
4. The DTO module remains backend-agnostic (no HTTP/adapter imports
   outside the adapter).
5. A green main push auto-deploys the API to the droplet;
   `https://api.<yourdomain.com>/healthz` returns healthy through the
   Cloudflare proxy; a failed gate deploys nothing.
6. Daily backup dump verified restorable once (documented drill).
7. Full gate suite green; independent QA PASS; DEC entry recording the
   accepted implementation.

### Testing

Defined per-packet at decomposition; epic-level: the two-browser
round-trip above, the ownership negative test, and the backup restore
drill.

---

# 5. DEC-032 — Recorded

The DEC-032 draft that previously lived in this section was reviewed by
the owner on 2026-09-05. The owner signed off on Cloudflare Pages for the
site and the Cloudflare DNS/domain split, and **replaced the draft's
Supabase backend recommendation with self-hosting on their existing
DigitalOcean droplet** (Node/TypeScript Fastify API + Postgres via Docker
Compose, `api.<yourdomain.com>` proxied through Cloudflare). The accepted
decision is recorded in **`/docs/DECISIONS.md` as DEC-032**; that entry is
now authoritative. The binding blob-store stance (§2.1), versioning
strategy (§2.5), and economy-ledger extraction path (§2.4) carried into it
unchanged.

---

# 6. Owner Actions Remaining

All blocking sign-offs are recorded in DEC-032. What remains for the owner
is execution, not decision — every step lives in
`/docs/OWNER-SETUP-RUNBOOK.md`:

1. **Runbook Part A (do now):** droplet facts, Pages project + GitHub
   secrets, custom-domain attach, `api` DNS record, droplet hardening,
   Docker install, origin certificate, deploy user + secrets. Steps 3–4
   unblock TASK-706; steps 1 and 6–10 unblock TASK-707.
2. **Runbook Part B (when TASK-707 ships):** server `.env`, first compose
   up, backup cron, first deploy verification.

Pending **details** (not decisions): the exact domain string (the runbook
uses `<yourdomain.com>` placeholders) and the droplet facts from runbook
step 1 (OS/RAM/IP/occupied ports — the Ubuntu assumption must be
confirmed before runbook steps 6+ are executed).

TASK-705 requires no owner action and remains the next implementation
work.

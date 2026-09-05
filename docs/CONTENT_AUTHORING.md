# Content Foundation Authoring

TASK-P0-005 provides non-gameplay content contracts and tiny synthetic fixtures.
It does not define production items, abilities, enemies, balance, maps, or zone
content.

## Stable IDs

Every persistent content, stat, tag, and asset identity uses:

`namespace:local/name`

Both segments are non-empty lowercase ASCII. The namespace begins with a letter
and may contain letters, digits, `_`, and `-`. The local name begins with a
letter or digit and may additionally contain `.`, `_`, `/`, and `-`. This is
exactly the shared P0-004 identity contract:

`^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._/-]*$`

IDs are globally unique across registries and definitions. They are immutable
identity, not display text, file paths, or Phaser object names. Do not recycle a
removed ID for a different meaning. A future rename requires an explicit
migration/alias policy; this foundation intentionally does not invent one.

The `core` namespace is reserved for approved project-owned production content.
The checked-in `fixture` namespace is synthetic and must not become gameplay
content.

## Version contracts

- `schemaVersion` selects the structural contract. Tooling currently accepts
  exactly `1.0.0`; unsupported versions fail before compilation.
- `contentVersion` identifies one compatible authored content set. Exactly one
  project document declares the set version, and every source document must
  match it.
- `compilerVersion` describes generated output layout. It is emitted in the
  manifest and is currently `1.0.0`.

Changing a version requires a deliberate compatibility decision. Do not silently
accept newer schema majors or combine documents from different content sets.

## Source layout and validation

Canonical UTF-8 JSON lives under `content/source`. Versioned JSON Schemas live
under `schemas/content/v1`. Exactly one project, stat registry, tag registry,
and asset registry are required. Definitions refer only to registered keys or
other definition IDs.

Typed canonical schema constants in `src/content/schemas.ts` are checked by
TypeScript against source and generated-output contracts, then deterministically
generate the versioned JSON Schema artifacts. Ajv validates source shape and
compiler output. Project semantic validation reports ordinally ordered,
source-relative diagnostics for duplicate IDs and repeated values, unknown
stats/tags/assets, missing definition references, version incompatibility,
invalid stat ranges, and values outside each registered range. Numeric schema bounds are
`[-1,000,000,000, 1,000,000,000]`; narrower stat-specific bounds are mandatory
for values used by definitions.

Asset registry `source` values are normalized forward-slash relative paths.
Absolute paths, URL/protocol forms, backslashes, empty or dot segments,
traversal, and encoded traversal are rejected. Compilation additionally resolves
each path against the configured asset root and verifies containment.

## Verification

The required local and CI content gate is non-mutating:

```powershell
& $npm run content:check
```

It checks typed-schema artifact freshness, validates source, proves two clean
compiler runs are byte-identical, and compares a fresh compilation against
canonical `generated/content`. It never regenerates either committed artifact
set. Do not run `content:compile` before this gate: doing so can repair stale,
missing, or extra generated output and conceal the defect being checked.

## Intentional regeneration

Only after a source or canonical schema change has made the non-mutating gate
fail should an author intentionally regenerate affected artifacts:

```powershell
& $npm run content:generate-schemas # only after canonical schema changes
& $npm run content:compile
& $npm run content:check
```

Review every generated diff before committing it. The final `content:check`
confirms the regenerated artifacts without modifying them.

`content:compile` replaces `generated/content` with canonical JSON chunks and a
manifest containing schema/content/compiler versions, hashes, and stable chunk
keys. Object keys, source traversal, registries, definitions, and reference
arrays use an explicit UTF-16 code-unit comparator. Generated output contains no
timestamps and must not be edited by hand. `content:check-determinism` compares
two clean builds and also fails for stale, missing, or extra files in the
canonical `generated/content` directory.

## Extending the foundation

Add a versioned schema and aligned strict TypeScript contract before adding a
new document kind. Add both positive and malformed-content tests. Keep semantic
rules in project validation when JSON Schema cannot express cross-file
identity, references, or registry-defined bounds. P0-006 owns zone/map schemas;
do not add them here.

## Ability contract fixture

TASK-P0-009 adds the `ability-definition` document kind as a Phase 0 contract,
not production combat content. Definitions use fixed-tick startup, active, and
recovery durations; registered tags/stats; typed targeting, cost, cooldown,
cancellation/refund, stat-capture, and ordered effect policies. Effect arrays
are capped at 64 entries. Trigger references must exist and the content graph
must be acyclic; runtime execution additionally enforces explicit depth and
simulation-tick-scoped aggregate work budgets.

The effect-executor registry is canonical content. Every shared or custom effect
must reference a registered stable executor kind, and runtime composition must
provide that executor before any cost settles. Resource ports distinguish
payment from reservation handles and expose refund, commit, and release.
Cooldown handles similarly make clearing owner-aware.

Stat captures identify both source/target subject and stat ID. Effects may read
declared snapshots while also reading current source or entity-target values.
Target captures and target-recipient effects require entity targeting. Ability
costs cannot exceed their registered resource maximum. Nested trigger requests
are queued FIFO after the parent's ordered effects, independent of child phase
duration. The checked-in `fixture:` abilities and executors are contract
evidence only and must not become gameplay content.

Each activation atomically reserves its complete ordered effect count. Immediate
activations reject before resource settlement when the current tick lacks work;
delayed activations that cannot reserve are explicitly cancelled with payments
refunded and reservations released. Forward idle tick gaps start one fresh
budget for the observed tick; backward operations fail.

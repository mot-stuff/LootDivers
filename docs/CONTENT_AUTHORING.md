# Content Foundation Authoring

TASK-P0-005 provides non-gameplay content contracts and tiny synthetic fixtures.
It does not define production items, abilities, enemies, balance, maps, or zone
content.

## Stable IDs

Every persistent content, stat, tag, and asset identity uses:

`namespace:local_name`

Both segments are lowercase ASCII. The namespace is 2–32 characters and begins
with a letter; the local name is 2–64 characters and begins with a letter.
Namespaces may contain letters, digits, `_`, and `-`. Local names may also use
`.` for a bounded hierarchy. The exact schema pattern is:

`^[a-z][a-z0-9_-]{1,31}:[a-z][a-z0-9_.-]{1,63}$`

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

Ajv validates JSON shape. Project semantic validation then reports deterministic,
source-relative diagnostics for duplicate IDs, unknown stats/tags/assets,
missing definition references, version incompatibility, invalid stat ranges,
and values outside each registered range. Numeric schema bounds are
`[-1,000,000,000, 1,000,000,000]`; narrower stat-specific bounds are mandatory
for values used by definitions.

Run:

```powershell
& $npm run content:validate
& $npm run content:compile
& $npm run content:check-determinism
```

`content:compile` replaces `generated/content` with canonical JSON chunks and a
manifest containing schema/content/compiler versions, hashes, and stable chunk
keys. Object keys, source traversal, registries, definitions, and reference
arrays are ordered deterministically. Generated output contains no timestamps
and must not be edited by hand.

## Extending the foundation

Add a versioned schema and aligned strict TypeScript contract before adding a
new document kind. Add both positive and malformed-content tests. Keep semantic
rules in project validation when JSON Schema cannot express cross-file
identity, references, or registry-defined bounds. P0-006 owns zone/map schemas;
do not add them here.

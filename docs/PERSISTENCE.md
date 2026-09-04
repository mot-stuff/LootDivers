# Phase 0 Persistence Foundation

TASK-P0-010 implements local persistence for synthetic fixture state only. It
does not define production character or world state.

## Boundaries

- `src/persistence` contains framework-free repository, envelope, validation,
  migration, checksum-canonicalization, and status contracts. It imports no
  Phaser, Preact, DOM, or IndexedDB APIs.
- `src/adapters/browser/indexeddb-save-repository.ts` owns IndexedDB
  transactions, generation pointers, and browser storage error mapping.
- `src/adapters/browser/persistence-platform.ts` adapts Web Crypto SHA-256 and
  the system clock.
- Presentation consumes `PersistenceStatus` and invokes repository-backed
  actions. It does not read or mutate IndexedDB directly.

`SaveRepository` is the adapter boundary for save, load, export, and import. A
future server repository may implement that contract, but no backend behavior
or production schema is implied.

## Envelope and migration

The current JSON envelope is format version 2. It carries:

- stable save ID and monotonic local revision;
- creation/update timestamps;
- build and content-schema compatibility metadata;
- ordered migration provenance;
- validated synthetic fixture payload;
- SHA-256 checksum over canonical JSON excluding the checksum field.

Version 1 is retained as a tested migration fixture. Loading validates the
checksum against the complete raw envelope before normalizing known fields,
then applies the consecutive `1 -> 2` migration and signs the migrated result.
Unknown fields are never silently omitted from checksum verification and are
also rejected structurally if a sender recomputes the checksum. Unsupported
versions, malformed DTOs, duplicate fixture IDs, non-finite values, and
checksum mismatches are rejected. Ordered migration provenance survives local
import, export, and subsequent saves.

## Validated generation protocol

Save and import mutations are serialized under a database-specific Web Lock so
concurrent callers and tabs cannot derive the same revision or race generation
promotion. An in-realm queue provides the fallback where Web Locks are
unavailable.

Saving uses two transactions:

1. Write a new inactive generation.
2. Read it back, validate its complete structure, and verify its checksum.
3. Promote it to active in a separate transaction while retaining the previous
   validated generation as backup and atomically pruning every other
   generation.

An interruption before promotion leaves the previous active pointer unchanged.
Loading validates active first and then the backup. If active is missing,
malformed, unsupported, or has a bad checksum, a valid backup is returned with
an explicit recovery status. No invalid candidate is returned as state.

JSON import performs parsing, schema/fixture validation, migration, and checksum
verification before opening a write transaction. Therefore a malformed import
cannot replace the current save. Export validates the selected generation before
serializing canonical JSON.

## Error and UX contract

Browser failures are mapped to stable error codes, including `quota`, `blocked`,
`write-aborted`, and `storage-unavailable`. The technical fixture renders these
through an accessible status/alert hook with actionable text. Browser tests use
an explicit `?persistenceTest` diagnostic seam to inject quota and
interrupted-write failures without consuming real user quota. The blocked path
holds an actual older IndexedDB connection while the adapter requests its
schema upgrade, exercising the native `onblocked` event.

Local IndexedDB data remains best-effort, origin-scoped, evictable, and
user-tamperable. It is not authoritative and provides no account, cloud-sync,
conflict-resolution, backend, or anti-cheat guarantee.

## Verification

Run the pinned commands documented in `TOOLING.md`. Relevant focused checks are:

```powershell
& $npm test
& $npm run build
& $npm run test:smoke
```

Vitest covers round trip, fixture validation, checksum rejection, and ordered
migration. Playwright covers real IndexedDB save/reload, serialized concurrent
saves with corrupt-active fallback, two-generation pruning, interrupted
promotion cleanup, surfaced quota/blocked failures, migration-provenance
import/export, and non-destructive malformed import.

The current automated browser project is bundled Chromium. Branded Chrome,
Edge, Firefox, and WebKit matrix expansion belongs to TASK-P0-012 and was not
run here. Real Safari is **NOT RUN — hardware unavailable**; Playwright WebKit
will not constitute Safari certification. Reference-tier hardware performance
is not a persistence acceptance criterion and was not run; the available
development machine remains ineligible for strict P0-002 performance evidence.
Real quota exhaustion, private-browsing policy, origin eviction, and OS-level
storage pressure were not induced because doing so is unsafe or
environment-specific; deterministic quota failure and real IndexedDB blocked
upgrade coverage verify the task's required UX paths.

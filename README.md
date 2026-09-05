# RARPG

RARPG is an original, browser-first, desktop-first 2D isometric action RPG.
The project combines responsive combat and loot-driven builds with persistent
professions, gathering, crafting, exploration, dungeons, and bosses.

## Project status

Phase 0 is a minimal seven-task stack-validation gate. Existing foundation work
has been mapped to the compact gate without deleting completed code.

Phase 0 is complete. Independent P0-G07 QA passed on clean `main` at `3adfba3`,
which immediately authorized Phase 1 combat with no separate Director approval.
Phase 1 implementation has not started.

By owner-approved DEC-017, the exact production artifact served over loopback
with Chromium and Microsoft Edge boot proof temporarily satisfies P0-G06;
public HTTPS staging is deferred.

## Approved technical direction

- Phaser 4.2.1 with WebGL2
- Strict TypeScript with framework-independent simulation
- Preact with HTML/CSS for DOM-based UI
- Tiled for isometric zone authoring
- PixiJS as a conditional fallback only after a documented hard Phaser failure
- WebGPU deferred beyond the vertical slice

## Required reading

Before working on the project, read:

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/GAME_VISION.md`](docs/GAME_VISION.md)
3. [`docs/ROADMAP.md`](docs/ROADMAP.md)
4. Documentation relevant to the assigned system

Architecture work must also review:

- [`docs/PHASE_0_ARCHITECTURE.md`](docs/PHASE_0_ARCHITECTURE.md)
- [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Contributing

Task structure, branch policy, verification requirements, and asset rules are
defined in [`CONTRIBUTING.md`](CONTRIBUTING.md).

The runnable browser toolchain is documented in
[`docs/TOOLING.md`](docs/TOOLING.md). It provides only the Phase 0 diagnostic
foundation; gameplay remains out of scope.

The compact task mapping, exact gate commands, deferrals, and authorization rule
are documented in
[`docs/PHASE_0_ARCHITECTURE.md`](docs/PHASE_0_ARCHITECTURE.md).

# RARPG

RARPG is an original, browser-first, desktop-first 2D isometric action RPG.
The project combines responsive combat and loot-driven builds with persistent
professions, gathering, crafting, exploration, dungeons, and bosses.

## Project status

Phase 0 architecture is approved. Foundation work is in progress.

Phase 1 gameplay implementation has not started and remains blocked until the
Phase 0 acceptance gate passes and the Director explicitly authorizes it.

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

The runnable browser toolchain is established by TASK-P0-003. Until then, this
repository intentionally contains documentation and project-governance files
only.

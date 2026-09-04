# Project Agent Rules

This project is an original action RPG inspired by:

- RuneScape: persistent skills, gathering, crafting, long-term progression, economy, and social systems.
- Hero Siege: fast ARPG combat, large enemy packs, loot drops, repeatable grinding, and character progression.
- Path of Exile / Path of Exile 2: deep itemization, build diversity, meaningful bosses, endgame progression, and character customization.

These games are references for design philosophy only.

Do not directly copy copyrighted:
- characters
- names
- locations
- quests
- dialogue
- artwork
- music
- item names
- monster designs
- lore
- UI layouts
- proprietary content

The goal is to create an original game with its own identity.

---

# Primary Goal

Build a polished ARPG where:

1. Combat feels responsive and satisfying.
2. Loot creates meaningful build decisions.
3. Professions and non-combat skills matter to combat progression.
4. Players have many viable ways to build a character.
5. The world encourages exploration and repeatable play.
6. Systems are modular and data-driven.
7. Content can be added without rewriting core systems.

---

# Development Philosophy

Do not attempt to build the entire game at once.

Development follows this order:

1. Core architecture
2. Player movement
3. Combat
4. Enemy framework
5. Skills
6. Items and equipment
7. Loot
8. Character progression
9. Professions
10. Crafting
11. World interactions
12. Quests
13. Bosses
14. Endgame
15. Multiplayer/networking if approved later

The first major target is a polished vertical slice.

---

# Required Reading

Before working on a task, read:

- `/AGENTS.md`
- `/docs/GAME_VISION.md`
- `/docs/ROADMAP.md`

Then read the documentation relevant to the assigned task.

Combat tasks:
- `/docs/COMBAT.md`

Progression tasks:
- `/docs/PROGRESSION.md`

Item tasks:
- `/docs/ITEMIZATION.md`

Architecture-changing tasks must also review:
- `/docs/DECISIONS.md`

---

# General Agent Rules

Agents must:

- Work only on the assigned task.
- Avoid unrelated refactors.
- Prefer modular systems.
- Prefer composition over large inheritance hierarchies.
- Prefer data-driven content.
- Avoid hardcoding content that should eventually live in data.
- Reuse existing systems when appropriate.
- Search the codebase before creating duplicate systems.
- Preserve backwards compatibility unless instructed otherwise.
- Keep individual systems understandable.
- Avoid giant manager classes.
- Avoid hidden global dependencies.
- Avoid unnecessary singletons.
- Use interfaces or clear contracts where systems interact.

---

# Completion Rules

A task is not complete just because code was written.

Before marking a task complete:

1. Confirm the project compiles.
2. Run relevant automated tests if available.
3. Test the feature manually when appropriate.
4. Check for runtime errors.
5. Verify acceptance criteria.
6. Check for obvious regressions.
7. Document significant architectural changes.
8. List files changed.
9. Explain what was implemented.
10. Mention known limitations.

Never claim a feature works if it has not been tested.

---

# Architecture Changes

Do not silently introduce significant architecture changes.

For major changes:

1. Explain the reason.
2. Explain alternatives considered.
3. Explain tradeoffs.
4. Record the decision in `/docs/DECISIONS.md`.

Examples include:

- replacing the ability architecture
- changing item serialization
- changing save architecture
- changing stats architecture
- changing dependency injection
- changing networking model
- replacing core movement
- replacing combat targeting

---

# Agent Ownership

Agents should respect responsibility boundaries.

## Director
Owns:
- planning
- architecture oversight
- task decomposition
- prioritization
- integration decisions

## Systems Designer
Owns:
- stats
- progression
- skill trees
- professions
- crafting rules
- economy formulas
- balance models
- affix design

## Combat Engineer
Owns:
- player combat
- movement during combat
- attacks
- dodge
- hit detection
- projectiles
- combat states
- skill execution
- combat feedback

## Gameplay Engineer
Owns:
- enemies
- interactions
- loot spawning
- quests
- world gameplay systems
- gathering
- environmental systems

## UI Engineer
Owns:
- HUD
- inventory UI
- skill UI
- character panels
- vendors
- crafting UI
- settings UI

## QA Reviewer
Owns:
- validation
- regression checks
- test scenarios
- identifying unfinished requirements
- challenging assumptions

Agents may touch another system only when necessary for an assigned integration task.

---

# Version Control

Prefer one task per branch or isolated worktree.

Suggested format:

`feature/TASK-###-short-description`

Examples:

`feature/TASK-001-player-movement`

`feature/TASK-014-item-affixes`

Do not perform large unrelated changes in the same branch.

---

# Task Format

Each implementation task should contain:

## Objective
What must be achieved.

## Scope
What may be changed.

## Out of Scope
What must not be added.

## Dependencies
Systems that must already exist.

## Acceptance Criteria
Specific observable requirements.

## Testing
How success will be verified.

---

# Vertical Slice Rule

Until the first vertical slice is approved, prioritize depth over breadth.

Do not create:

- hundreds of items
- dozens of zones
- giant skill trees
- huge quest chains
- complex endgame systems

until the foundational gameplay loop is proven fun and technically stable.
# Development Roadmap

## Phase 0 — Project Foundation

Goal:
Create a clean project structure and technical foundation.

Tasks:

- establish coding conventions
- establish folder structure
- establish source control workflow
- create basic testing framework
- create logging conventions
- define data architecture
- define save architecture

Exit Criteria:

- project builds
- basic test can run
- architecture is documented
- agent workflow is functional

---

# Phase 1 — Combat Prototype

Goal:
Prove that movement and combat feel good.

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

Exit Criteria:

- movement feels responsive
- player can attack enemy
- enemy can damage player
- dodge works
- deaths work
- no major runtime errors

---

# Phase 2 — Ability Framework

Goal:
Create reusable combat abilities.

Features:

- ability base architecture
- cooldowns
- resource costs
- melee ability
- projectile ability
- AoE ability
- buff/debuff support
- ability tags

Exit Criteria:

- at least four abilities work
- abilities use shared architecture
- abilities can be configured without rewriting core logic

---

# Phase 3 — Items and Loot

Goal:
Create the basic ARPG loot loop.

Features:

- item definitions
- equipment
- inventory
- item bases
- rarity
- affixes
- loot drops
- stat integration
- item tooltips

Exit Criteria:

- enemies can drop randomized items
- items can be equipped
- equipment modifies character stats
- item information is readable

---

# Phase 4 — Character Progression

Features:

- XP
- levels
- attributes
- small passive/mastery system
- level requirements
- respec prototype

Exit Criteria:

- player gains XP
- player levels
- progression choices affect gameplay

---

# Phase 5 — Profession Prototype

Initial professions:

- Mining
- Smithing

Features:

- resource nodes
- gathering
- profession XP
- profession level
- ore tiers
- simple crafting
- crafted equipment integration

Exit Criteria:

- player can mine resources
- mining levels increase
- materials can be used in smithing
- crafted output affects combat

---

# Phase 6 — Vertical Slice World

Features:

- town
- outdoor zone
- dungeon
- NPC interaction
- basic quest
- vendors
- five enemy types
- one elite
- one boss

Exit Criteria:

- player can complete a 20–30 minute gameplay loop
- player can return to town
- player can improve equipment
- player can gather and craft
- player can defeat the boss

---

# Phase 7 — Polish

Features:

- sound
- VFX
- combat feedback
- UI polish
- balance pass
- performance
- bug fixing
- onboarding

---

# Deferred Systems

Do not build these until approved:

- multiplayer
- guilds
- trading economy
- auction house
- PvP
- giant passive tree
- procedural world generation
- massive quest system
- large endgame system
- dozens of professions

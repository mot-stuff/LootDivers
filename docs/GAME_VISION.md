# RARPG — Game Vision

## Project Overview

RARPG is an original browser-based 2D isometric action RPG.

The game combines inspiration from several genres and games:

- RuneScape-style persistent skills, professions, gathering, crafting, economy, exploration, and long-term progression.
- Hero Siege-style fast-paced combat, large groups of enemies, loot hunting, and repeatable gameplay.
- Path of Exile / Path of Exile 2-style build depth, itemization, character specialization, bosses, and endgame progression.

These games are design references only.

RARPG must establish its own:

- world
- lore
- characters
- visual identity
- items
- monsters
- abilities
- progression systems
- terminology
- UI
- content

Do not directly reproduce copyrighted characters, locations, artwork, dialogue, quests, items, monsters, storylines, or other proprietary content from existing games.

---

# Hard Product Requirements

The game is definitively:

- Browser-based
- 2D
- Isometric
- Real-time
- Action RPG
- Persistent progression focused
- Desktop-first

These are project requirements and should not be changed without explicit approval.

The technical stack is NOT predetermined.

The Director is responsible for determining the best architecture, engine, framework, libraries, backend technologies, and supporting tools for these requirements.

---

# Primary Platform

RARPG is a browser-first game.

The primary target is modern desktop web browsers.

The player should be able to visit the game website, authenticate if necessary, and play without installing a native game client.

Primary targets:

- Google Chrome
- Microsoft Edge
- Firefox

Safari support should be maintained where technically practical.

Mobile browsers are not a requirement for the first vertical slice.

A future mobile or native client may be considered, but architecture should not be unnecessarily complicated today solely to support hypothetical platforms.

---

# Browser-First Philosophy

Browser deployment is not a secondary export target.

The browser is the primary runtime environment.

Technology decisions should therefore favor:

- browser performance
- fast loading
- small initial downloads
- efficient asset delivery
- browser debugging
- automated browser testing
- simple deployments
- CDN compatibility
- backend integration
- account persistence
- agent-assisted development
- maintainability

Do not automatically choose a traditional desktop game engine merely because it provides a web export.

Browser-native frameworks and technologies must receive serious consideration.

---

# Presentation

RARPG uses a 2D isometric or pseudo-isometric presentation.

The game should support:

- isometric environments
- 2D characters
- 2D enemies
- layered terrain
- props
- environmental objects
- visual elevation
- correct depth sorting
- foreground occlusion
- animated characters
- animated enemies
- projectiles
- particles
- ground effects
- enemy telegraphs
- dynamic loot
- combat text
- environmental effects

The world should appear to have depth while remaining fundamentally 2D.

True 3D rendering should only be introduced where there is a strong technical or visual justification.

---

# Core Fantasy

The player begins as a relatively inexperienced adventurer.

Over time, the player develops into a highly specialized character through:

- combat experience
- equipment
- abilities
- passive specialization
- professions
- gathering
- crafting
- exploration
- boss progression
- knowledge of game systems

Players should feel that their character represents their decisions rather than simply their character level.

---

# Core Gameplay Loop

The primary gameplay loop is:

Explore

↓

Fight enemies

↓

Collect loot and resources

↓

Gain experience

↓

Improve abilities

↓

Equip or modify items

↓

Train professions

↓

Gather increasingly valuable resources

↓

Craft or modify equipment

↓

Explore more dangerous content

↓

Fight elites and bosses

↓

Unlock harder content

↓

Repeat with increasing build depth

Combat, loot, professions, crafting, and exploration should reinforce one another.

---

# Design Pillar 1 — Responsive ARPG Combat

Combat quality is the highest initial gameplay priority.

Before large amounts of content are produced, movement and combat must feel satisfying.

Combat should emphasize:

- responsive movement
- precise input
- positioning
- dodging
- aiming
- attack timing
- enemy telegraphs
- meaningful abilities
- satisfying impacts
- readable effects
- dangerous enemy mechanics

The player should actively participate in combat rather than simply watching automated calculations occur.

---

# Controls

The initial control target is mouse and keyboard.

Preferred baseline:

- WASD movement
- mouse aiming
- left-click primary action
- right-click secondary action
- keyboard ability hotkeys
- dedicated dodge input
- interaction input

Exact controls should be determined through prototyping.

Controller support may be added later.

---

# Design Pillar 2 — Deep Character Builds

RARPG should allow significant build experimentation.

Build depth may eventually come from:

- weapon choice
- abilities
- ability modifications
- passive specialization
- attributes
- equipment
- affixes
- unique items
- damage types
- status effects
- profession-created items
- crafting
- resource mechanics

Complexity should be introduced progressively.

The game should be understandable to new players while still allowing experienced players to discover powerful interactions.

---

# Design Pillar 3 — Meaningful Loot

Loot is one of the central progression systems.

Items should create meaningful decisions.

Players should ask:

"Does this item improve or change my build?"

rather than simply:

"Does this item have a larger number?"

Items may eventually differ through:

- base type
- implicit properties
- rarity
- prefixes
- suffixes
- item level
- requirements
- crafted modifiers
- sockets or equivalent systems
- special effects
- unique mechanics

Items should be data-driven.

Large quantities of hardcoded item implementations should be avoided.

---

# Design Pillar 4 — Persistent Professions

RARPG should include persistent non-combat skills inspired by the satisfaction of long-term profession progression.

Potential professions include:

- Mining
- Smithing
- Woodcutting
- Fishing
- Cooking
- Alchemy
- Enchanting
- Hunting

Not all professions should be implemented initially.

The first vertical slice should likely test only one or two professions.

Mining and Smithing are preferred initial candidates.

---

# Professions Must Matter

Professions should not exist as isolated side activities.

They should interact with combat and the economy.

Example:

Mine ore

↓

Gain Mining experience

↓

Unlock higher-tier resources

↓

Use ore through Smithing

↓

Gain Smithing experience

↓

Craft or modify equipment

↓

Use that equipment to access more dangerous areas

↓

Find rarer resources

This creates a circular relationship between combat and professions.

---

# Design Pillar 5 — Crafting

Crafting should complement random loot rather than make random loot irrelevant.

Potential crafting interactions include:

- creating equipment bases
- adding modifiers
- rerolling modifiers
- improving item quality
- replacing modifiers
- creating consumables
- processing gathered materials
- producing specialized components

Crafting should eventually allow players to pursue desired equipment with greater agency while preserving uncertainty and valuable drops.

---

# Design Pillar 6 — Exploration

The world should reward exploration.

Possible discoveries include:

- resource nodes
- rare monsters
- hidden areas
- dungeons
- bosses
- events
- treasure
- profession opportunities
- lore
- quests
- unusual merchants
- crafting materials

Players should have reasons to revisit older areas.

---

# World Structure

The initial architecture should support:

- towns
- wilderness zones
- dungeons
- boss arenas
- resource areas
- special encounters

The exact world-loading model should be determined by the Director.

Possible approaches may include:

- separate zones
- streamed regions
- instanced maps
- procedural areas
- semi-procedural areas
- combinations of these approaches

Do not attempt to build an MMO-scale seamless world during the initial development phases.

---

# Enemy Design

RARPG should eventually support substantial enemy density.

Enemy encounters may include:

- normal enemies
- stronger variants
- elite enemies
- rare enemies
- minibosses
- bosses

Enemies should be capable of using:

- melee attacks
- ranged attacks
- projectiles
- AoE attacks
- ground effects
- buffs
- debuffs
- movement abilities
- status effects
- telegraphed attacks

Enemy architecture should be reusable and data-driven.

---

# Performance Requirements

Performance is a core architectural requirement.

The game should be designed to handle scenes containing combinations of:

- large enemy packs
- many projectiles
- status effects
- ground effects
- particles
- damage numbers
- loot drops
- environmental props
- enemy AI
- player abilities

Potential optimization strategies include:

- object pooling
- sprite batching
- efficient spatial queries
- culling
- reduced allocations
- data-oriented processing where appropriate
- optimized AI update frequencies
- asset atlases
- efficient animation systems

Do not prematurely optimize everything.

However, architecture should avoid obvious designs that will become catastrophic at ARPG-scale entity counts.

Performance must eventually be measured inside real target browsers.

Editor-only performance is not sufficient.

---

# Rendering Requirements

The Director should determine the rendering architecture.

Technologies may include:

- Canvas where appropriate
- WebGL
- WebGPU
- combinations or abstraction layers

WebGPU may be considered where it offers meaningful advantages.

However, browser compatibility and fallback requirements must be considered.

The project should not require experimental browser features without an explicit decision.

---

# Asset Loading

Browser loading performance is important.

The game should eventually support:

- compressed assets
- sprite atlases where appropriate
- lazy loading
- loading screens
- asset versioning
- cache management
- CDN delivery
- content bundles or equivalent grouping
- loading only necessary zone assets where practical

Players should not need to download the entire future game before reaching the first playable screen.

---

# Multiplayer

**Owner amendment (2026-09-05): Loot Divers is an MMO ARPG. There is no
single-player product.** The current client-local simulation is a
development scaffold that lets gameplay be proven quickly; it is not the
shipping architecture. Server-authoritative simulation is the target for
all shared play, and the migration to it must be planned as its own phase
before any shared-world, trading, or leaderboard feature ships. Every new
system should be built with the expectation that its authoritative copy
eventually runs on the server (the deterministic, framework-free core
exists precisely so the same simulation can run headless server-side).

Multiplayer is NOT required for the first vertical slice.

However, eventual multiplayer is a serious possibility.

Potential future features may include:

- parties
- cooperative combat
- trading
- shared towns
- social features
- guilds
- shared economy
- leaderboards

The initial architecture should avoid unnecessary decisions that make future multiplayer prohibitively difficult.

Networking should NOT be implemented prematurely.

---

# Client Trust

The browser client must eventually be treated as untrusted.

If RARPG contains valuable persistent progression, multiplayer, trading, leaderboards, or a shared economy, important game state must not rely solely on values provided by the browser client.

Potential authoritative state includes:

- account progression
- character progression
- inventory
- valuable items
- currency
- trades
- crafting outcomes
- leaderboard results
- shared economy state

The exact server-authoritative model should be designed when backend architecture becomes relevant.

---

# Persistence

During early prototypes, local persistence may be used for convenience.

Potential browser technologies include:

- IndexedDB
- local development storage

LocalStorage should not become the long-term authoritative character database.

Production architecture should eventually support server-side persistence for:

- accounts
- characters
- inventory
- equipment
- progression
- professions
- quests
- world state where appropriate
- settings

Save schemas should be versioned.

---

# Backend

The backend technology has not been selected.

The Director should eventually evaluate requirements for:

- authentication
- accounts
- character persistence
- inventory persistence
- database
- APIs
- sessions
- multiplayer
- matchmaking if required
- trading
- economy
- leaderboards
- analytics
- moderation
- security

Backend complexity should be introduced only when required by the current milestone.

---

# Security

Because the client executes inside the player's browser, client code and client state must never be assumed secret or trustworthy.

Do not rely on obscurity for game security.

Important persistent or competitive actions should eventually be validated by trusted server systems.

---

# Deployment

RARPG should eventually support automated browser deployment.

Desired production workflow:

Code Change

↓

Automated Tests

↓

Production Build

↓

Automated Browser Smoke Tests

↓

Staging Deployment

↓

Validation

↓

Production Deployment

The exact infrastructure is undecided.

---

# Hosting

The eventual architecture should be compatible with modern web hosting practices.

Potential components may include:

- static hosting
- CDN
- API servers
- game servers if required
- databases
- object storage
- authentication services

The Director should recommend infrastructure only when requirements justify it.

Avoid unnecessary cloud complexity during the prototype stage.

---

# Automated Testing

Agent-assisted development makes automated verification especially important.

The architecture should make it practical to test:

- game logic
- combat calculations
- item generation
- progression
- crafting
- inventory
- save serialization
- UI behavior where practical
- browser startup
- basic gameplay flows

Headless browser testing should be considered.

The game should expose enough deterministic logic that agents can verify behavior without relying entirely on visual inspection.

---

# Agent-Assisted Development

RARPG is being developed heavily through AI coding agents operating through Cursor.

Architecture should therefore favor:

- clear modules
- predictable project structure
- strong typing where appropriate
- automated tests
- command-line tooling
- deterministic builds
- readable code
- documented interfaces
- data-driven content
- low coupling
- reproducible development environments

Agents should be capable of:

- modifying code
- running builds
- running tests
- launching development servers
- inspecting logs
- executing automated browser tests
- verifying acceptance criteria

Technology that significantly obstructs automated agent workflows should receive additional scrutiny.

---

# Technical Stack

No engine, framework, renderer, backend, database, or programming language is currently mandated.

The Director must evaluate realistic alternatives.

Possible technologies to investigate may include:

- Phaser
- PixiJS
- Three.js
- Babylon.js
- Godot web export
- Unity WebGL
- TypeScript browser-native architectures
- WebGL libraries
- WebGPU libraries
- other appropriate technologies

This list is NOT a recommendation.

The Director should investigate and recommend the stack based on project requirements.

---

# Initial Vertical Slice

The first major playable milestone should prove the core gameplay loop.

Approximate target:

- one playable character
- responsive movement
- mouse aiming
- dodge
- one weapon family
- primary attack
- secondary attack
- approximately four active abilities
- health/resource system
- five normal enemy types
- one elite
- one boss
- one small town
- one wilderness area
- one dungeon
- inventory
- equipment
- randomized loot
- basic affixes
- character XP
- character levels
- one or two professions
- basic gathering
- basic crafting
- save/load
- browser deployment

Target approximately 20–30 minutes of repeatable gameplay.

The purpose is to prove:

Combat → Loot → Progression → Gathering → Crafting → Harder Combat

The vertical slice is NOT intended to represent the final amount of content.

---

# Development Priorities

Until the vertical slice succeeds, development priority is:

1. Technical foundation
2. Movement
3. Combat feel
4. Enemy framework
5. Ability framework
6. Items
7. Loot
8. Character progression
9. Professions
10. Crafting
11. World gameplay
12. Boss encounter
13. UI polish
14. Performance
15. Browser deployment quality

Do not build massive amounts of content before these foundations work.

---

# Deferred Features

Do not implement these without explicit approval:

- MMO-scale networking
- massive seamless world
- guilds
- auction house
- PvP
- large shared economy
- dozens of professions
- enormous passive tree
- hundreds of abilities
- hundreds of monsters
- giant endgame
- mobile support
- native desktop client

These may eventually become appropriate.

They are not current priorities.

---

# Guiding Principle

RARPG should first become a genuinely fun browser ARPG.

Build depth after the core loop works.

Build scale after the architecture works.

Build content after the systems work.

Build multiplayer after the single-player gameplay works.

Every major feature should strengthen the central relationship between:

Combat

Loot

Character Builds

Professions

Crafting

Exploration

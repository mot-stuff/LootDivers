# Itemization Design

## Purpose

Items should be one of the primary sources of build customization.

Loot should create interesting decisions rather than only larger numbers.

---

# Phase 3 Playable Scope

Phase 3 proves a focused loot loop rather than the final item model:

- a 12-slot inventory;
- Main Hand, Chest, and Amulet equipment slots;
- non-stackable equipment and Ability Stone stacks of up to nine;
- Common equipment with no affixes, Magic equipment with one affix, and Rare
  equipment with two distinct legal affixes;
- one deterministic equipment drop per enemy kill and one guaranteed Ability
  Stone on the first kill of a run;
- automatic pickup within a short radius, with drops retained when inventory is
  full;
- equipment modifiers for maximum health and outgoing ability damage; and
- readable inventory, equipment, affix, stat, and Ability Stone UI.

The three prototype bases are Worn Cleaver, Trailguard Vest, and Wayfinder
Amulet. The six prototype affixes are Tempered, Steadfast Grip, Reinforced,
Battlewoven, Hearty, and Focused. Slot and tag restrictions prevent illegal
rolls. This is intentionally enough content to test choices without creating a
production-scale catalog.

Base and affix catalogs are immutable typed TypeScript data consumed by generic
generation and validation rules. Moving them into the canonical compiled JSON
pipeline is deferred until content volume justifies extending that schema; item
behavior must remain independent of Phaser and Preact during that migration.

Inventory, equipment, generated items, and ability ownership are not yet added
to the IndexedDB character save DTO. Reloading the page loses Phase 3 state.
This is an explicit prototype limitation and does not change DEC-014.

---

# Item Structure

An item should potentially contain:

- Item ID
- Display Name
- Base Type
- Equipment Slot
- Required Level
- Rarity
- Implicit Modifier
- Prefixes
- Suffixes
- Tags
- Durability if used
- Crafting Metadata
- Item Level
- Sell Value

Not every field must exist initially.

---

# Ability Stones

Abilities will be obtained through lootable Ability Stones. Using a stone lets
the player choose an ability to create; the resulting ability can later be
assigned to the left-click, Q, E, or F combat slot through inventory or menu UI.

Phase 3 keeps the four Phase 2 assignments as borrowed prototype defaults so
existing controls continue to work. Basic Cleave is initially owned. A consumed
stone creates one of the other currently implemented abilities, making it
assignable to any combat slot. Reassignment cannot remove the final Basic
Cleave slot, which guarantees a free usable action.

Stone rarity, later selection pools, progression, trading, duplicate ability
rules, and support-modification mechanics remain deferred. The system preserves
player choice without copying another game's proprietary implementation or UI.

---

# Equipment Slots

Potential slots:

- Head
- Chest
- Gloves
- Boots
- Belt
- Amulet
- Ring 1
- Ring 2
- Main Hand
- Off Hand

Start with fewer slots if required for the vertical slice.

---

# Rarity

Initial rarity structure:

- Common
- Magic
- Rare
- Unique

Phase 3 generates Common, Magic, and Rare equipment only. Unique items and
possible later tiers should not be added without purpose.

---

# Base Items

The base item determines fundamental characteristics.

Example:

Iron Longsword

might define:

- base physical damage
- attack speed
- weapon range
- weapon tags
- level requirement

Affixes then modify the base.

---

# Affixes

Affixes should be data-driven.

Examples:

- +maximum health
- +physical damage
- +fire damage
- +attack speed
- +critical chance
- +armor
- +fire resistance

Affix pools should support restrictions using tags.

Example:

A bow may roll Projectile affixes.

A sword should not automatically roll bow-specific affixes.

---

# Item Level

Item level may determine:

- available affix tiers
- crafting possibilities
- base drop rules

Item level is separate from required character level.

---

# Unique Items

Unique items should meaningfully alter gameplay.

Avoid designing unique items that are simply stronger rare items.

Good unique concepts may:

- change an ability
- convert damage types
- create unusual resource mechanics
- change targeting
- introduce tradeoffs

Unique items should have strong identities.

---

# Loot Philosophy

Players should see:

- frequent common loot early
- useful upgrades regularly
- occasional exciting drops
- rare chase items

Do not flood the player with meaningless items.

Loot quantity should remain manageable.

---

# Crafting

Crafting should eventually allow controlled modification of equipment.

Possible actions:

- add affix
- reroll affix
- improve affix tier
- replace affix
- alter base quality
- add crafted modifier

Initial crafting should remain simple.

---

# Profession Interaction

Smithing may:

- create weapon bases
- improve physical equipment
- modify sockets or quality
- repair equipment if durability exists

Mining may supply:

- ore
- gems
- rare crafting materials

Profession systems should complement random loot rather than completely replace it.

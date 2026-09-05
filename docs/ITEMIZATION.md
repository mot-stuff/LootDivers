# Itemization Design

## Purpose

Items should be one of the primary sources of build customization.

Loot should create interesting decisions rather than only larger numbers.

---

# Phase 3 Playable Scope

Phase 3 proves a focused loot loop rather than the final item model:

- a 48-slot scrollable inventory;
- nine equipment slots: Helmet, Chest, Amulet, Belt, Boots, Main Hand,
  Offhand, Ring 1, and Ring 2, plus four flask slots below the boots;
- non-stackable equipment and Ability Stone stacks of up to nine;
- Common equipment with one affix, Magic equipment with one or two affixes,
  and Rare equipment with three or four distinct legal affixes;
- one deterministic equipment drop per enemy kill and one guaranteed Ability
  Stone on the first kill of a run;
- manual pickup with the F key of the nearest drop within a short radius, with
  drops retained in the world when inventory is full;
- equipment modifiers for maximum health and outgoing ability damage; and
- readable inventory, equipment, affix, and Ability Stone UI.

Combat loadout assignment is not shown in the inventory menu. Ability Stones
can still create owned abilities; slotting them onto LMB/Q/E/R moves to the
Phase 4 character screen.

Base items declare a slot kind rather than a concrete character slot. Every
kind maps to one slot except rings: a ring-kind item may occupy Ring 1 or
Ring 2. Equipping without an explicit target derives the slot from the base;
rings prefer the first empty ring slot and otherwise swap into Ring 1. An
explicit target slot is rejected if it does not accept the item's kind.

The eight prototype bases give every slot at least one obtainable item:
Worn Cleaver (main hand), Trailguard Vest (chest), Wayfinder Amulet (amulet),
Lookout Casque (helmet), Cinchweave Belt (belt), Drifter Treads (boots),
Splintered Buckler (offhand), and Plain Loopband (ring).

Heartwell Flask (life) and Mindwell Flask (mana) also drop. They use the same
rarity and tier rules as gear but roll flask-only affixes and occupy the four
flask slots. Their modifiers describe recovery, duration, charges, instant
recovery, recovery rate, and charges gained on kill. Drinking flasks with
keys 1–4 remains deferred.

Every affix rolls a tier from 1 through 5. Tier 1 is the best: each affix
declares five non-overlapping value ranges where tier 1 holds the highest
values. Tier N rolls with relative weight N (tier 1 at 1/15, tier 5 at 5/15),
so strong tiers are rare. Generation rolls the affix count, then per affix a
candidate, a tier, and a value inside that tier's range; the whole item is
deterministic per seed, and validation rejects tiers outside 1–5 or values
outside the rolled tier's range.

The eight prototype gear affixes are Tempered and Steadfast Grip (main hand),
Reinforced and Battlewoven (armor slots: helmet, chest, belt, boots, offhand),
Hearty and Focused (jewelry: amulet and rings), and the generic Vigorous and
Keen (any equipment, deliberately weaker ranges). Flask-only affixes are
Brimming, Sudden, Fleetpour, Deep Reserve, Thrifty, and Reaping. Slot-kind and
tag restrictions prevent illegal rolls. Every gear base has exactly four legal
affixes and every flask base has six, so the Rare maximum is always
satisfiable with distinct affixes. This is intentionally enough content to
test choices without creating a production-scale catalog.

Unique rarity exists in the item model (reserved for later phases) but is
never generated: generation rejects unique requests and enemy loot weights
cover Common, Magic, and Rare only.

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
assigned to the left-click, Q, E, or R combat slot through inventory or menu UI.

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

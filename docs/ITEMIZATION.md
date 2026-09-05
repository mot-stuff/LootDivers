# Itemization Design

## Purpose

Items should be one of the primary sources of build customization.

Loot should create interesting decisions rather than only larger numbers.

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

The exact stone rarity, selection rules, progression, trading behavior, and
support-modification model are deferred until the item and loot phases. The
system should preserve player choice without directly copying another game's
gem implementation.

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

Possible later tiers should not be added without purpose.

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

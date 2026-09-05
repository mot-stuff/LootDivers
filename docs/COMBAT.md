# Combat Design

## Objective

Combat should feel responsive, impactful, readable, and skill-based.

The player should have meaningful positioning and timing decisions.

---

# Player Controls

Current bindings:

- WASD movement
- mouse aiming
- left click primary action (assigned LMB ability)
- Q, E, and R ability slots
- Space dodge
- F picks up the nearest ground loot in range
- I opens the inventory; Esc closes the open menu
- right click secondary action reserved for later
- optional controller support later

Arena reset is automation-only (exposed to tests and tooling); it has no
keyboard binding.

Movement and aiming should be independent when technically practical.

---

# Combat Principles

## Responsiveness

Input should register quickly.

Avoid excessive animation lock unless intentional.

Actions should have clearly defined:

- startup
- active
- recovery

---

## Commitment

Stronger attacks should generally require greater commitment.

Weak attacks may allow faster recovery.

Heavy abilities may have:

- longer windup
- longer recovery
- resource cost
- cooldown
- movement restrictions

---

## Readability

Enemy attacks must communicate danger.

Use combinations of:

- animation
- effects
- sound
- telegraphs
- enemy movement

Avoid unavoidable damage where possible.

---

# Player Combat States

Potential states include:

- Idle
- Moving
- Attacking
- Casting
- Dodging
- Stunned
- KnockedBack
- Dead

Avoid making the state system unnecessarily rigid.

Systems should support interruption rules.

---

# Core Combat Components

Prefer reusable components for:

- Health
- DamageReceiver
- Hitbox
- Hurtbox
- Ability
- Projectile
- StatusEffect
- Resource
- CombatStats

Do not duplicate separate health systems for players and enemies unless necessary.

---

# Damage Pipeline

Damage should eventually support:

1. Base damage
2. Damage type
3. Offensive modifiers
4. Critical calculation
5. Defender mitigation
6. Resistance
7. Temporary modifiers
8. Final damage
9. On-hit triggers
10. Death check

The initial implementation may be simpler but should leave room for expansion.

---

# Initial Damage Types

Start small.

Preferred initial types:

- Physical
- Fire
- Cold
- Lightning

Additional types can be considered later.

Do not create dozens of damage types during the vertical slice.

---

# Dodge

Dodge should:

- move the character rapidly
- feel responsive
- use a cooldown without a stamina resource
- prevent spam
- potentially provide brief invulnerability depending on testing

Exact invulnerability duration should remain configurable.

---

# Enemy Power Tiers

Enemy populations should use clear power tiers:

- Common enemies are small, weak, and intended to appear in large groups.
- Magic enemies are stronger variants with one or more meaningful modifiers.
- Rare enemies combine stronger stats with multiple mechanics or modifiers.
- Bosses use bespoke mechanics, telegraphs, and substantially greater durability.

Higher tiers should gain mechanical identity rather than relying only on larger
health and damage values. The first combat prototype uses one common enemy only.

---

# Enemy Reactions

Enemies should react appropriately to hits through:

- impact animation
- hit flash
- knockback when relevant
- stagger when relevant
- sound
- damage numbers if enabled

Not every hit should stun enemies.

---

# Combat Resources

Phase 2 uses Mana as the only combat resource. The prototype starts at 100 Mana
and regenerates 6 Mana per second in the fixed-step simulation. Stamina is not a
combat resource; dodge remains cooldown-only.

Rage, Energy, and class-specific resources remain possible later, but are not
part of the vertical-slice ability framework.

---

# Ability Design

Every ability should define:

- targeting type
- cast time
- cooldown
- resource cost
- damage behavior
- range
- area
- movement restrictions
- interruption rules
- tags

Possible tags:

- Attack
- Spell
- Projectile
- Melee
- AoE
- Fire
- Cold
- Lightning
- Physical

Tags should allow other systems to modify abilities without hardcoding each ability.

---

# Phase 2 Playable Ability Set

All four abilities use the shared framework-independent staged runtime. Ability
definitions provide targeting, startup/active/recovery timing, Mana cost,
cooldown, tags, and an ordered combat effect.

- **Basic Cleave — Left click:** directional physical melee cone; 25 damage,
  110 range, 55-degree half-angle, no Mana cost.
- **Cinder Dart — Q:** directional fire projectile; 30 damage, 15 Mana,
  0.5-second cooldown.
- **Winter Pulse — E:** point-targeted cold area; 20 damage, 25 Mana,
  2.5-second cooldown, and a 30% enemy movement slow for 2 seconds.
- **Defiant Signal — R:** self-centered area; 20 Mana, 5-second cooldown,
  +20% player ability damage and -20% nearby enemy damage for 3 seconds.

Statuses use target-and-status identity, refresh duration without stacking,
expire before effects on their expiry tick, and clear on death or arena reset.
Phase 2 intentionally defers critical strikes, resistances, status chance,
stacking rules, damage over time, advanced interruption, and final VFX.

---

# Phase 3 Ability Loadouts

Abilities will be acquired through lootable Ability Stones. An Ability Stone
lets the player choose which ability to create, after which that ability can be
assigned to any of the four combat slots: left click, Q, E, or R.

The framework-independent character loadout owns creation and slot assignment.
Phaser routes LMB/Q/E/R intents by slot and resolves each assigned ability's
targeting mode; Preact only presents inventory and loadout commands.

The Phase 2 assignments remain as borrowed defaults to preserve existing
controls. Basic Cleave is initially owned, while Ability Stones make the other
implemented abilities assignable. A loadout edit is rejected if it would remove
the final Basic Cleave assignment, preserving a no-Mana basic action.

Equipped item damage percentages add together in integer basis points, then
multiply temporary outgoing-damage effects such as Defiant Signal. Final damage
is floored once. Maximum-health equipment preserves the player's missing-health
amount when equipped or removed, clamps to the new maximum, and reset restores
the current equipped maximum.

Four flask slots are reserved above the ability bar and use keys 1 through 4.
They are visual placeholders only until flask items and inventory integration
are designed.

---

# Initial Combat Prototype

The first prototype should include:

- movement
- mouse aim
- primary attack
- dodge
- health
- damage
- death
- one melee enemy

Phase 1 proved this baseline. Phase 2 retains it and adds the four-ability set
above without changing the approved weak, small common-enemy tuning.

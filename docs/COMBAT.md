# `docs/COMBAT.md`

```md
# Combat Design

## Objective

Combat should feel responsive, impactful, readable, and skill-based.

The player should have meaningful positioning and timing decisions.

---

# Player Controls

Preferred baseline:

- WASD movement
- mouse aiming
- left click primary action
- right click secondary action
- ability hotkeys
- dodge hotkey
- F interact (loot first if a drop is in pickup range, otherwise the nearest ore node or forge)
- optional controller support later

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
- have a cooldown or resource cost
- prevent spam
- potentially provide brief invulnerability depending on testing

Exact invulnerability duration should remain configurable.

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

Potential resources:

- Mana
- Rage
- Energy
- Class-specific resources later

Start with one simple resource unless the character design requires otherwise.

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

Only after these feel good should more abilities be added.
```

# Progression Design

## Purpose

Progression should provide frequent rewards while preserving long-term goals.

The player should feel stronger because of:

- better execution
- levels
- abilities
- passive specialization
- equipment
- professions
- crafting

---

# Phase 4 Playable Scope

Phase 4 proves a compact character-progression loop rather than a final
career system:

- enemy kills grant 20 experience;
- the XP curve is `40 + 20 × (level − 1)` with no hardcoded cap;
- leftover XP immediately applies to the next level;
- a new character starts at level 1 with 2 unspent attribute points and
  1 unspent mastery point so the character screen is useful immediately;
- each later level awards 2 attribute points and 1 mastery point;
- attributes are Strength, Dexterity, Vitality, and Intelligence;
- eight three-rank masteries specialize damage, defense, resources,
  mobility, or one of the four current abilities;
- Restore Training refunds every spent point for free;
- generated gear and flasks carry a required level (Common and Magic 1,
  Rare 2);
- C opens the character screen, with an on-screen button to the right of
  Inventory, and LMB/Q/E/R assignment lives there.

Attribute and mastery bonuses compose with equipment. They never move
authority into Phaser or Preact. Progression is not persisted across
reload (DEC-014 unchanged). Professions, gold-cost respecs, a large
passive tree, and automatic stat gains on level-up remain deferred.

---

# Character Levels

Character levels should:

- unlock progression opportunities
- provide moderate baseline power
- not completely overshadow gear and builds

Exact level cap is undecided.

Do not hardcode assumptions around a final level cap.

---

# Experience

XP may come from:

- enemy kills
- bosses
- quests
- exploration
- challenges

Avoid encouraging one clearly dominant XP strategy unless intentional.

---

# Attributes

Initial candidate attributes:

Phase 4 uses four attributes. Each allocated point grants:

## Strength
+2% outgoing ability damage.

## Dexterity
+1% movement speed. Dodge dash speed is unchanged.

## Vitality
+6 maximum health.

## Intelligence
+4 maximum mana.

These remain prototype values. Later phases may add requirements,
accuracy, or armor interactions without replacing the spend model.

---

# Passive Progression

The passive system should eventually support meaningful specialization.

Avoid building a massive passive tree immediately.

Start with a small prototype tree or mastery system.

Phase 4 uses eight original three-rank masteries: Iron Tempo, Thick Hide,
Deep Well, Windstride, Cleaving Form, Cinder Channel, Winter Channel, and
Lasting Banner. They improve shared stats or one acquired ability. A
larger tree is deferred.

---

# Professions

Professions should progress independently from combat level.

Potential professions:

- Mining
- Smithing
- Woodcutting
- Fishing
- Cooking
- Alchemy
- Enchanting
- Hunting

Initial vertical slice should implement only one or two.

Suggested first combination:

- Mining
- Smithing

This provides a clear gather → craft → combat loop.

---

# Profession Loop Example

Mine ore

↓

Gain Mining XP

↓

Unlock better ore

↓

Use ore through Smithing

↓

Gain Smithing XP

↓

Craft or modify equipment

↓

Use stronger equipment in combat

↓

Reach dangerous zones containing better ore

This connects professions directly to combat progression.

---

# Phase 5 Playable Scope

The arena currently proves a thin Mining → Smithing → equip loop with
geometric placeholders. Art import is deferred.

- Profession XP is independent of combat level. The curve is
  `20 + 10 × (level − 1)` with no hardcoded cap.
- Veinshard Outcrop (northwest) requires Mining 1 and yields Veinshard Ore.
- Deepvein Seam (southeast) requires Mining 3 and yields Deepvein Ore.
- Gathering is a short channel. Moving, dodging, using an ability, or taking
  damage cancels it. Nodes have charges and respawn after they deplete.
- F prefers loot pickup, then the nearest node or the Tempering Forge.
- Smithing recipes consume stacked ore (limit 20) and grant Smithing XP:
  Tempering Cleaver (3 Veinshard), Tempering Vest (4 Veinshard), and
  Deepvein Cleaver (3 Deepvein, Smithing 3).
- Crafted bases are original and stay out of the enemy drop pool. They use
  the same equipment instance model as loot, tagged `origin: "crafted"`.
- Profession XP and inventory are not persisted (DEC-014).

Woodcutting, extra professions, gold, flask drinking, and sprite art remain
out of scope.

---

# Progression Principles

Progression should reward:

- time
- knowledge
- skill
- exploration
- specialization

Avoid requiring excessive repetitive grinding just to access basic gameplay.

Long-term goals may require significant commitment.

---

# Respecs

Build experimentation should be possible.

Early progression should be forgiving.

Respecialization may become increasingly expensive at higher levels, but players should not permanently ruin a character because of beginner decisions.

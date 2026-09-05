# TASK-713 — Systems Numbers Memo: Flasks, Gold, Death Cost

Systems Designer deliverable, 2026-09-05. Consumed verbatim by TASK-711
(flask drinking) and TASK-712 (gold drops). Deviations later must edit
this memo, not scatter constants (Phase 8 kickoff §TASK-713 acceptance).

All numbers below are stated against the code as shipped on `main`:
player base 100 health / 100 mana, 60 simulation ticks per second
(`FIXED_TICKS_PER_SECOND`), kill XP 20/40/80 for normal/elite/boss
(`ENEMY_KILL_EXPERIENCE`, `ELITE_KILL_EXPERIENCE`,
`BOSS_KILL_EXPERIENCE`), level curve `40 + 20 × (level − 1)` (DEC-023),
and the DEC-022 flask bases/affixes in `src/core/item-catalog.ts`.

Balance targets are playtest hypotheses, not certainties. Constants are
named so engineers and future tuning passes can find them.

---

# 1. Flasks (TASK-711)

## 1.1 Recovery model — one amendment to the DEC-038 draft

The kickoff draft says "instant restore". The shipped DEC-022 catalog
contradicts a purely instant model: both flask bases carry a duration
stat (`stat:flask-duration-deciseconds`), and two of the six live
affixes — Sudden (`stat:flask-instant-recovery`, an instant *portion*
percentage) and Fleetpour (`stat:flask-recovery-rate`) — are meaningless
unless recovery happens over time. TASK-711's scope also requires that
"existing recovery/charge affixes become live".

**Specified model (amends "instant restore" to "fast restore-over-time
with an instant portion"; ratified when the Director accepts this
memo):** drinking applies the flask's total recovery linearly over its
effective duration; the Sudden portion lands on the drink tick. If the
Director overrules and wants pure instant, the model degrades cleanly:
set effective duration to 1 tick and Sudden/Fleetpour become dead stats
— but that is not the recommendation.

Rationale: uses every shipped affix, and a ~4–5 s restore window keeps
drinking a decision under fire instead of a free undo button.

## 1.2 Per-drink resolution (exact algorithm)

On `useFlask(slot)` with a flask item in that slot:

1. Reject (no charge spent, feedback shown) if any of: player dead;
   slot empty; shared drink cooldown active; `chargesCurrent <
   chargesUsedEffective`; target resource already full (health full for
   life flasks, mana full for mana flasks).
2. Spend `chargesUsedEffective` charges; start the shared cooldown.
3. Compute, from the item instance's summed stats (base + affixes):

```
totalRecovery          = flaskRecovery                    // stat:flask-recovery, flat sum
instantAmount          = floor(totalRecovery × suddenBasisPoints / 10_000)
overTimeAmount         = totalRecovery − instantAmount
baseDurationTicks      = flaskDurationDeciseconds × 6     // deciseconds → 60 Hz ticks
effectiveDurationTicks = max(1, round(baseDurationTicks / (1 + fleetpourBasisPoints / 10_000)))
```

4. Apply `instantAmount` immediately; apply `overTimeAmount` linearly
   over `effectiveDurationTicks` (equal per-tick amounts with a
   fractional accumulator so the applied total is exactly
   `overTimeAmount`; restore clamps at maximum — overflow is lost).
5. **No stacking:** drinking while a recovery of the same resource type
   (health or mana) is active replaces that active effect; its
   unapplied remainder is discarded. Health and mana recoveries may run
   concurrently.

Fleetpour compresses the same total into a shorter window (a throughput
affix), matching its "recovery rate" wording.

## 1.3 Charge model

```
FLASK_BASE_CHARGES_GAINED_ON_KILL = 5      // new constant, this memo
FLASK_MINIMUM_CHARGES_USED        = 1      // clamp floor after Thrifty
FLASK_DRINK_SHARED_COOLDOWN_TICKS = 18     // 0.3 s, shared across all four slots
```

Per-item effective values (from the item instance's summed stats):

```
maxCharges           = flaskCharges                        // base 30 + Deep Reserve
chargesUsedEffective = max(FLASK_MINIMUM_CHARGES_USED,
                           flaskChargesUsed − thriftyReduction)   // base 20 − Thrifty
chargesOnKill        = FLASK_BASE_CHARGES_GAINED_ON_KILL + reapingValue
```

Rules, one line each:

- Every player kill grants `chargesOnKill` to **each** of the four
  equipped flasks independently, clamped at that flask's `maxCharges` —
  fighting is the refill loop (kickoff §1.7).
- Base rate feel: 20-used / 5-per-kill means a drink costs four normal
  kills; T1 Reaping (+5) halves that; T1 Thrifty (−9 → 11 used) gets
  close to a drink every two kills. Sustain is affix-earned, not free.
- Charges refill to `maxCharges` on zone entry, on respawn, and on
  session start/reset; charges are transient and never persisted
  (DEC-034 combat-state rule, kickoff §1.7).
- The shared cooldown (0.3 s) exists to stop same-tick multi-slot
  burst-drinking; charges remain the real limiter.

## 1.4 Shipped item values (confirmed, not redefined)

These already live in `FLASK_BASE_CATALOG` and `AFFIX_CATALOG`; the memo
confirms them as the v1 numbers. Engineers read them from the catalog,
never hardcode them.

| Value | Heartwell (life) | Mindwell (mana) |
| --- | --- | --- |
| Base recovery | 70 health | 50 mana |
| Base duration | 50 ds = 5.0 s (300 ticks) | 40 ds = 4.0 s (240 ticks) |
| Base max charges | 30 | 30 |
| Base charges per drink | 20 | 20 |

Affix roles under this model (tier ranges unchanged in the catalog):
Brimming adds flat recovery (+8..32); Sudden makes 5–30% of recovery
instant; Fleetpour speeds recovery 5–50% (shorter window, same total);
Deep Reserve adds +4..14 max charges; Thrifty cuts charges per drink by
2..9; Reaping adds +1..5 charges on kill.

## 1.5 Worked examples (sanity of feel)

- **Plain Heartwell:** 70 health over 5.0 s = 14 health/s. One Ashtrail
  Gnasher deals ≈ 8.6 damage/s, the Embercleft boss 15/s — one flask
  roughly cancels one attacker, and does not trivialize the boss.
- **Rare Heartwell, T1 Brimming + T1 Sudden:** 70 + 32 = 102 recovery;
  30% instant → ≈ 30 health on the drink tick, 72 over 5 s. A real
  panic button on a ~100–150 health slice character, earned via a Rare.
- **Plain Mindwell:** 50 mana over 4 s against costs of 15/25/20
  (Cinder Dart / Winter Pulse / Defiant Signal) — one drink funds two
  to three casts.

---

# 2. Gold Drops and Counter (TASK-712)

## 2.1 Constants

```
STARTING_GOLD          = 0               // 705B default; new characters and existing saves
GOLD_DROP_CHANCE       = 1               // every player kill drops exactly one pile
GOLD_DROP_NORMAL_MIN   = 3
GOLD_DROP_NORMAL_MAX   = 7               // expectation 5
GOLD_DROP_ELITE_MIN    = 10
GOLD_DROP_ELITE_MAX    = 14              // expectation 12
GOLD_DROP_BOSS_MIN     = 30
GOLD_DROP_BOSS_MAX     = 50              // expectation 40
GOLD_MAX_TOTAL         = 1_000_000_000   // collection clamps here; parse rejects above
```

Roll: uniform inclusive integer in `[min, max]` keyed by `EnemyRank`
(`normal`/`elite`/`boss` — the code's names; the kickoff's "white" =
`normal`).

## 2.2 Rationale (one line each)

- Expectations track the DEC-023 kill-XP ladder (20/40/80) with a
  rising gold-per-XP ratio — 0.25 / 0.30 / 0.50 gold per XP — so harder
  content is strictly the better gold strategy.
- Boss expectation is 8× normal (above its 4× XP ratio) because a boss
  kill should read as a jackpot moment in a slice with one boss.
- Small absolute numbers on purpose: nothing spends gold yet, and it is
  far easier to inflate drops later than to deflate a live economy.
- **Rarity does not modulate gold** (the kickoff's advisory question):
  the item roll and the gold roll stay orthogonal so future loot-rarity
  tuning never silently moves the economy. Recommendation: keep it that
  way past v1.

## 2.3 Expected gold-per-hour (playtest hypothesis)

One full circuit at slice pacing — Hearthmere → Ashtrail (3 normal + 1
elite ≈ 27 expected) → Hollowdeep (elite + boss ≈ 52 expected) → return
— yields ≈ 79 gold in roughly 4 minutes, i.e. **≈ 1,000–1,400 gold per
hour** for a player who fights everything. That anchor prices future
sinks (a stock vendor piece should land near 100–150 gold ≈ 5–8 minutes
of play; a respec fee near 50). Hypothesis to verify in the TASK-714
playtest, not a certainty.

## 2.4 Determinism requirement (implementation-critical)

`DeterministicEnemyLootGenerator`'s Mulberry32 stream produces the item
sequence; existing tests pin items per seed. Gold rolls must **not**
consume from that stream or every seeded item expectation shifts.
Specify a second, independent Mulberry32 seeded derivably from the run
seed:

```
goldSeed = (seed ^ 0x9e3779b9) >>> 0    // distinct stream, same replay determinism
```

Same seed ⇒ same gold sequence and same item sequence, each unchanged
by the other. (TASK-712 acceptance "same seed reproduces the same
rolls" is satisfied; existing golden tests stay green.)

## 2.5 Presentation

- One coin pile per kill, rendered distinctly from F-pickup drops, with
  its integer amount as the label; auto-collects on walk-over
  (kickoff §1.6).
- Inventory panel shows one gold line: coin glyph + locale-formatted
  integer (e.g. `1,234`). No decimals ever.

---

# 3. Death Cost — post-v1 recommendation (owner decision)

v1 ships with zero death penalty (DEC-037 draft); this section changes
nothing now. When the owner wants death to cost something, the options
in reference-philosophy terms:

- **Gold respawn fee** — RuneScape-family "death taxes wealth":
  self-scaling, never bricks progress, and gives the economy its first
  sink, which this game will need once vendors take gold.
- **XP debt** — punishes exactly the player already failing at that
  content and fights DEC-023's fast early curve; feels bad at slice
  scale where levels are minutes apart.
- **Durability loss** — requires building a durability + repair system
  that does not exist (ITEMIZATION.md lists durability as optional);
  large surface area for a penalty players mostly experience as chores.

**Recommendation: gold respawn fee.**

```
DEATH_RESPAWN_FEE_BASIS_POINTS = 500    // 5% of carried gold, floor-rounded
DEATH_RESPAWN_FEE_MINIMUM      = 0      // broke players respawn free — never gate respawn
```

At the §2.3 earning rate a death costs a few minutes of gold at most,
scales automatically as wealth grows, and needs no new systems beyond
subtracting from the 705B field. **Marked owner-decision, post-v1** —
do not implement without an explicit directive; record as a DEC when
adopted.

---

# 4. Invariants for Implementing Engineers

Gold (TASK-712):

1. `gold` is always a non-negative safe integer;
   `0 ≤ gold ≤ GOLD_MAX_TOTAL`. Collection clamps at the cap;
   `parseCharacterSave` rejects negative/non-integer (705B) and values
   above the cap.
2. Gold rolls come from the dedicated gold RNG stream (§2.4), never
   from the item stream.
3. Every drop amount is an integer within its rank's `[min, max]`.
4. Walk-over collection is the only pickup path; no F-key interaction;
   uncollected piles are transient (not persisted; despawn with zone
   state like other drops).

Flasks (TASK-711):

5. `chargesCurrent` is an integer with
   `0 ≤ chargesCurrent ≤ maxCharges` at all times; kill gain clamps at
   `maxCharges`.
6. A drink happens only when `chargesCurrent ≥ chargesUsedEffective`;
   `chargesUsedEffective ≥ FLASK_MINIMUM_CHARGES_USED` after Thrifty.
7. Rejected drinks (dead, empty slot, full resource, insufficient
   charges, shared cooldown) spend nothing and change no state except
   emitting feedback.
8. Restore clamps at maximum health/mana; the applied-over-time total
   never exceeds `overTimeAmount`; dead players receive no pending
   recovery (death cancels active flask effects).
9. Charges and active recovery effects are transient: never serialized,
   refilled/cleared on zone entry, respawn, and reset (DEC-034).
10. All per-item values (recovery, duration, charges, charges-used and
    the six affix stats) are read from the item instance's catalog
    stats — no flask item values hardcoded in the arena.

Both: keys 1–4 are inert while dead, in menus, and during text entry
(TASK-711 acceptance 3).

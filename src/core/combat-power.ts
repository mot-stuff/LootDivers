import {
  COMBAT_ABILITY_DEFINITIONS,
  damageAfterModifier,
  type CombatAbilityDefinition,
  type CombatAbilityId,
} from "./combat-abilities";
import { FIXED_TICKS_PER_SECOND } from "./fixed-step";
import { CharacterProgression } from "./progression";
import { CharacterItemLoadout, LOADOUT_SLOTS } from "./item-loadout";
import type { CharacterSave } from "./character-save";

function catalogHitDamage(definition: CombatAbilityDefinition): number {
  let total = 0;
  for (const effect of definition.effects) {
    const parameters = effect.parameters[0]?.value;
    if (
      parameters?.kind === "cone-damage" ||
      parameters?.kind === "projectile" ||
      parameters?.kind === "area-damage"
    ) {
      total += parameters.damage;
    }
  }
  return total;
}

function cycleTicks(definition: CombatAbilityDefinition): number {
  const cast =
    definition.timing.startupTicks +
    definition.timing.activeTicks +
    definition.timing.recoveryTicks;
  return Math.max(1, cast, definition.cooldown.durationTicks);
}

function abilityDps(
  definition: CombatAbilityDefinition,
  outgoingBasisPoints: number,
  abilityDamageBasisPoints: number,
): number {
  const hit = catalogHitDamage(definition);
  if (hit <= 0) return 0;
  const abilityBonus = 1 + abilityDamageBasisPoints / 10_000;
  const multiplier = (outgoingBasisPoints / 10_000) * abilityBonus;
  const modified = damageAfterModifier(hit, multiplier);
  return modified * (FIXED_TICKS_PER_SECOND / cycleTicks(definition));
}

/**
 * Sheet DPS for a save: the sum of theoretical single-target DPS of every
 * damaging ability the character owns, using the same outgoing-damage and
 * per-ability mastery multipliers the arena applies. Cycle time is the
 * longer of cast (startup+active+recovery) and cooldown, so Cleave's
 * 0-cooldown spam and a 2.5 s Winter Pulse both contribute fairly.
 *
 * Buff-only abilities (Defiant Signal) add 0. Mana sustain is ignored —
 * this is a class-agnostic sheet number, not a simulated rotation. The
 * kit is owned abilities plus whatever is assigned on the loadout bar,
 * so a future class's default bar is what gets scored.
 */
export function displayedTotalDps(save: CharacterSave | null): number {
  const items = new CharacterItemLoadout();
  const progression = new CharacterProgression();
  if (save !== null) {
    items.restore(save.items);
    progression.restore(save.progression);
  }
  const equipment = items.stats();
  const bonuses = progression.bonuses();
  const outgoingBasisPoints =
    equipment.outgoingAbilityDamageBasisPoints +
    bonuses.outgoingAbilityDamageBasisPoints;
  const kit = new Set<CombatAbilityId>(items.ownedAbilities());
  const loadout = items.loadout();
  for (const slot of LOADOUT_SLOTS) {
    const assigned = loadout[slot];
    if (assigned !== null) kit.add(assigned);
  }
  let total = 0;
  for (const definition of COMBAT_ABILITY_DEFINITIONS) {
    if (!kit.has(definition.id)) continue;
    total += abilityDps(
      definition,
      outgoingBasisPoints,
      bonuses.abilityDamageBasisPoints[definition.id] ?? 0,
    );
  }
  return Math.floor(total);
}

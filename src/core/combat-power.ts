import {
  BASIC_CLEAVE_ID,
  COMBAT_ABILITY_DEFINITIONS,
  damageAfterModifier,
} from "./combat-abilities";
import { CharacterProgression } from "./progression";
import { CharacterItemLoadout } from "./item-loadout";
import type { CharacterSave } from "./character-save";

function cleaveBaseDamage(): number {
  const definition = COMBAT_ABILITY_DEFINITIONS.find(
    (entry) => entry.id === BASIC_CLEAVE_ID,
  );
  const parameters = definition?.effects[0]?.parameters[0]?.value;
  if (parameters?.kind !== "cone-damage") {
    throw new Error("Basic Cleave catalog is missing a cone-damage effect.");
  }
  return parameters.damage;
}

/**
 * Basic Cleave's catalog damage — the same number the arena applies as
 * the player's displayed melee hit. Highscores use this (times the
 * character's outgoing + ability-specific multipliers) so "most damage"
 * means the same thing the combat sim does, not a client-supplied stat.
 */
export const DISPLAYED_CLEAVE_BASE_DAMAGE = cleaveBaseDamage();

/**
 * The integer damage a Basic Cleave would deal with this save's gear and
 * progression — identical to `CombatArenaSimulation`'s outgoing-damage
 * path (equipment basis points + strength/passives + Cleave-specific
 * mastery). A null save is a never-saved character: empty gear, starting
 * attributes, so the catalog base of 25.
 */
export function displayedCleaveDamage(save: CharacterSave | null): number {
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
  const abilityBonus =
    1 + (bonuses.abilityDamageBasisPoints[BASIC_CLEAVE_ID] ?? 0) / 10_000;
  const multiplier = (outgoingBasisPoints / 10_000) * abilityBonus;
  return damageAfterModifier(DISPLAYED_CLEAVE_BASE_DAMAGE, multiplier);
}

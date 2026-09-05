import {
  FLASK_CHARGES_ON_KILL_STAT_ID,
  FLASK_CHARGES_STAT_ID,
  FLASK_CHARGES_USED_REDUCTION_STAT_ID,
  FLASK_CHARGES_USED_STAT_ID,
  FLASK_DURATION_DECISECONDS_STAT_ID,
  FLASK_INSTANT_RECOVERY_STAT_ID,
  FLASK_RECOVERY_RATE_STAT_ID,
  FLASK_RECOVERY_STAT_ID,
  equipmentBaseById,
} from "./item-catalog";
import {
  modifiersForEquipment,
  type EquipmentItemInstance,
} from "./item-generation";
import { FIXED_TICKS_PER_SECOND } from "./fixed-step";

/**
 * TASK-713 memo §1.3 charge constants (DEC-038). Per-item values (recovery,
 * duration, charges, charges-used, and the six DEC-022 affix stats) are
 * read from the item instance's catalog stats — never hardcoded here.
 */
export const FLASK_BASE_CHARGES_GAINED_ON_KILL = 5;
export const FLASK_MINIMUM_CHARGES_USED = 1;
/** 0.3 s shared across all four slots (stops same-tick burst-drinking). */
export const FLASK_DRINK_SHARED_COOLDOWN_TICKS = 18;

const TICKS_PER_DECISECOND = FIXED_TICKS_PER_SECOND / 10;

/** Which vital a flask restores, derived from its base's catalog tags. */
export type FlaskResource = "health" | "mana";

/**
 * The memo's per-drink resolution (§1.2), computed from the item instance's
 * summed stats (base + affixes). All six DEC-022 flask affixes are live:
 * Brimming raises `totalRecovery`, Sudden splits an instant portion out of
 * it, Fleetpour compresses `effectiveDurationTicks` (same total, shorter
 * window), Deep Reserve raises `maximumCharges`, Thrifty lowers
 * `chargesUsedPerDrink` (floored at `FLASK_MINIMUM_CHARGES_USED`), and
 * Reaping raises `chargesGainedOnKill`.
 */
export interface FlaskEffectiveStats {
  readonly resource: FlaskResource;
  readonly totalRecovery: number;
  /** Lands on the drink tick: `floor(totalRecovery × sudden / 10 000)`. */
  readonly instantAmount: number;
  /** Applied linearly over `effectiveDurationTicks`. */
  readonly overTimeAmount: number;
  readonly effectiveDurationTicks: number;
  readonly maximumCharges: number;
  readonly chargesUsedPerDrink: number;
  readonly chargesGainedOnKill: number;
}

/**
 * Returns the restored resource for a flask item, or null when the item is
 * not a flask base.
 */
export function flaskResourceOf(
  item: EquipmentItemInstance,
): FlaskResource | null {
  const base = equipmentBaseById(item.baseId);
  if (base === undefined || base.slot !== "flask") return null;
  const tags = base.tags as readonly string[];
  if (tags.includes("tag:life-flask")) return "health";
  if (tags.includes("tag:mana-flask")) return "mana";
  return null;
}

/**
 * Computes the memo §1.2 drink plan and §1.3 charge economy for a flask
 * item instance. Returns null for non-flask items.
 */
export function flaskEffectiveStats(
  item: EquipmentItemInstance,
): FlaskEffectiveStats | null {
  const resource = flaskResourceOf(item);
  if (resource === null) return null;

  let recovery = 0;
  let durationDeciseconds = 0;
  let charges = 0;
  let chargesUsed = 0;
  let chargesUsedReduction = 0;
  let suddenBasisPoints = 0;
  let fleetpourBasisPoints = 0;
  let chargesOnKillBonus = 0;
  for (const modifier of modifiersForEquipment(item)) {
    switch (modifier.statId) {
      case FLASK_RECOVERY_STAT_ID:
        recovery += modifier.value;
        break;
      case FLASK_DURATION_DECISECONDS_STAT_ID:
        durationDeciseconds += modifier.value;
        break;
      case FLASK_CHARGES_STAT_ID:
        charges += modifier.value;
        break;
      case FLASK_CHARGES_USED_STAT_ID:
        chargesUsed += modifier.value;
        break;
      case FLASK_CHARGES_USED_REDUCTION_STAT_ID:
        chargesUsedReduction += modifier.value;
        break;
      case FLASK_INSTANT_RECOVERY_STAT_ID:
        suddenBasisPoints += modifier.value;
        break;
      case FLASK_RECOVERY_RATE_STAT_ID:
        fleetpourBasisPoints += modifier.value;
        break;
      case FLASK_CHARGES_ON_KILL_STAT_ID:
        chargesOnKillBonus += modifier.value;
        break;
      default:
        break;
    }
  }

  const instantAmount = Math.floor((recovery * suddenBasisPoints) / 10_000);
  const baseDurationTicks = durationDeciseconds * TICKS_PER_DECISECOND;
  const effectiveDurationTicks = Math.max(
    1,
    Math.round(baseDurationTicks / (1 + fleetpourBasisPoints / 10_000)),
  );
  return {
    resource,
    totalRecovery: recovery,
    instantAmount,
    overTimeAmount: recovery - instantAmount,
    effectiveDurationTicks,
    maximumCharges: charges,
    chargesUsedPerDrink: Math.max(
      FLASK_MINIMUM_CHARGES_USED,
      chargesUsed - chargesUsedReduction,
    ),
    chargesGainedOnKill: FLASK_BASE_CHARGES_GAINED_ON_KILL + chargesOnKillBonus,
  };
}

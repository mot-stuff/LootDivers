import {
  BASIC_CLEAVE_ID,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  WINTER_PULSE_ID,
  type CombatAbilityId,
} from "./combat-abilities";
import { contentId, type ContentId } from "./ids";

export const ATTRIBUTE_IDS = [
  "strength",
  "dexterity",
  "vitality",
  "intelligence",
] as const;

export type AttributeId = (typeof ATTRIBUTE_IDS)[number];

export const ATTRIBUTE_LABELS: Readonly<Record<AttributeId, string>> = {
  strength: "Strength",
  dexterity: "Dexterity",
  vitality: "Vitality",
  intelligence: "Intelligence",
};

export const ATTRIBUTE_SUMMARIES: Readonly<Record<AttributeId, string>> = {
  strength: "+2% outgoing ability damage per point",
  dexterity: "+1% movement speed per point",
  vitality: "+6 maximum health per point",
  intelligence: "+4 maximum mana per point",
};

export const STARTING_LEVEL = 1;
export const STARTING_ATTRIBUTE_POINTS = 2;
export const STARTING_PASSIVE_POINTS = 1;
export const ATTRIBUTE_POINTS_PER_LEVEL = 2;
export const PASSIVE_POINTS_PER_LEVEL = 1;
export const ENEMY_KILL_EXPERIENCE = 20;
export const BASE_MAXIMUM_MANA = 100;
export const BASE_MOVE_SPEED_BASIS_POINTS = 10_000;
export const STRENGTH_DAMAGE_BASIS_POINTS = 200;
export const DEXTERITY_MOVE_SPEED_BASIS_POINTS = 100;
export const VITALITY_MAXIMUM_HEALTH = 6;
export const INTELLIGENCE_MAXIMUM_MANA = 4;

export function experienceToNextLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError(
      "Character level must be a safe integer of 1 or more.",
    );
  }
  return 40 + 20 * (level - 1);
}

export interface PassiveDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly maximumRank: number;
  readonly outgoingAbilityDamageBasisPoints: number;
  readonly maximumHealth: number;
  readonly maximumMana: number;
  readonly moveSpeedBasisPoints: number;
  readonly abilityId: CombatAbilityId | null;
  readonly abilityDamageBasisPoints: number;
  readonly statusDurationBasisPoints: number;
}

export const PASSIVE_CATALOG: readonly PassiveDefinition[] = [
  {
    id: contentId("passive:iron-tempo"),
    displayName: "Iron Tempo",
    summary: "+4% outgoing ability damage per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 400,
    maximumHealth: 0,
    maximumMana: 0,
    moveSpeedBasisPoints: 0,
    abilityId: null,
    abilityDamageBasisPoints: 0,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:thick-hide"),
    displayName: "Thick Hide",
    summary: "+8 maximum health per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 8,
    maximumMana: 0,
    moveSpeedBasisPoints: 0,
    abilityId: null,
    abilityDamageBasisPoints: 0,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:deep-well"),
    displayName: "Deep Well",
    summary: "+6 maximum mana per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 0,
    maximumMana: 6,
    moveSpeedBasisPoints: 0,
    abilityId: null,
    abilityDamageBasisPoints: 0,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:windstride"),
    displayName: "Windstride",
    summary: "+3% movement speed per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 0,
    maximumMana: 0,
    moveSpeedBasisPoints: 300,
    abilityId: null,
    abilityDamageBasisPoints: 0,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:cleaving-form"),
    displayName: "Cleaving Form",
    summary: "+12% Basic Cleave damage per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 0,
    maximumMana: 0,
    moveSpeedBasisPoints: 0,
    abilityId: BASIC_CLEAVE_ID,
    abilityDamageBasisPoints: 1_200,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:cinder-channel"),
    displayName: "Cinder Channel",
    summary: "+12% Cinder Dart damage per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 0,
    maximumMana: 0,
    moveSpeedBasisPoints: 0,
    abilityId: CINDER_DART_ID,
    abilityDamageBasisPoints: 1_200,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:winter-channel"),
    displayName: "Winter Channel",
    summary: "+12% Winter Pulse damage per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 0,
    maximumMana: 0,
    moveSpeedBasisPoints: 0,
    abilityId: WINTER_PULSE_ID,
    abilityDamageBasisPoints: 1_200,
    statusDurationBasisPoints: 0,
  },
  {
    id: contentId("passive:lasting-banner"),
    displayName: "Lasting Banner",
    summary: "+20% Defiant Signal duration per rank",
    maximumRank: 3,
    outgoingAbilityDamageBasisPoints: 0,
    maximumHealth: 0,
    maximumMana: 0,
    moveSpeedBasisPoints: 0,
    abilityId: DEFIANT_SIGNAL_ID,
    abilityDamageBasisPoints: 0,
    statusDurationBasisPoints: 2_000,
  },
];

export function passiveById(id: ContentId): PassiveDefinition | undefined {
  return PASSIVE_CATALOG.find((passive) => passive.id === id);
}

export interface ProgressionBonuses {
  readonly maximumHealth: number;
  readonly maximumMana: number;
  readonly outgoingAbilityDamageBasisPoints: number;
  readonly moveSpeedBasisPoints: number;
  readonly abilityDamageBasisPoints: Readonly<
    Partial<Record<CombatAbilityId, number>>
  >;
  readonly statusDurationBasisPoints: Readonly<
    Partial<Record<CombatAbilityId, number>>
  >;
}

export interface AttributeReadModel {
  readonly id: AttributeId;
  readonly label: string;
  readonly summary: string;
  readonly allocated: number;
}

export interface PassiveReadModel {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly rank: number;
  readonly maximumRank: number;
}

export interface CharacterProgressionReadModel {
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
  readonly unspentAttributePoints: number;
  readonly unspentPassivePoints: number;
  readonly attributes: readonly AttributeReadModel[];
  readonly passives: readonly PassiveReadModel[];
  readonly bonuses: ProgressionBonuses;
}

export type ProgressionSpendFailure =
  | "no-unspent-points"
  | "nothing-allocated"
  | "unknown-passive"
  | "maximum-rank";

export interface ProgressionSpendResult {
  readonly accepted: boolean;
  readonly reason?: ProgressionSpendFailure;
}

/**
 * Serializable progression state for the character save DTO (TASK-705).
 * `passiveRanks` lists only passives with at least one rank, in catalog
 * order, so canonical JSON stays stable across sessions.
 */
export interface CharacterProgressionSnapshot {
  readonly level: number;
  readonly experience: number;
  readonly unspentAttributePoints: number;
  readonly unspentPassivePoints: number;
  readonly attributes: Readonly<Record<AttributeId, number>>;
  readonly passiveRanks: readonly {
    readonly id: ContentId;
    readonly rank: number;
  }[];
}

export interface ExperienceGrantResult {
  readonly accepted: true;
  readonly amount: number;
  readonly levelsGained: number;
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
}

function emptyAttributes(): Record<AttributeId, number> {
  return {
    strength: 0,
    dexterity: 0,
    vitality: 0,
    intelligence: 0,
  };
}

/**
 * Owns prototype character XP, level, attribute spends, and the small
 * mastery catalog. Presentation layers issue commands here rather than
 * retaining parallel mutable progression state.
 */
export class CharacterProgression {
  #level = STARTING_LEVEL;
  #experience = 0;
  #unspentAttributePoints = STARTING_ATTRIBUTE_POINTS;
  #unspentPassivePoints = STARTING_PASSIVE_POINTS;
  readonly #attributes = emptyAttributes();
  readonly #passiveRanks = new Map<ContentId, number>();

  public level(): number {
    return this.#level;
  }

  public grantExperience(amount: number): ExperienceGrantResult {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(
        "Experience grants must be finite and non-negative.",
      );
    }

    this.#experience += amount;
    let levelsGained = 0;
    let required = experienceToNextLevel(this.#level);
    while (this.#experience >= required) {
      this.#experience -= required;
      this.#level += 1;
      this.#unspentAttributePoints += ATTRIBUTE_POINTS_PER_LEVEL;
      this.#unspentPassivePoints += PASSIVE_POINTS_PER_LEVEL;
      levelsGained += 1;
      required = experienceToNextLevel(this.#level);
    }

    return {
      accepted: true,
      amount,
      levelsGained,
      level: this.#level,
      experience: this.#experience,
      experienceToNextLevel: required,
    };
  }

  public allocateAttribute(attribute: AttributeId): ProgressionSpendResult {
    if (this.#unspentAttributePoints < 1) {
      return { accepted: false, reason: "no-unspent-points" };
    }
    this.#unspentAttributePoints -= 1;
    this.#attributes[attribute] += 1;
    return { accepted: true };
  }

  public deallocateAttribute(attribute: AttributeId): ProgressionSpendResult {
    if (this.#attributes[attribute] < 1) {
      return { accepted: false, reason: "nothing-allocated" };
    }
    this.#attributes[attribute] -= 1;
    this.#unspentAttributePoints += 1;
    return { accepted: true };
  }

  public allocatePassive(passiveId: ContentId): ProgressionSpendResult {
    const definition = passiveById(passiveId);
    if (definition === undefined) {
      return { accepted: false, reason: "unknown-passive" };
    }
    if (this.#unspentPassivePoints < 1) {
      return { accepted: false, reason: "no-unspent-points" };
    }
    const rank = this.#passiveRanks.get(definition.id) ?? 0;
    if (rank >= definition.maximumRank) {
      return { accepted: false, reason: "maximum-rank" };
    }
    this.#unspentPassivePoints -= 1;
    this.#passiveRanks.set(definition.id, rank + 1);
    return { accepted: true };
  }

  public respec(): void {
    let attributeRefund = 0;
    for (const attribute of ATTRIBUTE_IDS) {
      attributeRefund += this.#attributes[attribute];
      this.#attributes[attribute] = 0;
    }
    let passiveRefund = 0;
    for (const rank of this.#passiveRanks.values()) passiveRefund += rank;
    this.#passiveRanks.clear();
    this.#unspentAttributePoints += attributeRefund;
    this.#unspentPassivePoints += passiveRefund;
  }

  public bonuses(): ProgressionBonuses {
    const abilityDamageBasisPoints: Partial<Record<CombatAbilityId, number>> =
      {};
    const statusDurationBasisPoints: Partial<Record<CombatAbilityId, number>> =
      {};
    let maximumHealth = this.#attributes.vitality * VITALITY_MAXIMUM_HEALTH;
    let maximumMana = this.#attributes.intelligence * INTELLIGENCE_MAXIMUM_MANA;
    let outgoingAbilityDamageBasisPoints =
      this.#attributes.strength * STRENGTH_DAMAGE_BASIS_POINTS;
    let moveSpeedBasisPoints =
      this.#attributes.dexterity * DEXTERITY_MOVE_SPEED_BASIS_POINTS;

    for (const definition of PASSIVE_CATALOG) {
      const rank = this.#passiveRanks.get(definition.id) ?? 0;
      if (rank === 0) continue;
      maximumHealth += definition.maximumHealth * rank;
      maximumMana += definition.maximumMana * rank;
      outgoingAbilityDamageBasisPoints +=
        definition.outgoingAbilityDamageBasisPoints * rank;
      moveSpeedBasisPoints += definition.moveSpeedBasisPoints * rank;
      if (definition.abilityId !== null) {
        if (definition.abilityDamageBasisPoints > 0) {
          abilityDamageBasisPoints[definition.abilityId] =
            (abilityDamageBasisPoints[definition.abilityId] ?? 0) +
            definition.abilityDamageBasisPoints * rank;
        }
        if (definition.statusDurationBasisPoints > 0) {
          statusDurationBasisPoints[definition.abilityId] =
            (statusDurationBasisPoints[definition.abilityId] ?? 0) +
            definition.statusDurationBasisPoints * rank;
        }
      }
    }

    return {
      maximumHealth,
      maximumMana,
      outgoingAbilityDamageBasisPoints,
      moveSpeedBasisPoints,
      abilityDamageBasisPoints,
      statusDurationBasisPoints,
    };
  }

  public snapshot(): CharacterProgressionSnapshot {
    return {
      level: this.#level,
      experience: this.#experience,
      unspentAttributePoints: this.#unspentAttributePoints,
      unspentPassivePoints: this.#unspentPassivePoints,
      attributes: { ...this.#attributes },
      passiveRanks: PASSIVE_CATALOG.filter(
        (definition) => (this.#passiveRanks.get(definition.id) ?? 0) > 0,
      ).map((definition) => ({
        id: definition.id,
        rank: this.#passiveRanks.get(definition.id) ?? 0,
      })),
    };
  }

  /**
   * Replaces all progression state from a snapshot. Callers validate the
   * snapshot first (see `parseCharacterSave`).
   */
  public restore(snapshot: CharacterProgressionSnapshot): void {
    this.#level = snapshot.level;
    this.#experience = snapshot.experience;
    this.#unspentAttributePoints = snapshot.unspentAttributePoints;
    this.#unspentPassivePoints = snapshot.unspentPassivePoints;
    for (const id of ATTRIBUTE_IDS) {
      this.#attributes[id] = snapshot.attributes[id];
    }
    this.#passiveRanks.clear();
    for (const entry of snapshot.passiveRanks) {
      this.#passiveRanks.set(entry.id, entry.rank);
    }
  }

  public readModel(): CharacterProgressionReadModel {
    return {
      level: this.#level,
      experience: this.#experience,
      experienceToNextLevel: experienceToNextLevel(this.#level),
      unspentAttributePoints: this.#unspentAttributePoints,
      unspentPassivePoints: this.#unspentPassivePoints,
      attributes: ATTRIBUTE_IDS.map((id) => ({
        id,
        label: ATTRIBUTE_LABELS[id],
        summary: ATTRIBUTE_SUMMARIES[id],
        allocated: this.#attributes[id],
      })),
      passives: PASSIVE_CATALOG.map((definition) => ({
        id: definition.id,
        displayName: definition.displayName,
        summary: definition.summary,
        rank: this.#passiveRanks.get(definition.id) ?? 0,
        maximumRank: definition.maximumRank,
      })),
      bonuses: this.bonuses(),
    };
  }
}

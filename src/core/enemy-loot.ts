import { ITEM_BASE_CATALOG, type ItemRarity } from "./item-catalog";
import {
  createAbilityStoneStack,
  generateEquipmentItem,
  type ItemInstance,
} from "./item-generation";
import { persistentInstanceId } from "./ids";
import { Mulberry32, type RandomState } from "./random";
import type { EnemyRank } from "./simple-melee-enemy";

export interface EnemyLootWeights {
  readonly common: number;
  readonly magic: number;
  readonly rare: number;
}

export interface EnemyLootGeneratorConfig {
  readonly seed: number;
  readonly rarityWeights: EnemyLootWeights;
}

export interface GeneratedEnemyLoot {
  readonly killSequence: number;
  readonly items: readonly ItemInstance[];
  /** Gold pile amount for this kill (TASK-712, TASK-713 memo §2). */
  readonly gold: number;
}

/**
 * Per-rank uniform inclusive gold roll ranges (TASK-713 memo §2.1, binding).
 * Every player kill drops exactly one pile; rarity never modulates gold.
 */
export const GOLD_DROP_RANGES: Readonly<
  Record<EnemyRank, { readonly min: number; readonly max: number }>
> = {
  normal: { min: 3, max: 7 },
  elite: { min: 10, max: 14 },
  boss: { min: 30, max: 50 },
};

/**
 * Derives the gold RNG seed from the run seed (TASK-713 memo §2.4). Gold
 * rolls draw from their own Mulberry32 stream so the item sequence stays
 * byte-identical to a gold-less run — existing seeded item tests must not
 * shift.
 */
export function goldSeedFromRunSeed(seed: number): number {
  return (seed ^ 0x9e3779b9) >>> 0;
}

/**
 * A dropped, not-yet-collected gold pile in the arena (TASK-712). Transient
 * like other ground drops: never persisted, despawns with zone state.
 */
export interface GoldPileDrop {
  readonly pileId: string;
  readonly amount: number;
  readonly x: number;
  readonly y: number;
}

/**
 * Serializable position within a run's deterministic loot sequence
 * (TASK-705). Persisting it lets a restored session continue minting
 * instance IDs and rolls exactly where the saved run stopped, so saved
 * items can never collide with post-restore drops.
 */
export interface EnemyLootGeneratorSnapshot {
  readonly seed: number;
  readonly killSequence: number;
  readonly itemSequence: number;
  readonly random: RandomState;
}

export interface WorldLootDrop {
  readonly dropId: string;
  readonly item: ItemInstance;
  readonly x: number;
  readonly y: number;
}

export const DEFAULT_ENEMY_LOOT_WEIGHTS: EnemyLootWeights = {
  common: 70,
  magic: 25,
  rare: 5,
};

/**
 * Owns one run's deterministic enemy-loot sequence. Its state intentionally
 * survives arena resets so repeated encounters cannot replay instance IDs.
 */
export class DeterministicEnemyLootGenerator {
  readonly #random: Mulberry32;
  /**
   * Independent gold stream (TASK-713 memo §2.4): seeded from
   * `goldSeedFromRunSeed`, consuming exactly one uint32 draw per kill so
   * its position is always `killSequence` draws. `fromSnapshot` fast-forwards
   * it from the persisted kill counter — no new save field needed.
   */
  readonly #goldRandom: Mulberry32;
  readonly #weights: EnemyLootWeights;
  readonly #seed: number;
  #killSequence = 0;
  #itemSequence = 0;

  public constructor(config: EnemyLootGeneratorConfig) {
    this.#random = new Mulberry32(config.seed);
    this.#goldRandom = new Mulberry32(goldSeedFromRunSeed(config.seed));
    this.#weights = config.rarityWeights;
    this.#seed = config.seed;
    const weights = [
      config.rarityWeights.common,
      config.rarityWeights.magic,
      config.rarityWeights.rare,
    ];
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    if (
      weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0) ||
      totalWeight === 0 ||
      totalWeight > 0x1_0000_0000
    ) {
      throw new RangeError(
        "Enemy loot rarity weights must be nonnegative integers with a total from 1 through 2^32.",
      );
    }
  }

  public snapshot(): EnemyLootGeneratorSnapshot {
    return {
      seed: this.#seed,
      killSequence: this.#killSequence,
      itemSequence: this.#itemSequence,
      random: this.#random.saveState(),
    };
  }

  /**
   * Reconstructs a generator mid-sequence from a saved snapshot. Callers
   * validate the snapshot shape (see `parseCharacterSave`).
   */
  public static fromSnapshot(
    snapshot: EnemyLootGeneratorSnapshot,
    rarityWeights: EnemyLootWeights,
  ): DeterministicEnemyLootGenerator {
    const generator = new DeterministicEnemyLootGenerator({
      seed: snapshot.seed,
      rarityWeights,
    });
    generator.#killSequence = snapshot.killSequence;
    generator.#itemSequence = snapshot.itemSequence;
    generator.#random.restoreState(snapshot.random);
    // The gold stream consumes exactly one draw per kill, so its position is
    // derivable from the persisted kill counter (TASK-712): a restored run
    // continues the same gold sequence an unbroken run would have produced.
    generator.#goldRandom.restoreState(
      Mulberry32.atDraw(
        goldSeedFromRunSeed(snapshot.seed),
        snapshot.killSequence,
      ).saveState(),
    );
    return generator;
  }

  public generateForKill(rank: EnemyRank = "normal"): GeneratedEnemyLoot {
    this.#killSequence += 1;
    const equipment = generateEquipmentItem({
      seed: this.#random.nextUint32(),
      instanceId: this.nextItemId(),
      baseId:
        ITEM_BASE_CATALOG[this.#random.nextInteger(ITEM_BASE_CATALOG.length)]!
          .id,
      rarity: this.rollRarity(),
    });
    const items: ItemInstance[] = [equipment];

    if (this.#killSequence === 1) {
      items.push(createAbilityStoneStack(this.nextItemId()));
    }

    return {
      killSequence: this.#killSequence,
      items,
      gold: this.rollGold(rank),
    };
  }

  /**
   * Uniform inclusive roll in the rank's memo range, consuming exactly one
   * gold-stream draw. A plain modulo keeps the draw count fixed (rejection
   * sampling would make the stream position untrackable across restores);
   * the bias over spans of 5–21 values is at most 21/2^32 — immaterial.
   */
  private rollGold(rank: EnemyRank): number {
    const range = GOLD_DROP_RANGES[rank];
    const span = range.max - range.min + 1;
    return range.min + (this.#goldRandom.nextUint32() % span);
  }

  public killsGenerated(): number {
    return this.#killSequence;
  }

  private rollRarity(): ItemRarity {
    const total =
      this.#weights.common + this.#weights.magic + this.#weights.rare;
    const roll = this.#random.nextInteger(total);
    if (roll < this.#weights.common) return "common";
    if (roll < this.#weights.common + this.#weights.magic) return "magic";
    return "rare";
  }

  private nextItemId() {
    this.#itemSequence += 1;
    return persistentInstanceId(
      `loot:run-${this.#seed}-item-${this.#itemSequence}`,
    );
  }
}

import { EQUIPMENT_BASE_CATALOG, type ItemRarity } from "./item-catalog";
import {
  createAbilityStoneStack,
  generateEquipmentItem,
  type ItemInstance,
} from "./item-generation";
import { persistentInstanceId } from "./ids";
import { Mulberry32 } from "./random";

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
  readonly #weights: EnemyLootWeights;
  readonly #seed: number;
  #killSequence = 0;
  #itemSequence = 0;

  public constructor(config: EnemyLootGeneratorConfig) {
    this.#random = new Mulberry32(config.seed);
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

  public generateForKill(): GeneratedEnemyLoot {
    this.#killSequence += 1;
    const equipment = generateEquipmentItem({
      seed: this.#random.nextUint32(),
      instanceId: this.nextItemId(),
      baseId:
        EQUIPMENT_BASE_CATALOG[
          this.#random.nextInteger(EQUIPMENT_BASE_CATALOG.length)
        ]!.id,
      rarity: this.rollRarity(),
    });
    const items: ItemInstance[] = [equipment];

    if (this.#killSequence === 1) {
      items.push(createAbilityStoneStack(this.nextItemId()));
    }

    return { killSequence: this.#killSequence, items };
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

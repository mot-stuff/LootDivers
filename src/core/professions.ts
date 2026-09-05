import { contentId, type ContentId } from "./ids";
import type { GeneratableItemRarity } from "./item-catalog";

export const PROFESSION_IDS = ["mining", "smithing"] as const;
export type ProfessionId = (typeof PROFESSION_IDS)[number];

export const PROFESSION_LABELS: Readonly<Record<ProfessionId, string>> = {
  mining: "Mining",
  smithing: "Smithing",
};

export const MATERIAL_STACK_LIMIT = 20;
export const INTERACT_RADIUS = 80;

export const VEINSHARD_ORE_ID = contentId("material:veinshard-ore");
export const DEEPVEIN_ORE_ID = contentId("material:deepvein-ore");

export interface MaterialDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly stackLimit: number;
}

export const MATERIAL_CATALOG: readonly MaterialDefinition[] = [
  {
    id: VEINSHARD_ORE_ID,
    displayName: "Veinshard Ore",
    summary: "Common ore used for Tempering crafts",
    stackLimit: MATERIAL_STACK_LIMIT,
  },
  {
    id: DEEPVEIN_ORE_ID,
    displayName: "Deepvein Ore",
    summary: "Harder ore unlocked at Mining 3",
    stackLimit: MATERIAL_STACK_LIMIT,
  },
];

export function materialById(id: ContentId): MaterialDefinition | undefined {
  return MATERIAL_CATALOG.find((material) => material.id === id);
}

export type WorldInteractableKind =
  "ore-node" | "forge" | "portal" | "vendor" | "quest-giver";

export interface OreNodeDefinition {
  readonly id: ContentId;
  readonly kind: "ore-node";
  readonly displayName: string;
  readonly materialId: ContentId;
  readonly requiredMiningLevel: number;
  readonly experience: number;
  readonly yieldQuantity: number;
  readonly gatherSeconds: number;
  readonly charges: number;
  readonly respawnSeconds: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface ForgeDefinition {
  readonly id: ContentId;
  readonly kind: "forge";
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export const VEINSHARD_OUTCROP_ID = contentId("node:veinshard-outcrop");
export const DEEPVEIN_SEAM_ID = contentId("node:deepvein-seam");
export const ARENA_FORGE_ID = contentId("station:tempering-forge");

export const ORE_NODE_CATALOG: readonly OreNodeDefinition[] = [
  {
    id: VEINSHARD_OUTCROP_ID,
    kind: "ore-node",
    displayName: "Veinshard Outcrop",
    materialId: VEINSHARD_ORE_ID,
    requiredMiningLevel: 1,
    experience: 8,
    yieldQuantity: 1,
    gatherSeconds: 1.2,
    charges: 4,
    respawnSeconds: 8,
    x: 220,
    y: 220,
    radius: 22,
  },
  {
    id: DEEPVEIN_SEAM_ID,
    kind: "ore-node",
    displayName: "Deepvein Seam",
    materialId: DEEPVEIN_ORE_ID,
    requiredMiningLevel: 3,
    experience: 16,
    yieldQuantity: 1,
    gatherSeconds: 1.6,
    charges: 3,
    respawnSeconds: 12,
    x: 980,
    y: 580,
    radius: 22,
  },
];

export const ARENA_FORGE: ForgeDefinition = {
  id: ARENA_FORGE_ID,
  kind: "forge",
  displayName: "Tempering Forge",
  x: 220,
  y: 580,
  radius: 26,
};

export interface CraftingIngredient {
  readonly materialId: ContentId;
  readonly quantity: number;
}

export interface CraftingRecipeDefinition {
  readonly id: ContentId;
  readonly displayName: string;
  readonly summary: string;
  readonly requiredSmithingLevel: number;
  readonly experience: number;
  readonly ingredients: readonly CraftingIngredient[];
  readonly outputBaseId: ContentId;
  readonly outputRarity: GeneratableItemRarity;
}

export const TEMPERING_CLEAVER_RECIPE_ID = contentId(
  "recipe:tempering-cleaver",
);
export const TEMPERING_VEST_RECIPE_ID = contentId("recipe:tempering-vest");
export const DEEPVEIN_CLEAVER_RECIPE_ID = contentId("recipe:deepvein-cleaver");

export const CRAFTING_RECIPE_CATALOG: readonly CraftingRecipeDefinition[] = [
  {
    id: TEMPERING_CLEAVER_RECIPE_ID,
    displayName: "Tempering Cleaver",
    summary: "A forged main-hand with a stronger damage implicit",
    requiredSmithingLevel: 1,
    experience: 15,
    ingredients: [{ materialId: VEINSHARD_ORE_ID, quantity: 3 }],
    outputBaseId: contentId("item:tempering-cleaver"),
    outputRarity: "common",
  },
  {
    id: TEMPERING_VEST_RECIPE_ID,
    displayName: "Tempering Vest",
    summary: "Forged chest armor with a stronger health implicit",
    requiredSmithingLevel: 1,
    experience: 18,
    ingredients: [{ materialId: VEINSHARD_ORE_ID, quantity: 4 }],
    outputBaseId: contentId("item:tempering-vest"),
    outputRarity: "common",
  },
  {
    id: DEEPVEIN_CLEAVER_RECIPE_ID,
    displayName: "Deepvein Cleaver",
    summary: "A harder forged blade. Requires Smithing 3",
    requiredSmithingLevel: 3,
    experience: 28,
    ingredients: [{ materialId: DEEPVEIN_ORE_ID, quantity: 3 }],
    outputBaseId: contentId("item:deepvein-cleaver"),
    outputRarity: "magic",
  },
];

export function recipeById(
  id: ContentId,
): CraftingRecipeDefinition | undefined {
  return CRAFTING_RECIPE_CATALOG.find((recipe) => recipe.id === id);
}

export function oreNodeById(id: ContentId): OreNodeDefinition | undefined {
  return ORE_NODE_CATALOG.find((node) => node.id === id);
}

export function professionExperienceToNextLevel(level: number): number {
  if (!Number.isSafeInteger(level) || level < 1) {
    throw new RangeError(
      "Profession level must be a safe integer of 1 or more.",
    );
  }
  return 20 + 10 * (level - 1);
}

export interface ProfessionReadModel {
  readonly id: ProfessionId;
  readonly label: string;
  readonly level: number;
  readonly experience: number;
  readonly experienceToNextLevel: number;
}

/** Serializable profession state for the character save DTO (TASK-705). */
export type ProfessionProgressionSnapshot = Readonly<
  Record<ProfessionId, { readonly level: number; readonly experience: number }>
>;

export interface ProfessionGrantResult {
  readonly accepted: true;
  readonly amount: number;
  readonly levelsGained: number;
  readonly level: number;
  readonly experience: number;
}

function emptyLevels(): Record<ProfessionId, number> {
  return { mining: 1, smithing: 1 };
}

function emptyExperience(): Record<ProfessionId, number> {
  return { mining: 0, smithing: 0 };
}

/**
 * Owns Mining and Smithing XP independently from combat level.
 */
export class ProfessionProgression {
  readonly #levels = emptyLevels();
  readonly #experience = emptyExperience();

  public level(id: ProfessionId): number {
    return this.#levels[id];
  }

  public grantExperience(
    id: ProfessionId,
    amount: number,
  ): ProfessionGrantResult {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(
        "Profession experience grants must be finite and non-negative.",
      );
    }

    this.#experience[id] += amount;
    let levelsGained = 0;
    let required = professionExperienceToNextLevel(this.#levels[id]);
    while (this.#experience[id] >= required) {
      this.#experience[id] -= required;
      this.#levels[id] += 1;
      levelsGained += 1;
      required = professionExperienceToNextLevel(this.#levels[id]);
    }

    return {
      accepted: true,
      amount,
      levelsGained,
      level: this.#levels[id],
      experience: this.#experience[id],
    };
  }

  public snapshot(): ProfessionProgressionSnapshot {
    return {
      mining: {
        level: this.#levels.mining,
        experience: this.#experience.mining,
      },
      smithing: {
        level: this.#levels.smithing,
        experience: this.#experience.smithing,
      },
    };
  }

  /**
   * Replaces both professions' state from a snapshot. Callers validate the
   * snapshot first (see `parseCharacterSave`).
   */
  public restore(snapshot: ProfessionProgressionSnapshot): void {
    for (const id of PROFESSION_IDS) {
      this.#levels[id] = snapshot[id].level;
      this.#experience[id] = snapshot[id].experience;
    }
  }

  public readModel(): readonly ProfessionReadModel[] {
    return PROFESSION_IDS.map((id) => ({
      id,
      label: PROFESSION_LABELS[id],
      level: this.#levels[id],
      experience: this.#experience[id],
      experienceToNextLevel: professionExperienceToNextLevel(this.#levels[id]),
    }));
  }
}

import type { IntentSink, ReadModelSource } from "../core";

export type ShellPhase =
  | { readonly kind: "loading"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly rendererVersion: string;
      readonly zoneId?: string;
    }
  | {
      readonly kind: "error";
      readonly heading: string;
      readonly detail: string;
      readonly canRetry: boolean;
    };

export interface CanvasViewportReadModel {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly backingWidth: number;
  readonly backingHeight: number;
  readonly devicePixelRatio: number;
}

export type CombatAbilityHudState =
  | "ready"
  | "executing"
  | "busy"
  | "cooldown"
  | "insufficient-mana"
  | "defeated";

export interface CombatAbilityHudReadModel {
  readonly id: string;
  readonly keyLabel: string;
  readonly accessibleKeyLabel: string;
  readonly name: string;
  readonly manaCost: number;
  readonly cooldownRemainingSeconds: number;
  readonly cooldownMaximumSeconds: number;
  readonly state: CombatAbilityHudState;
}

export interface CombatStatusHudReadModel {
  readonly id: string;
  readonly label: string;
  readonly target: "player" | "enemy";
  readonly remainingSeconds: number;
}

export type MinimapHudMarkerKind =
  "player" | "enemy" | "portal" | "node" | "forge" | "vendor" | "quest";

export type MinimapHudEnemyRank = "normal" | "elite" | "boss";

export interface MinimapHudMarkerReadModel {
  readonly id: string;
  readonly kind: MinimapHudMarkerKind;
  readonly x: number;
  readonly y: number;
  readonly rank?: MinimapHudEnemyRank;
}

export interface MinimapHudBoundsReadModel {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MinimapHudReadModel {
  readonly width: number;
  readonly height: number;
  readonly floorColor: string;
  readonly edgeColor: string;
  readonly walkable: MinimapHudBoundsReadModel;
  readonly markers: readonly MinimapHudMarkerReadModel[];
}

export interface TutorialHudReadModel {
  readonly stepId: string;
  readonly prompt: string;
  /** Canonical 1-based position of the displayed step. */
  readonly stepNumber: number;
  /** Count of banked steps (order-independent). */
  readonly stepsCompleted: number;
  readonly totalSteps: number;
}

export interface CombatHudReadModel {
  readonly paused: boolean;
  readonly playerHealth: number;
  readonly playerMaxHealth: number;
  readonly playerDead: boolean;
  readonly manaCurrent: number;
  readonly manaMaximum: number;
  readonly level: number;
  readonly experienceCurrent: number;
  readonly experienceToNextLevel: number;
  readonly abilities: readonly CombatAbilityHudReadModel[];
  readonly activeStatuses: readonly CombatStatusHudReadModel[];
  readonly gatheringLabel: string | null;
  readonly gatheringProgress: number;
  /** Stable zone id; the TASK-705 save trigger watches it for travel. */
  readonly zoneId: string;
  readonly zoneName: string;
  /**
   * Display name of the zone a death here respawns into (TASK-710,
   * DEC-037); the death overlay names the destination on its confirm.
   */
  readonly respawnZoneName: string;
  readonly questLabel: string | null;
  /** Active tutorial prompt; null outside the tutorial or once completed. */
  readonly tutorial: TutorialHudReadModel | null;
  readonly minimap: MinimapHudReadModel;
}

export type ItemEquipmentSlot =
  | "helmet"
  | "chest"
  | "amulet"
  | "belt"
  | "boots"
  | "main-hand"
  | "offhand"
  | "ring-1"
  | "ring-2"
  | "flask-1"
  | "flask-2"
  | "flask-3"
  | "flask-4";
export type ItemEquipmentSlotKind =
  | "helmet"
  | "chest"
  | "amulet"
  | "belt"
  | "boots"
  | "main-hand"
  | "offhand"
  | "ring"
  | "flask";
export type ItemRarityHud = "common" | "magic" | "rare" | "unique";
export type ItemLoadoutSlot = "lmb" | "q" | "e" | "r";

export interface ItemModifierHudReadModel {
  readonly id: string;
  readonly source: "base" | "affix";
  readonly label: string;
  /** Affix tier 1 (best) through 5; null for base modifiers. */
  readonly tier: number | null;
}

export interface EquipmentItemHudReadModel {
  readonly kind: "equipment";
  readonly instanceId: string;
  readonly displayName: string;
  readonly rarity: ItemRarityHud;
  readonly slotKind: ItemEquipmentSlotKind;
  readonly typeLabel: string;
  readonly requiredLevel: number;
  readonly origin: "loot" | "crafted";
  readonly modifiers: readonly ItemModifierHudReadModel[];
}

export interface AbilityStoneItemHudReadModel {
  readonly kind: "ability-stone";
  readonly instanceId: string;
  readonly displayName: string;
  readonly rarity: "common";
  readonly typeLabel: "Ability Stone";
  readonly quantity: number;
}

export interface MaterialItemHudReadModel {
  readonly kind: "material";
  readonly instanceId: string;
  readonly displayName: string;
  readonly rarity: "common";
  readonly typeLabel: "Material";
  readonly quantity: number;
  readonly summary: string;
}

export type ItemHudReadModel =
  | EquipmentItemHudReadModel
  | AbilityStoneItemHudReadModel
  | MaterialItemHudReadModel;

export interface InventorySlotHudReadModel {
  readonly index: number;
  readonly item: ItemHudReadModel | null;
}

export interface EquipmentSlotHudReadModel {
  readonly slot: ItemEquipmentSlot;
  readonly label: string;
  readonly item: EquipmentItemHudReadModel | null;
}

export interface AbilityChoiceHudReadModel {
  readonly id: string;
  readonly displayName: string;
  readonly owned: boolean;
  readonly selectableFromStone: boolean;
}

export interface LoadoutAssignmentHudReadModel {
  readonly slot: ItemLoadoutSlot;
  readonly keyLabel: string;
  readonly accessibleKeyLabel: string;
  readonly abilityId: string | null;
  readonly displayName: string;
  /**
   * Phase 2 defaults may remain assigned before the corresponding ability is
   * owned. They are display-only until created from an Ability Stone.
   */
  readonly borrowedDefault: boolean;
}

export interface InventoryHudReadModel {
  readonly revision: number;
  /**
   * Carried gold total (TASK-712, DEC-039): non-negative integer, clamped
   * at the memo cap by the core wallet. The inventory panel renders it as
   * a locale-formatted counter.
   */
  readonly gold: number;
  readonly inventorySlots: readonly InventorySlotHudReadModel[];
  readonly equipmentSlots: readonly EquipmentSlotHudReadModel[];
  readonly flaskSlots: readonly EquipmentSlotHudReadModel[];
  readonly abilityChoices: readonly AbilityChoiceHudReadModel[];
  readonly loadout: readonly LoadoutAssignmentHudReadModel[];
  readonly playerMaximumHealth: number;
  readonly outgoingAbilityDamagePercent: number;
}

export type ItemUiCommand =
  | {
      readonly type: "item.equip";
      readonly inventoryIndex: number;
      /** When omitted, the core derives the slot from the item's base. */
      readonly targetEquipmentSlot?: ItemEquipmentSlot;
    }
  | {
      readonly type: "item.unequip";
      readonly equipmentSlot: ItemEquipmentSlot;
    }
  | {
      readonly type: "item.consume-ability-stone";
      readonly inventoryIndex: number;
      readonly abilityId: string;
    }
  | {
      readonly type: "item.assign-ability";
      readonly loadoutSlot: ItemLoadoutSlot;
      readonly abilityId: string;
    };

export type CharacterAttributeId =
  "strength" | "dexterity" | "vitality" | "intelligence";

export interface CharacterAttributeHudReadModel {
  readonly id: CharacterAttributeId;
  readonly label: string;
  readonly summary: string;
  readonly allocated: number;
}

export interface CharacterPassiveHudReadModel {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly rank: number;
  readonly maximumRank: number;
}

export interface CharacterHudReadModel {
  readonly revision: number;
  readonly level: number;
  readonly experienceCurrent: number;
  readonly experienceToNextLevel: number;
  readonly unspentAttributePoints: number;
  readonly unspentPassivePoints: number;
  readonly attributes: readonly CharacterAttributeHudReadModel[];
  readonly passives: readonly CharacterPassiveHudReadModel[];
  readonly maximumHealth: number;
  readonly maximumMana: number;
  readonly outgoingAbilityDamagePercent: number;
  readonly moveSpeedPercent: number;
  readonly abilityChoices: readonly AbilityChoiceHudReadModel[];
  readonly loadout: readonly LoadoutAssignmentHudReadModel[];
  readonly professions: readonly CharacterProfessionHudReadModel[];
  readonly forgeOpen: boolean;
  readonly recipes: readonly CraftingRecipeHudReadModel[];
  readonly vendorOpen: boolean;
  readonly vendorOffers: readonly VendorOfferHudReadModel[];
  readonly quest: {
    readonly id: string;
    readonly displayName: string;
    readonly summary: string;
    readonly stage: "inactive" | "accepted" | "ready" | "completed";
  };
}

export interface CharacterProfessionHudReadModel {
  readonly id: string;
  readonly label: string;
  readonly level: number;
  readonly experienceCurrent: number;
  readonly experienceToNextLevel: number;
}

export interface CraftingRecipeHudReadModel {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly requiredSmithingLevel: number;
  readonly ingredients: readonly {
    readonly materialId: string;
    readonly displayName: string;
    readonly required: number;
    readonly owned: number;
  }[];
  readonly canCraft: boolean;
  readonly blockedReason: string | null;
}

export type ProgressionUiCommand =
  | {
      readonly type: "progression.allocate-attribute";
      readonly attribute: CharacterAttributeId;
    }
  | {
      readonly type: "progression.deallocate-attribute";
      readonly attribute: CharacterAttributeId;
    }
  | {
      readonly type: "progression.allocate-passive";
      readonly passiveId: string;
    }
  | { readonly type: "progression.respec" };

export type ProfessionUiCommand =
  | { readonly type: "profession.craft"; readonly recipeId: string }
  | { readonly type: "profession.close-forge" };

export interface VendorOfferHudReadModel {
  readonly id: string;
  readonly displayName: string;
  readonly summary: string;
  readonly materialName: string;
  readonly required: number;
  readonly owned: number;
  readonly canBuy: boolean;
}

export type WorldUiCommand =
  | { readonly type: "world.vendor-buy"; readonly offerId: string }
  | { readonly type: "world.close-vendor" }
  /** Zone travel request; unknown zone ids are ignored by the adapter. */
  | { readonly type: "world.travel"; readonly zoneId: string }
  /**
   * Death-screen confirmation (TASK-710, DEC-037): respawn the dead player
   * at the current zone's respawn destination. Ignored while alive.
   */
  | { readonly type: "world.respawn" };

export const WORLD_COMMAND_EVENT = "rarpg:world-command";

/**
 * Dispatched on `window` by the presentation adapter after an accepted
 * respawn, carrying the arrival zone id. `main.tsx` listens to fire the
 * DEC-037 save-at-respawn trigger alongside DEC-034's zone-travel and
 * page-hide triggers.
 */
export const CHARACTER_RESPAWN_EVENT = "rarpg:character-respawned";

export interface CharacterRespawnEventDetail {
  readonly zoneId: string;
}

export const ITEM_HUD_EVENT = "rarpg:item-hud";
export const ITEM_COMMAND_EVENT = "rarpg:item-command";
export const CHARACTER_HUD_EVENT = "rarpg:character-hud";
export const PROGRESSION_COMMAND_EVENT = "rarpg:progression-command";
export const PROFESSION_COMMAND_EVENT = "rarpg:profession-command";

declare global {
  interface WindowEventMap {
    "rarpg:item-hud": CustomEvent<InventoryHudReadModel>;
    "rarpg:item-command": CustomEvent<ItemUiCommand>;
    "rarpg:character-hud": CustomEvent<CharacterHudReadModel>;
    "rarpg:progression-command": CustomEvent<ProgressionUiCommand>;
    "rarpg:profession-command": CustomEvent<ProfessionUiCommand>;
    "rarpg:world-command": CustomEvent<WorldUiCommand>;
    "rarpg:character-respawned": CustomEvent<CharacterRespawnEventDetail>;
  }
}

export interface ShellReadModel {
  readonly revision: number;
  readonly phase: ShellPhase;
  readonly viewport: CanvasViewportReadModel;
  readonly emittedIntentCount: number;
  readonly capturedKeyboardCount: number;
  readonly lastIntentType: ShellIntent["type"] | null;
}

export type ShellIntent =
  | { readonly type: "shell.diagnostic-requested" }
  | { readonly type: "shell.renderer-retry-requested" }
  | {
      readonly type: "shell.canvas-keyboard-observed";
      readonly code: string;
    };

export interface ShellBindings {
  readonly models: ReadModelSource<ShellReadModel>;
  readonly intents: IntentSink<ShellIntent>;
}

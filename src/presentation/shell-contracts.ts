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

export interface CombatHudReadModel {
  readonly paused: boolean;
  readonly playerHealth: number;
  readonly playerMaxHealth: number;
  readonly playerDead: boolean;
  readonly manaCurrent: number;
  readonly manaMaximum: number;
  readonly placeholderExperienceCurrent: number;
  readonly placeholderExperienceMaximum: number;
  readonly abilities: readonly CombatAbilityHudReadModel[];
  readonly activeStatuses: readonly CombatStatusHudReadModel[];
}

export type ItemEquipmentSlot = "main-hand" | "chest" | "amulet";
export type ItemRarityHud = "common" | "magic" | "rare";
export type ItemLoadoutSlot = "lmb" | "q" | "e" | "f";

export interface ItemModifierHudReadModel {
  readonly id: string;
  readonly source: "base" | "affix";
  readonly label: string;
}

export interface EquipmentItemHudReadModel {
  readonly kind: "equipment";
  readonly instanceId: string;
  readonly displayName: string;
  readonly rarity: ItemRarityHud;
  readonly slot: ItemEquipmentSlot;
  readonly typeLabel: string;
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

export type ItemHudReadModel =
  EquipmentItemHudReadModel | AbilityStoneItemHudReadModel;

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
  readonly inventorySlots: readonly InventorySlotHudReadModel[];
  readonly equipmentSlots: readonly EquipmentSlotHudReadModel[];
  readonly abilityChoices: readonly AbilityChoiceHudReadModel[];
  readonly loadout: readonly LoadoutAssignmentHudReadModel[];
  readonly playerMaximumHealth: number;
  readonly outgoingAbilityDamagePercent: number;
}

export type ItemUiCommand =
  | {
      readonly type: "item.equip";
      readonly inventoryIndex: number;
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

export const ITEM_HUD_EVENT = "rarpg:item-hud";
export const ITEM_COMMAND_EVENT = "rarpg:item-command";

declare global {
  interface WindowEventMap {
    "rarpg:item-hud": CustomEvent<InventoryHudReadModel>;
    "rarpg:item-command": CustomEvent<ItemUiCommand>;
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

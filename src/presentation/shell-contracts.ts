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
  "ready" | "cooldown" | "insufficient-mana" | "defeated";

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

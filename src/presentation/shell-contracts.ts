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

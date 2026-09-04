import { render } from "preact";

import {
  applyCanvasViewport,
  measureCanvasViewport,
  observeCanvasViewport,
} from "./adapters/browser/canvas-viewport";
import { installKeyboardCapture } from "./adapters/browser/keyboard-capture";
import { preflightWebGL2 } from "./adapters/browser/webgl2";
import { bootPhaser } from "./adapters/phaser/boot";
import { createReadModelChannel } from "./adapters/ui/read-model-channel";
import { App } from "./presentation/App";
import type {
  CanvasViewportReadModel,
  ShellBindings,
  ShellIntent,
  ShellReadModel,
} from "./presentation/shell-contracts";
import "./presentation/styles.css";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (element === null) {
    throw new Error(
      `Required foundation mount point "${selector}" is missing.`,
    );
  }

  return element;
}

const emptyViewport: CanvasViewportReadModel = {
  cssWidth: 0,
  cssHeight: 0,
  backingWidth: 0,
  backingHeight: 0,
  devicePixelRatio: window.devicePixelRatio,
};

const channel = createReadModelChannel<ShellReadModel>({
  revision: 0,
  phase: {
    kind: "loading",
    message: "Checking WebGL2 support…",
  },
  viewport: emptyViewport,
  emittedIntentCount: 0,
  capturedKeyboardCount: 0,
  lastIntentType: null,
});

let model = channel.source.getSnapshot();

function publish(changes: Partial<ShellReadModel>): void {
  model = {
    ...model,
    ...changes,
    revision: model.revision + 1,
  };
  channel.publisher.publish(model);
}

const intentSink: ShellBindings["intents"] = {
  emit(intent: Readonly<ShellIntent>) {
    const isKeyboard = intent.type === "shell.canvas-keyboard-observed";
    publish({
      emittedIntentCount: model.emittedIntentCount + 1,
      capturedKeyboardCount: model.capturedKeyboardCount + (isKeyboard ? 1 : 0),
      lastIntentType: intent.type,
    });

    if (intent.type === "shell.renderer-retry-requested") {
      window.location.reload();
    }
  },
};

const bindings: ShellBindings = {
  models: channel.source,
  intents: intentSink,
};

const mount = requireElement<HTMLDivElement>("#app");
render(<App bindings={bindings} />, mount);

const host = requireElement<HTMLDivElement>("#game-host");
const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
const initialViewport = measureCanvasViewport(host, window.devicePixelRatio);
applyCanvasViewport(canvas, initialViewport);
publish({ viewport: initialViewport });
installKeyboardCapture(canvas, intentSink);

function fail(detail: string): void {
  document.body.dataset.appState = "unsupported";
  publish({
    phase: {
      kind: "error",
      heading: "WebGL2 is required.",
      detail,
      canRetry: true,
    },
  });
}

const support = preflightWebGL2(canvas);

if (!support.supported) {
  fail(support.reason);
} else {
  void bootPhaser(canvas, support.context)
    .then((renderer) => {
      observeCanvasViewport(host, (viewport) => {
        renderer.resize(viewport);
        publish({ viewport });
      });
      document.body.dataset.appState = "ready";
      publish({
        phase: { kind: "ready", rendererVersion: renderer.rendererVersion },
      });
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      fail(`Renderer startup failed: ${detail}`);
    });
}

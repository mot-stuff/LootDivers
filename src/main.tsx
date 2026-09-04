import { render } from "preact";

import { bootPhaser } from "./adapters/phaser/boot";
import { preflightWebGL2 } from "./adapters/browser/webgl2";
import type { ZoneLifecycleDiagnostics } from "./adapters/phaser/isometric-world";
import { App, type BootState } from "./presentation/App";
import "./presentation/styles.css";

declare global {
  interface Window {
    __RARPG_WORLD_TEST__?: {
      diagnostics: () => ZoneLifecycleDiagnostics;
      load: () => Promise<void>;
      unload: () => void;
    };
  }
}

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);

  if (element === null) {
    throw new Error(
      `Required foundation mount point "${selector}" is missing.`,
    );
  }

  return element;
}

const shell = requireElement<HTMLDivElement>("#app-shell");
const canvas = requireElement<HTMLCanvasElement>("#game-canvas");

function show(state: BootState): void {
  render(<App state={state} />, shell);
}

function fail(detail: string): void {
  canvas.hidden = true;
  document.body.dataset.appState = "unsupported";
  show({ kind: "unsupported", detail });
}

show({ kind: "checking" });

const support = preflightWebGL2(canvas);

if (!support.supported) {
  fail(support.reason);
} else {
  void bootPhaser(canvas, support.context)
    .then(({ rendererVersion, world }) => {
      const diagnostics = world.diagnostics();
      if (diagnostics.zoneId === null) {
        throw new Error("Technical zone reported ready without a zone ID.");
      }
      if (new URLSearchParams(window.location.search).has("automation")) {
        window.__RARPG_WORLD_TEST__ = {
          diagnostics: () => world.diagnostics(),
          load: () => world.load(),
          unload: () => {
            world.unload();
          },
        };
      }
      document.body.dataset.appState = "ready";
      show({ kind: "ready", rendererVersion, zoneId: diagnostics.zoneId });
    })
    .catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      fail(`Renderer startup failed: ${detail}`);
    });
}

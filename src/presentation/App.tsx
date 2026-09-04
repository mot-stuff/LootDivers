import { useLayoutEffect, useState } from "preact/hooks";

import { FOUNDATION_ID } from "../core";
import type { ShellBindings, ShellReadModel } from "./shell-contracts";

export interface AppProps {
  readonly bindings: ShellBindings;
}

export function App({ bindings }: AppProps) {
  const [model, setModel] = useState<ShellReadModel>(() =>
    bindings.models.getSnapshot(),
  );

  useLayoutEffect(
    () => bindings.models.subscribe((nextModel) => setModel(nextModel)),
    [bindings.models],
  );

  return (
    <main class="technical-shell">
      <a class="skip-link" href="#shell-controls">
        Skip canvas
      </a>
      <header class="diagnostic-shell">
        <div>
          <p class="eyebrow">RARPG technical foundation</p>
          <h1>UI and renderer diagnostics</h1>
        </div>
        <dl class="diagnostics" aria-label="Foundation diagnostics">
          <div>
            <dt>Core</dt>
            <dd>{FOUNDATION_ID}</dd>
          </div>
          <div>
            <dt>UI</dt>
            <dd>Preact 10.29.8</dd>
          </div>
          <div>
            <dt>Renderer</dt>
            <dd>
              {model.phase.kind === "ready"
                ? model.phase.rendererVersion
                : "WebGL2 required"}
            </dd>
          </div>
          <div>
            <dt>Viewport</dt>
            <dd data-testid="viewport-diagnostic">
              {model.viewport.cssWidth}×{model.viewport.cssHeight} CSS /{" "}
              {model.viewport.backingWidth}×{model.viewport.backingHeight} px /{" "}
              DPR {model.viewport.devicePixelRatio}
            </dd>
          </div>
          <div>
            <dt>Intents</dt>
            <dd data-testid="intent-count">{model.emittedIntentCount}</dd>
          </div>
          <div>
            <dt>Canvas keys</dt>
            <dd data-testid="keyboard-count">{model.capturedKeyboardCount}</dd>
          </div>
        </dl>
        {model.phase.kind === "ready" && (
          <section
            class="boot-status"
            role="status"
            aria-live="polite"
            data-testid="boot-status"
          >
            Foundation ready
          </section>
        )}
      </header>

      <section class="game-region" aria-label="Renderer diagnostic">
        <div id="game-host">
          <canvas
            id="game-canvas"
            width="960"
            height="540"
            tabIndex={0}
            aria-label="RARPG Phaser diagnostic canvas"
            aria-describedby="canvas-instructions"
          >
            Renderer diagnostic requires canvas and WebGL2 support.
          </canvas>
          {model.phase.kind !== "ready" && (
            <section
              class={
                model.phase.kind === "error"
                  ? "boot-overlay error"
                  : "boot-overlay"
              }
              role={model.phase.kind === "error" ? "alert" : "status"}
              aria-live={model.phase.kind === "error" ? "assertive" : "polite"}
              data-testid="boot-overlay"
            >
              {model.phase.kind === "loading" && (
                <>
                  <strong>Loading technical renderer</strong>
                  <span>{model.phase.message}</span>
                </>
              )}
              {model.phase.kind === "error" && (
                <>
                  <strong>{model.phase.heading}</strong>
                  <span>{model.phase.detail}</span>
                  <span>
                    Update to a current desktop Chrome, Edge, or Firefox, enable
                    hardware acceleration, update graphics drivers, then reload.
                    Canvas gameplay fallback is not supported.
                  </span>
                  {model.phase.canRetry && (
                    <button
                      type="button"
                      onClick={() =>
                        bindings.intents.emit({
                          type: "shell.renderer-retry-requested",
                        })
                      }
                    >
                      Retry renderer
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      </section>

      <section id="shell-controls" class="shell-controls" tabIndex={-1}>
        <p id="canvas-instructions">
          Focus the canvas before using keyboard input. Tab away to keep
          keyboard input in the interface.
        </p>
        <button
          type="button"
          onClick={() =>
            bindings.intents.emit({ type: "shell.diagnostic-requested" })
          }
        >
          Send diagnostic intent
        </button>
        <output>Last intent: {model.lastIntentType ?? "none"}</output>
      </section>
    </main>
  );
}

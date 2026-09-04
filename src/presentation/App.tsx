import { FOUNDATION_ID } from "../core";

export type BootState =
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly rendererVersion: string }
  | { readonly kind: "unsupported"; readonly detail: string };

export interface AppProps {
  readonly state: BootState;
}

export function App({ state }: AppProps) {
  const ready = state.kind === "ready";

  return (
    <header class="diagnostic-shell">
      <div>
        <p class="eyebrow">RARPG technical foundation</p>
        <h1>Browser boot diagnostics</h1>
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
          <dd>{ready ? state.rendererVersion : "WebGL2 required"}</dd>
        </div>
      </dl>
      <section
        class={
          state.kind === "unsupported" ? "boot-status error" : "boot-status"
        }
        role={state.kind === "unsupported" ? "alert" : "status"}
        data-testid="boot-status"
      >
        {state.kind === "checking" && "Checking WebGL2 support…"}
        {state.kind === "ready" && "Foundation ready"}
        {state.kind === "unsupported" && (
          <>
            <strong>WebGL2 is required.</strong> {state.detail} Update to a
            current desktop Chrome, Edge, or Firefox, enable hardware
            acceleration, update graphics drivers, then reload. Canvas gameplay
            fallback is not supported.
          </>
        )}
      </section>
    </header>
  );
}

import { useState } from "preact/hooks";

import { FOUNDATION_ID } from "../core";
import type {
  FixtureSaveState,
  PersistenceStatus,
  SaveLoadResult,
} from "../persistence";

export type BootState =
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly rendererVersion: string }
  | { readonly kind: "unsupported"; readonly detail: string };

export interface AppProps {
  readonly state: BootState;
  readonly persistenceStatus: PersistenceStatus;
  readonly persistenceActions: PersistenceFixtureActions;
}

export interface PersistenceFixtureActions {
  save(state: FixtureSaveState): Promise<void>;
  load(): Promise<SaveLoadResult>;
  exportJson(): Promise<string>;
  importJson(serializedEnvelope: string): Promise<void>;
}

export function App({
  state,
  persistenceStatus,
  persistenceActions,
}: AppProps) {
  const ready = state.kind === "ready";
  const [counter, setCounter] = useState(1);
  const [serialized, setSerialized] = useState("");

  const fixtureState = (): FixtureSaveState => ({
    label: "Phase 0 synthetic fixture",
    counter,
    markers: [
      { id: "fixture:alpha", value: counter * 2 },
      { id: "fixture:beta", value: counter * 3 },
    ],
  });

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
      <section class="persistence-fixture" aria-labelledby="persistence-title">
        <div>
          <p class="eyebrow">Synthetic state only</p>
          <h2 id="persistence-title">Persistence diagnostics</h2>
        </div>
        <label>
          Fixture counter
          <input
            data-testid="fixture-counter"
            type="number"
            min="0"
            step="1"
            value={counter}
            onInput={(event) => {
              const next = Number(event.currentTarget.value);
              setCounter(Number.isSafeInteger(next) && next >= 0 ? next : 0);
            }}
          />
        </label>
        <div class="persistence-actions">
          <button
            type="button"
            onClick={() => {
              void persistenceActions
                .save(fixtureState())
                .catch(() => undefined);
            }}
          >
            Save fixture
          </button>
          <button
            type="button"
            onClick={() => {
              void persistenceActions
                .load()
                .then((result) => {
                  setCounter(result.state.counter);
                })
                .catch(() => undefined);
            }}
          >
            Load fixture
          </button>
          <button
            type="button"
            onClick={() => {
              void persistenceActions
                .exportJson()
                .then(setSerialized)
                .catch(() => undefined);
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => {
              void persistenceActions
                .importJson(serialized)
                .catch(() => undefined);
            }}
          >
            Import JSON
          </button>
        </div>
        <label>
          Validated export or import
          <textarea
            data-testid="persistence-json"
            rows={5}
            value={serialized}
            onInput={(event) => {
              setSerialized(event.currentTarget.value);
            }}
          />
        </label>
        <p
          class={`persistence-status ${persistenceStatus.kind}`}
          role={persistenceStatus.kind === "error" ? "alert" : "status"}
          data-testid="persistence-status"
          data-status-kind={persistenceStatus.kind}
          data-error-code={
            persistenceStatus.kind === "error"
              ? persistenceStatus.code
              : undefined
          }
        >
          {persistenceStatus.message}
        </p>
      </section>
    </header>
  );
}

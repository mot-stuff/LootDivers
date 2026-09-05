import { useEffect, useLayoutEffect, useState } from "preact/hooks";

import { FOUNDATION_ID } from "../core";
import type {
  FixtureSaveState,
  PersistenceStatus,
  SaveLoadResult,
} from "../persistence";
import type {
  CombatHudReadModel,
  ShellBindings,
  ShellReadModel,
} from "./shell-contracts";

export interface PersistenceFixtureActions {
  save(state: FixtureSaveState): Promise<void>;
  load(): Promise<SaveLoadResult>;
  exportJson(): Promise<string>;
  importJson(serializedEnvelope: string): Promise<void>;
}

export interface AppProps {
  readonly bindings: ShellBindings;
  readonly persistenceStatus?: PersistenceStatus;
  readonly persistenceActions?: PersistenceFixtureActions;
  readonly showPersistence?: boolean;
  readonly showCombatPrototype?: boolean;
}

interface CombatVitalsProps {
  readonly model: CombatHudReadModel;
}

function CombatVitals({ model }: CombatVitalsProps) {
  const healthPercent =
    model.playerMaxHealth > 0
      ? Math.max(
          0,
          Math.min(100, (model.playerHealth / model.playerMaxHealth) * 100),
        )
      : 0;
  const manaPercent =
    model.placeholderManaMaximum > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (model.placeholderManaCurrent / model.placeholderManaMaximum) * 100,
          ),
        )
      : 0;
  const experiencePercent =
    model.placeholderExperienceMaximum > 0
      ? Math.max(
          0,
          Math.min(
            100,
            (model.placeholderExperienceCurrent /
              model.placeholderExperienceMaximum) *
              100,
          ),
        )
      : 0;

  return (
    <section
      class="combat-vitals-hud"
      aria-label="Player vitals"
      data-testid="combat-vitals-hud"
    >
      <div
        class="combat-vitals-row"
        data-state={model.playerDead ? "dead" : "alive"}
      >
        <span class="combat-vitals-label">HP</span>
        <div
          class="combat-vitals-meter combat-health-meter"
          role="progressbar"
          aria-label="Player health"
          aria-valuemin={0}
          aria-valuemax={model.playerMaxHealth}
          aria-valuenow={model.playerHealth}
          aria-valuetext={`${model.playerHealth} of ${model.playerMaxHealth} health${model.playerDead ? ", defeated" : ""}`}
        >
          <span style={{ width: `${healthPercent}%` }} />
        </div>
      </div>
      <div class="combat-vitals-row">
        <span class="combat-vitals-label">MP</span>
        <div
          class="combat-vitals-meter combat-mana-meter"
          role="progressbar"
          aria-label="Reserved mana placeholder"
          aria-valuemin={0}
          aria-valuemax={model.placeholderManaMaximum}
          aria-valuenow={model.placeholderManaCurrent}
          aria-valuetext={`${model.placeholderManaCurrent} of ${model.placeholderManaMaximum} reserved mana placeholder`}
        >
          <span style={{ width: `${manaPercent}%` }} />
        </div>
      </div>
      <div class="combat-vitals-row">
        <span class="combat-vitals-label">XP</span>
        <div
          class="combat-vitals-meter combat-experience-meter"
          role="progressbar"
          aria-label="Reserved experience placeholder"
          aria-valuemin={0}
          aria-valuemax={model.placeholderExperienceMaximum}
          aria-valuenow={model.placeholderExperienceCurrent}
          aria-valuetext={`${model.placeholderExperienceCurrent} of ${model.placeholderExperienceMaximum} reserved experience placeholder`}
        >
          <span style={{ width: `${experiencePercent}%` }} />
        </div>
      </div>
    </section>
  );
}

export function App({
  bindings,
  persistenceStatus,
  persistenceActions,
  showPersistence,
  showCombatPrototype,
}: AppProps) {
  const [model, setModel] = useState<ShellReadModel>(() =>
    bindings.models.getSnapshot(),
  );
  const [counter, setCounter] = useState(1);
  const [serialized, setSerialized] = useState("");
  const [combatHud, setCombatHud] = useState<CombatHudReadModel>({
    paused: true,
    playerHealth: 100,
    playerMaxHealth: 100,
    playerDead: false,
    placeholderManaCurrent: 100,
    placeholderManaMaximum: 100,
    placeholderExperienceCurrent: 0,
    placeholderExperienceMaximum: 100,
  });

  useLayoutEffect(
    () => bindings.models.subscribe((nextModel) => setModel(nextModel)),
    [bindings.models],
  );
  useEffect(() => {
    if (!showCombatPrototype) {
      return;
    }
    const updateHud = (event: Event) => {
      setCombatHud((event as CustomEvent<CombatHudReadModel>).detail);
    };
    window.addEventListener("rarpg:combat-hud", updateHud);
    return () => window.removeEventListener("rarpg:combat-hud", updateHud);
  }, [showCombatPrototype]);

  const fixtureState = (): FixtureSaveState => ({
    label: "Phase 0 synthetic fixture",
    counter,
    markers: [
      { id: "fixture:alpha", value: counter * 2 },
      { id: "fixture:beta", value: counter * 3 },
    ],
  });

  return (
    <main
      class={
        showCombatPrototype ? "technical-shell combat-shell" : "technical-shell"
      }
    >
      <a class="skip-link" href="#shell-controls">
        Skip canvas
      </a>
      <header class="diagnostic-shell">
        <div>
          <p class="eyebrow">
            {showCombatPrototype
              ? "RARPG Phase 1 playable prototype"
              : "RARPG technical foundation"}
          </p>
          <h1>
            {showCombatPrototype
              ? "Combat movement arena"
              : "UI and renderer diagnostics"}
          </h1>
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
            <dt>Zone</dt>
            <dd>
              {model.phase.kind === "ready"
                ? (model.phase.zoneId ?? "Loading on demand")
                : "Loading on demand"}
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
            Technical isometric fixture ready
          </section>
        )}
      </header>
      {model.phase.kind === "ready" && (
        <span class="visually-hidden">Foundation ready</span>
      )}

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

      {showCombatPrototype && <CombatVitals model={combatHud} />}

      {showCombatPrototype && combatHud.paused && (
        <section class="combat-paused-hud" role="status">
          <strong>PAUSED</strong>
          <span>Click the arena to resume</span>
        </section>
      )}

      <section id="shell-controls" class="shell-controls" tabIndex={-1}>
        <p id="canvas-instructions">
          {showCombatPrototype
            ? "Click the arena, then use WASD to move, the mouse to aim, Space to dodge, and R to reset. Input pauses when interface controls have focus."
            : "Focus the canvas before using keyboard input. Tab away to keep keyboard input in the interface."}
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

      {showPersistence &&
        persistenceStatus !== undefined &&
        persistenceActions !== undefined && (
          <section
            class="persistence-fixture"
            aria-labelledby="persistence-title"
          >
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
                  setCounter(
                    Number.isSafeInteger(next) && next >= 0 ? next : 0,
                  );
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
        )}
    </main>
  );
}

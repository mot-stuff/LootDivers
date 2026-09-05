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
    model.manaMaximum > 0
      ? Math.max(
          0,
          Math.min(100, (model.manaCurrent / model.manaMaximum) * 100),
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
          aria-label="Player mana"
          aria-valuemin={0}
          aria-valuemax={model.manaMaximum}
          aria-valuenow={model.manaCurrent}
          aria-valuetext={`${model.manaCurrent} of ${model.manaMaximum} mana`}
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

function formatSeconds(seconds: number): string {
  return `${Math.ceil(seconds * 10) / 10}s`;
}

function CombatActionBar({ model }: CombatVitalsProps) {
  return (
    <section
      class="combat-action-hud"
      aria-label="Combat abilities"
      data-testid="combat-action-hud"
    >
      <ol class="combat-ability-list">
        {model.abilities.map((ability) => {
          const cooldownPercent =
            ability.cooldownMaximumSeconds > 0
              ? Math.min(
                  100,
                  (ability.cooldownRemainingSeconds /
                    ability.cooldownMaximumSeconds) *
                    100,
                )
              : 0;
          const stateText =
            ability.state === "cooldown"
              ? `Cooldown ${formatSeconds(ability.cooldownRemainingSeconds)}`
              : ability.state === "insufficient-mana"
                ? `Need ${ability.manaCost} mana`
                : ability.state === "defeated"
                  ? "Defeated"
                  : "Ready";
          const costText =
            ability.manaCost > 0 ? `${ability.manaCost} mana` : "Free";
          const cooldownText =
            ability.cooldownMaximumSeconds > 0
              ? `${formatSeconds(ability.cooldownMaximumSeconds)} cooldown`
              : "No cooldown";

          return (
            <li
              key={ability.id}
              class="combat-ability"
              data-ability-id={ability.id}
              data-state={ability.state}
              aria-label={`${ability.accessibleKeyLabel}, ${ability.name}, ${costText}, ${cooldownText}, ${stateText}`}
            >
              <span
                class="combat-ability-cooldown"
                style={{ height: `${cooldownPercent}%` }}
                aria-hidden="true"
              />
              <div class="combat-ability-heading">
                <kbd>{ability.keyLabel}</kbd>
                <strong>{ability.name}</strong>
              </div>
              <span class="combat-ability-details">
                {costText} · {cooldownText}
              </span>
              <span class="combat-ability-state">{stateText}</span>
            </li>
          );
        })}
      </ol>
      {model.activeStatuses.length > 0 && (
        <div class="combat-statuses" aria-label="Active combat effects">
          {model.activeStatuses.map((status) => (
            <span
              key={status.id}
              class="combat-status"
              data-status-id={status.id}
            >
              {status.target === "enemy" ? "Enemy " : ""}
              {status.label} {formatSeconds(status.remainingSeconds)}
            </span>
          ))}
        </div>
      )}
      <p class="combat-controls-summary">
        Move <kbd>WASD</kbd> · Aim mouse · Dodge <kbd>Space</kbd> · Reset{" "}
        <kbd>R</kbd>
      </p>
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
    manaCurrent: 100,
    manaMaximum: 100,
    placeholderExperienceCurrent: 0,
    placeholderExperienceMaximum: 100,
    abilities: [
      {
        id: "ability:basic-cleave",
        keyLabel: "LMB",
        accessibleKeyLabel: "Left click",
        name: "Basic Cleave",
        manaCost: 0,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 0,
        state: "ready",
      },
      {
        id: "ability:cinder-dart",
        keyLabel: "Q",
        accessibleKeyLabel: "Q",
        name: "Cinder Dart",
        manaCost: 15,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 0.5,
        state: "ready",
      },
      {
        id: "ability:winter-pulse",
        keyLabel: "E",
        accessibleKeyLabel: "E",
        name: "Winter Pulse",
        manaCost: 25,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 2.5,
        state: "ready",
      },
      {
        id: "ability:defiant-signal",
        keyLabel: "F",
        accessibleKeyLabel: "F",
        name: "Defiant Signal",
        manaCost: 20,
        cooldownRemainingSeconds: 0,
        cooldownMaximumSeconds: 5,
        state: "ready",
      },
    ],
    activeStatuses: [],
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
              ? "RARPG Phase 2 playable prototype"
              : "RARPG technical foundation"}
          </p>
          <h1>
            {showCombatPrototype
              ? "Ability combat arena"
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
          <div class="combat-essential-diagnostic">
            <dt>Renderer</dt>
            <dd>
              {model.phase.kind === "ready"
                ? model.phase.rendererVersion
                : "WebGL2 required"}
            </dd>
          </div>
          <div class="combat-essential-diagnostic">
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
      {showCombatPrototype && <CombatActionBar model={combatHud} />}

      {showCombatPrototype && combatHud.paused && (
        <section class="combat-paused-hud" role="status">
          <strong>PAUSED</strong>
          <span>Click the arena to resume</span>
        </section>
      )}

      <section id="shell-controls" class="shell-controls" tabIndex={-1}>
        <p id="canvas-instructions">
          {showCombatPrototype
            ? "Click the arena to play. Use left-click for Basic Cleave; Q for Cinder Dart; E for Winter Pulse; F for Defiant Signal. Input pauses when interface controls have focus."
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

import { render } from "preact";

import {
  applyCanvasViewport,
  measureCanvasViewport,
  observeCanvasViewport,
} from "./adapters/browser/canvas-viewport";
import {
  IndexedDbSaveRepository,
  PersistenceFaultInjector,
  type PersistenceFault,
} from "./adapters/browser/indexeddb-save-repository";
import { installKeyboardCapture } from "./adapters/browser/keyboard-capture";
import {
  SystemSaveClock,
  WebCryptoSha256,
} from "./adapters/browser/persistence-platform";
import { preflightWebGL2 } from "./adapters/browser/webgl2";
import { bootPhaser, fixtureFailureDiagnostics } from "./adapters/phaser/boot";
import type { ZoneLifecycleDiagnostics } from "./adapters/phaser/isometric-world";
import type { CombatPresentationDiagnostics } from "./adapters/phaser/combat-arena-presentation";
import type { DamageResult, LoadoutSlot } from "./core";
import type {
  FrameSampleSummary,
  RawFrameSamples,
  SyntheticPresentationDiagnostics,
} from "./adapters/phaser/synthetic-lifecycle-presentation";
import { createReadModelChannel } from "./adapters/ui/read-model-channel";
import {
  CHARACTER_SAVE_CODEC,
  CharacterSaveService,
  FIXTURE_SAVE_CODEC,
  PersistenceFixtureService,
  type CharacterSaveEnvelope,
  type FixtureSaveState,
  type PersistenceStatus,
} from "./persistence";
import type { CharacterSave } from "./core";
import {
  App,
  type MainMenuCharacterSaveModel,
  type PersistenceFixtureActions,
} from "./presentation/App";
import type {
  CanvasViewportReadModel,
  CharacterHudReadModel,
  CombatHudReadModel,
  InventoryHudReadModel,
  ItemUiCommand,
  ProfessionUiCommand,
  ProgressionUiCommand,
  WorldUiCommand,
  ShellBindings,
  ShellIntent,
  ShellReadModel,
} from "./presentation/shell-contracts";
import "./presentation/styles.css";

declare global {
  const __RARPG_BUILD_COMMIT__: string;
  const __RARPG_BUILD_DIRTY__: boolean;

  interface Window {
    __RARPG_WORLD_TEST__?: {
      diagnostics: () => ZoneLifecycleDiagnostics;
      load: (url?: string) => Promise<void>;
      pick: (screenX: number, screenY: number) => void;
      unload: () => void;
    };
    __RARPG_FIXTURE_TEST__?: {
      readonly buildCommit: string;
      readonly buildDirty: boolean;
      diagnostics: () => SyntheticPresentationDiagnostics | null;
      beginSample: () => void;
      endSample: () => FrameSampleSummary;
      dispose: () => void;
      reset: () => Promise<void>;
      resetAtStep: (steps: number) => Promise<void>;
      rawSamples: () => RawFrameSamples;
      cycleActor: (actor: number) => {
        readonly destroyed: number;
        readonly created: number;
      };
      setCullingProbe: (enabled: boolean) => void;
    };
    __RARPG_FIXTURE_FAILURE__?: SyntheticPresentationDiagnostics | null;
    __RARPG_COMBAT_TEST__?: {
      diagnostics: () => CombatPresentationDiagnostics | null;
      reset: () => void;
      setAimDirection: (x: number, y: number) => void;
      setAutomationPaused: (paused: boolean) => void;
      requestDodge: () => void;
      requestInteract: () => void;
      travelTo: (zoneId: string) => void;
      requestPrimaryAttack: () => void;
      setMovement: (x: number, y: number) => void;
      requestAbilitySlot: (slot: LoadoutSlot, x?: number, y?: number) => void;
      requestCinderDart: () => void;
      requestWinterPulse: (x: number, y: number) => void;
      requestDefiantSignal: () => void;
      advancePaused: (steps: number) => void;
      itemHud: () => InventoryHudReadModel | null;
      characterHud: () => CharacterHudReadModel | null;
      executeItemCommand: (command: ItemUiCommand) => void;
      executeProgressionCommand: (command: ProgressionUiCommand) => void;
      executeProfessionCommand: (command: ProfessionUiCommand) => void;
      executeWorldCommand: (command: WorldUiCommand) => void;
      applyPlayerDamage: (amount: number) => DamageResult;
    };
    __RARPG_CHARACTER_SAVE_TEST__?: {
      saveNow: () => Promise<void>;
      corruptActive: () => Promise<void>;
      generationState: () => ReturnType<
        IndexedDbSaveRepository["debugGenerationState"]
      >;
      /**
       * Reads back the committed, checksum-verified active save (null when
       * none decodes). E2e specs poll this before reloading so an
       * in-flight queued save can never race the navigation.
       */
      activeSave: () => Promise<{
        zoneId: string;
        revision: number;
        source: "active" | "backup";
      } | null>;
      reset: () => Promise<void>;
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

const fixtureParameters = new URLSearchParams(window.location.search);
const worldAutomation = fixtureParameters.has("automation");
const fullFixture = fixtureParameters.has("fullFixture");
const persistenceAutomation = fixtureParameters.has("persistenceTest");
const combatPrototype =
  !worldAutomation && !fullFixture && !persistenceAutomation;
/**
 * TASK-703 automation bypass: `?autostart` skips the main menu and boots
 * straight into the pre-menu gameplay behavior (canvas focused, Hearthmere
 * session live). Real players load without query parameters and always see
 * the menu.
 */
const autostart = fixtureParameters.has("autostart");
const showMainMenu = combatPrototype && !autostart;
document.body.classList.toggle("combat-mode", combatPrototype);
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
let persistenceStatus: PersistenceStatus = {
  kind: "idle",
  message:
    "No operation yet. Local browser saves are best-effort and user-tamperable.",
};

const faultInjector = new PersistenceFaultInjector();
const repository = new IndexedDbSaveRepository({
  databaseName: "rarpg-phase0-persistence-v1",
  saveId: "fixture:phase-0",
  build: "phase0-technical-fixture",
  contentSchemaVersion: 1,
  checksumProvider: new WebCryptoSha256(),
  clock: new SystemSaveClock(),
  codec: FIXTURE_SAVE_CODEC,
  faultInjector,
});

/**
 * TASK-705 character save slot (DEC-034): its own IndexedDB database so the
 * Phase 0 fixture envelope and the character envelope never share
 * generations, wired through the same DEC-014 repository machinery.
 */
const characterRepository = new IndexedDbSaveRepository<
  CharacterSave,
  CharacterSaveEnvelope
>({
  databaseName: "rarpg-character-save-v1",
  saveId: "character:slot-1",
  build: "loot-divers-client",
  contentSchemaVersion: 1,
  checksumProvider: new WebCryptoSha256(),
  clock: new SystemSaveClock(),
  codec: CHARACTER_SAVE_CODEC,
});
const characterSaves = new CharacterSaveService(characterRepository);
let characterSaveMenu: MainMenuCharacterSaveModel = {
  available: false,
  recovered: false,
};
let continueSavedCharacter: (() => boolean) | null = null;
/**
 * Save triggers stay disarmed until the player actually enters gameplay
 * (New Game, Continue, or `?autostart`), so an untouched main menu can
 * never overwrite an existing save on tab close.
 */
let gameplayStarted = false;
const service = new PersistenceFixtureService(repository, {
  publish(status) {
    persistenceStatus = status;
    renderApp();
  },
});
const persistenceActions: PersistenceFixtureActions = {
  async save(state) {
    await service.save(state);
  },
  load: () => service.load(),
  exportJson: () => service.exportJson(),
  async importJson(serializedEnvelope) {
    await service.importJson(serializedEnvelope);
  },
};

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

function renderApp(): void {
  render(
    <App
      bindings={bindings}
      persistenceStatus={persistenceStatus}
      persistenceActions={persistenceActions}
      showPersistence={!worldAutomation || persistenceAutomation}
      showCombatPrototype={combatPrototype}
      showMainMenu={showMainMenu}
      characterSave={characterSaveMenu}
      onContinue={() => continueSavedCharacter?.() ?? false}
      onGameplayStarted={() => {
        gameplayStarted = true;
      }}
    />,
    mount,
  );
}

renderApp();

const host = requireElement<HTMLDivElement>("#game-host");
const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
const skipLink = requireElement<HTMLAnchorElement>(".skip-link");
const initialViewport = measureCanvasViewport(host, window.devicePixelRatio);
applyCanvasViewport(canvas, initialViewport);
publish({ viewport: initialViewport });
installKeyboardCapture(canvas, intentSink, skipLink);

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
  void bootPhaser(canvas, support.context, { fullFixture, combatPrototype })
    .then((renderer) => {
      const diagnostics = renderer.world.diagnostics();
      if (diagnostics.zoneId === null) {
        throw new Error("Technical zone reported ready without a zone ID.");
      }
      observeCanvasViewport(host, (viewport) => {
        renderer.resize(viewport);
        publish({ viewport });
      });
      if (worldAutomation) {
        window.__RARPG_WORLD_TEST__ = {
          diagnostics: () => renderer.world.diagnostics(),
          load: (url) => renderer.world.load(url),
          pick: (screenX, screenY) => {
            renderer.world.pick(screenX, screenY);
          },
          unload: () => {
            renderer.world.unload();
          },
        };
      }
      if (fullFixture) {
        window.__RARPG_FIXTURE_TEST__ = {
          buildCommit: __RARPG_BUILD_COMMIT__,
          buildDirty: __RARPG_BUILD_DIRTY__,
          diagnostics: () => renderer.fixture.diagnostics(),
          beginSample: () => {
            renderer.fixture.beginSample();
          },
          endSample: () => renderer.fixture.endSample(),
          dispose: () => {
            renderer.fixture.dispose();
          },
          reset: () => renderer.fixture.reset(),
          resetAtStep: (steps) => renderer.fixture.resetAtStep(steps),
          rawSamples: () => renderer.fixture.rawSamples(),
          cycleActor: (actor) => renderer.fixture.cycleActor(actor),
          setCullingProbe: (enabled) => {
            renderer.fixture.setCullingProbe(enabled);
          },
        };
      }
      if (combatPrototype) {
        window.__RARPG_COMBAT_TEST__ = {
          diagnostics: () => renderer.combat.diagnostics(),
          reset: () => {
            renderer.combat.reset();
          },
          setAimDirection: (x, y) => {
            renderer.combat.setAimDirection(x, y);
          },
          setAutomationPaused: (paused) => {
            renderer.combat.setAutomationPaused(paused);
          },
          requestDodge: () => {
            renderer.combat.requestDodge();
          },
          requestInteract: () => {
            renderer.combat.requestInteract();
          },
          travelTo: (zoneId) => {
            renderer.combat.travelTo(zoneId);
          },
          requestPrimaryAttack: () => {
            renderer.combat.requestPrimaryAttack();
          },
          setMovement: (x, y) => {
            renderer.combat.setMovement(x, y);
          },
          requestAbilitySlot: (slot, x, y) => {
            renderer.combat.requestAbilitySlot(slot, x, y);
          },
          requestCinderDart: () => {
            renderer.combat.requestCinderDart();
          },
          requestWinterPulse: (x, y) => {
            renderer.combat.requestWinterPulse(x, y);
          },
          requestDefiantSignal: () => {
            renderer.combat.requestDefiantSignal();
          },
          advancePaused: (steps) => {
            renderer.combat.advancePaused(steps);
          },
          itemHud: () => renderer.combat.itemHud(),
          characterHud: () => renderer.combat.characterHud(),
          executeItemCommand: (command) => {
            renderer.combat.executeItemCommand(command);
          },
          executeProgressionCommand: (command) => {
            renderer.combat.executeProgressionCommand(command);
          },
          executeProfessionCommand: (command) => {
            renderer.combat.executeProfessionCommand(command);
          },
          executeWorldCommand: (command) => {
            renderer.combat.executeWorldCommand(command);
          },
          applyPlayerDamage: (amount) =>
            renderer.combat.applyPlayerDamage(amount),
        };
        // While the main menu is up the canvas stays unfocused so the
        // simulation remains paused; New Game focuses it after travel.
        if (!showMainMenu) {
          canvas.focus({ preventScroll: true });
        }
        // `?autostart` skips the menu entirely, so gameplay is live now.
        if (!showMainMenu) {
          gameplayStarted = true;
        }

        // TASK-705 save triggers (DEC-034): persist on zone travel and on
        // page hide. Failures degrade to console warnings — local saves are
        // best-effort by design (DEC-014). Trigger-based saves chain onto a
        // FIFO queue so rapid triggers (e.g. two quick zone changes) can
        // never land out of order and leave a stale save as the active
        // generation; the snapshot is captured when its turn arrives, so a
        // queued save always writes the freshest state.
        let pendingCharacterSave: Promise<void> = Promise.resolve();
        const persistCharacter = (): Promise<void> => {
          pendingCharacterSave = pendingCharacterSave
            .catch(() => undefined)
            .then(() =>
              characterSaves.save(renderer.combat.captureCharacterSave()),
            );
          return pendingCharacterSave;
        };
        const persistCharacterQuietly = (): void => {
          persistCharacter().catch((error: unknown) => {
            const detail =
              error instanceof Error ? error.message : String(error);
            console.warn(`Character save failed: ${detail}`);
          });
        };
        // The simulation always boots into Hearthmere, so that is the
        // baseline; the first hud snapshot with a different zone marks a
        // completed travel (including New Game's move to Wakeshore Landing).
        let lastObservedZoneId: string | null =
          renderer.combat.diagnostics()?.zoneId ?? null;
        window.addEventListener("rarpg:combat-hud", (event) => {
          const hud = (event as CustomEvent<CombatHudReadModel>).detail;
          if (lastObservedZoneId === null) {
            lastObservedZoneId = hud.zoneId;
            return;
          }
          if (hud.zoneId === lastObservedZoneId) return;
          lastObservedZoneId = hud.zoneId;
          if (!gameplayStarted) return;
          persistCharacterQuietly();
        });
        const persistOnHide = (): void => {
          // Never persist a dead character or an unstarted menu session.
          if (!gameplayStarted) return;
          if (renderer.combat.diagnostics()?.playerDead !== false) return;
          persistCharacterQuietly();
        };
        window.addEventListener("pagehide", persistOnHide);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") persistOnHide();
        });

        // Boot-time load resolves the Continue button (DEC-031 deferral):
        // corrupted or missing saves leave the button disabled, recovered
        // backups surface a notice in the menu.
        void characterSaves.loadForBoot().then((boot) => {
          if (boot.failure !== null) {
            console.warn(`Character save unavailable: ${boot.failure}`);
          }
          const save = boot.save;
          if (save === null) return;
          characterSaveMenu = { available: true, recovered: boot.recovered };
          continueSavedCharacter = () => {
            try {
              renderer.combat.restoreCharacterSave(save);
              return true;
            } catch (error) {
              const detail =
                error instanceof Error ? error.message : String(error);
              console.warn(`Saved character could not be restored: ${detail}`);
              characterSaveMenu = { available: false, recovered: false };
              renderApp();
              return false;
            }
          };
          renderApp();
        });

        window.__RARPG_CHARACTER_SAVE_TEST__ = {
          saveNow: () => persistCharacter(),
          corruptActive: () =>
            characterRepository.debugCorruptActiveGeneration(),
          generationState: () => characterRepository.debugGenerationState(),
          activeSave: async () => {
            try {
              const loaded = await characterRepository.load();
              return {
                zoneId: loaded.state.zoneId,
                revision: loaded.envelope.revision,
                source: loaded.source,
              };
            } catch {
              return null;
            }
          },
          reset: () => characterRepository.debugReset(),
        };
      }
      document.body.dataset.appState = "ready";
      publish({
        phase: {
          kind: "ready",
          rendererVersion: renderer.rendererVersion,
          zoneId: diagnostics.zoneId,
        },
      });
    })
    .catch((error: unknown) => {
      window.__RARPG_FIXTURE_FAILURE__ = fixtureFailureDiagnostics();
      const detail = error instanceof Error ? error.message : String(error);
      fail(`Renderer startup failed: ${detail}`);
    });
}

interface PersistenceTestApi {
  reset(): Promise<void>;
  armFault(fault: PersistenceFault): void;
  corruptActive(): Promise<void>;
  prepareBlockedUpgrade(): Promise<void>;
  releaseBlockedUpgrade(): void;
  generationState(): ReturnType<
    IndexedDbSaveRepository["debugGenerationState"]
  >;
  save(state: FixtureSaveState): ReturnType<PersistenceFixtureService["save"]>;
  load(): ReturnType<PersistenceFixtureService["load"]>;
  exportJson(): Promise<string>;
  importJson(
    serializedEnvelope: string,
  ): ReturnType<PersistenceFixtureService["importJson"]>;
}

declare global {
  interface Window {
    __RARPG_PERSISTENCE_TEST__?: PersistenceTestApi;
  }
}

if (persistenceAutomation) {
  window.__RARPG_PERSISTENCE_TEST__ = {
    async reset() {
      await repository.debugReset();
      persistenceStatus = {
        kind: "idle",
        message: "Synthetic persistence fixture reset.",
      };
      renderApp();
    },
    armFault(fault) {
      faultInjector.arm(fault);
    },
    corruptActive: () => repository.debugCorruptActiveGeneration(),
    prepareBlockedUpgrade: () => repository.debugPrepareBlockedUpgrade(),
    releaseBlockedUpgrade: () => repository.debugReleaseBlockedUpgrade(),
    generationState: () => repository.debugGenerationState(),
    save: (state) => service.save(state),
    load: () => service.load(),
    exportJson: () => service.exportJson(),
    importJson: (serializedEnvelope) => service.importJson(serializedEnvelope),
  };
}

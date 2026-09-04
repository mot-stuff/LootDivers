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
import { bootPhaser } from "./adapters/phaser/boot";
import type { ZoneLifecycleDiagnostics } from "./adapters/phaser/isometric-world";
import { createReadModelChannel } from "./adapters/ui/read-model-channel";
import {
  PersistenceFixtureService,
  type FixtureSaveState,
  type PersistenceStatus,
} from "./persistence";
import { App, type PersistenceFixtureActions } from "./presentation/App";
import type {
  CanvasViewportReadModel,
  ShellBindings,
  ShellIntent,
  ShellReadModel,
} from "./presentation/shell-contracts";
import "./presentation/styles.css";

declare global {
  interface Window {
    __RARPG_WORLD_TEST__?: {
      diagnostics: () => ZoneLifecycleDiagnostics;
      load: (url?: string) => Promise<void>;
      pick: (screenX: number, screenY: number) => void;
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

const fixtureParameters = new URLSearchParams(window.location.search);
const worldAutomation = fixtureParameters.has("automation");
const persistenceAutomation = fixtureParameters.has("persistenceTest");
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
  faultInjector,
});
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
  void bootPhaser(canvas, support.context)
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

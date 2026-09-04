import { render } from "preact";

import {
  IndexedDbSaveRepository,
  PersistenceFaultInjector,
  type PersistenceFault,
} from "./adapters/browser/indexeddb-save-repository";
import {
  SystemSaveClock,
  WebCryptoSha256,
} from "./adapters/browser/persistence-platform";
import { bootPhaser } from "./adapters/phaser/boot";
import { preflightWebGL2 } from "./adapters/browser/webgl2";
import {
  PersistenceFixtureService,
  type FixtureSaveState,
  type PersistenceStatus,
} from "./persistence";
import {
  App,
  type BootState,
  type PersistenceFixtureActions,
} from "./presentation/App";
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

const shell = requireElement<HTMLDivElement>("#app-shell");
const canvas = requireElement<HTMLCanvasElement>("#game-canvas");
let bootState: BootState = { kind: "checking" };
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
    show();
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

function show(): void {
  render(
    <App
      state={bootState}
      persistenceStatus={persistenceStatus}
      persistenceActions={persistenceActions}
    />,
    shell,
  );
}

function fail(detail: string): void {
  canvas.hidden = true;
  document.body.dataset.appState = "unsupported";
  bootState = { kind: "unsupported", detail };
  show();
}

show();

const support = preflightWebGL2(canvas);

if (!support.supported) {
  fail(support.reason);
} else {
  void bootPhaser(canvas, support.context)
    .then(({ rendererVersion }) => {
      document.body.dataset.appState = "ready";
      bootState = { kind: "ready", rendererVersion };
      show();
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
  save(state: FixtureSaveState): Promise<void>;
  load(): ReturnType<PersistenceFixtureService["load"]>;
  exportJson(): Promise<string>;
  importJson(serializedEnvelope: string): Promise<void>;
}

declare global {
  interface Window {
    __RARPG_PERSISTENCE_TEST__?: PersistenceTestApi;
  }
}

if (new URLSearchParams(location.search).has("persistenceTest")) {
  window.__RARPG_PERSISTENCE_TEST__ = {
    async reset() {
      await repository.debugReset();
      persistenceStatus = {
        kind: "idle",
        message: "Synthetic persistence fixture reset.",
      };
      show();
    },
    armFault(fault) {
      faultInjector.arm(fault);
    },
    corruptActive: () => repository.debugCorruptActiveGeneration(),
    prepareBlockedUpgrade: () => repository.debugPrepareBlockedUpgrade(),
    releaseBlockedUpgrade: () => repository.debugReleaseBlockedUpgrade(),
    async save(state) {
      await service.save(state);
    },
    load: () => service.load(),
    exportJson: () => service.exportJson(),
    async importJson(serializedEnvelope) {
      await service.importJson(serializedEnvelope);
    },
  };
}

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
import { ApiClient, ApiError } from "./adapters/http/api-client";
import { HttpSaveRepository } from "./adapters/http/http-save-repository";
import {
  isLocalDevHostname,
  probeAuthSession,
} from "./adapters/http/session-probe";
import { preflightWebGL2 } from "./adapters/browser/webgl2";
import { bootPhaser, fixtureFailureDiagnostics } from "./adapters/phaser/boot";
import type { ZoneLifecycleDiagnostics } from "./adapters/phaser/isometric-world";
import type { CombatPresentationDiagnostics } from "./adapters/phaser/combat-arena-presentation";
import {
  contentId,
  persistentInstanceId,
  type DamageResult,
  type EquipmentItemInstance,
  type FlaskDrinkResult,
  type FlaskSlot,
  type LoadoutSlot,
} from "./core";
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
import { CHARACTER_SLOT_LIMIT, type CharacterSave } from "./core";
import {
  App,
  type AccountMenuActions,
  type AccountMenuModel,
  type MainMenuCharacterSaveModel,
  type PersistenceFixtureActions,
  type SystemMenuExitDestination,
} from "./presentation/App";
import { sharedKeybinds } from "./presentation/keybinds";
import { CHARACTER_RESPAWN_EVENT } from "./presentation/shell-contracts";
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
      /** Drinks the flask in slot 1–4 (TASK-711). */
      useFlask: (slotNumber: 1 | 2 | 3 | 4) => FlaskDrinkResult;
      /**
       * Grants a deterministic flask (Heartwell for "life", Mindwell for
       * "mana", with a fixed low-tier Deep Reserve affix) and equips it
       * into slot 1–4. Returns whether the equip was accepted.
       */
      grantFlask: (slotNumber: 1 | 2 | 3 | 4, kind: "life" | "mana") => boolean;
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

function flaskSlotFromNumber(slotNumber: 1 | 2 | 3 | 4): FlaskSlot {
  return `flask-${slotNumber}`;
}

/**
 * Deterministic flask instances for the TASK-711 automation hook: catalog
 * base stats plus a fixed low-roll Deep Reserve affix (commons carry
 * exactly one affix), so e2e assertions can rely on exact recovery,
 * duration, and charge numbers.
 */
let nextTestFlaskSerial = 1;
function createTestFlask(kind: "life" | "mana"): EquipmentItemInstance {
  return {
    kind: "equipment",
    instanceId: persistentInstanceId(
      `item:test-flask-${nextTestFlaskSerial++}`,
    ),
    baseId: contentId(
      kind === "life" ? "item:heartwell-flask" : "item:mindwell-flask",
    ),
    rarity: "common",
    requiredLevel: 1,
    origin: "loot",
    affixes: [
      {
        affixId: contentId("affix:deep-reserve"),
        tier: 5,
        modifier: {
          statId: contentId("stat:flask-charges"),
          operation: "flat",
          value: 4,
        },
      },
    ],
  };
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
/**
 * TASK-709 automation affordance (DEC-031 explicit-parameter precedent):
 * `?accountTest` points the account menu at a same-origin `/api` base so
 * Playwright can route-mock the §2 contract on 127.0.0.1, where the real
 * session probe is deliberately skipped. Real players never set it, and
 * without it local origins remain purely local.
 */
const accountAutomation = fixtureParameters.has("accountTest");
/**
 * TASK-714 (DEC-040): playing requires an account on every player-reachable
 * origin. The gate applies to the plain menu boot on any non-loopback host
 * (custom domain, `*.pages.dev`, public hosts) and under `?accountTest` so
 * e2e can drive it. The remaining ungated paths are the automation/dev
 * doors: `?autostart` and the fixture flags (explicit query parameters that
 * players never see and that grant nothing server-side), plus plain loads
 * on loopback/LAN dev origins that no player can reach.
 */
const accountGateApplies =
  showMainMenu &&
  (accountAutomation || !isLocalDevHostname(window.location.hostname));
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
/**
 * TASK-709: the save service behind the DEC-034 triggers. Local IndexedDB
 * on the automation/dev door only (TASK-716, DEC-042 — gated origins never
 * read or write it); selecting a server character swaps in an
 * `HttpSaveRepository` bound to that character row, and every existing
 * trigger (zone travel, death, respawn, page hide) then persists to the
 * server unchanged.
 */
let activeCharacterSaves: CharacterSaveService = characterSaves;
let characterSaveMenu: MainMenuCharacterSaveModel = {
  available: false,
  recovered: false,
};
let continueSavedCharacter: (() => boolean) | null = null;
/**
 * TASK-719: true while the most recent save trigger failed; the HUD shows a
 * persistent "progress is not being saved" warning until a save lands.
 */
let saveWarning = false;
/** TASK-709 account menu state (null on local origins / signed out). */
let accountMenu: AccountMenuModel | null = null;
/**
 * TASK-714 account gate state: "checking" while the boot session resolves
 * on a gated origin, "signed-out" when it resolved without a session (the
 * menu shows the account-required screen), null when a session exists or
 * the origin is an ungated dev door.
 */
let accountGate: "checking" | "signed-out" | null = accountGateApplies
  ? "checking"
  : null;
let accountClient: ApiClient | null = null;
/** Set once the renderer boots; restores a server save into the sim. */
let restoreServerCharacter: ((save: CharacterSave) => boolean) | null = null;
/**
 * Save triggers stay disarmed until the player actually enters gameplay
 * (New Game, Continue, or `?autostart`), so an untouched main menu can
 * never overwrite an existing save on tab close.
 */
let gameplayStarted = false;
/** Device keybinds (TASK-715): one store for input, HUD, and the menu. */
const keybinds = sharedKeybinds();
/**
 * TASK-715 system-menu exit flow (DEC-041): flush the character save, then
 * leave via a clean navigation — character select lives on the /play/ main
 * menu, Exit to Main Menu is the homepage. Rebound once the renderer boots
 * so the flush uses the live simulation; the menu is unreachable before
 * that.
 */
function exitDestinationUrl(destination: SystemMenuExitDestination): string {
  return destination === "main-menu" ? "/" : "/play/";
}
let exitGame: (destination: SystemMenuExitDestination) => Promise<void> = (
  destination,
) => {
  window.location.assign(exitDestinationUrl(destination));
  return Promise.resolve();
};
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
      account={accountMenu}
      accountActions={accountActions}
      accountGate={accountGate}
      keybinds={keybinds}
      onExitGame={(destination) => exitGame(destination)}
      saveWarning={saveWarning}
    />,
    mount,
  );
}

// ---------------------------------------------------------------------------
// TASK-709 account-aware menu (DEC-036 menu composition).
//
// The shell owns every API interaction; the menu UI observes `accountMenu`
// and calls `accountActions`. Nothing here runs for `?autostart`, the
// fixture automation modes, or plain local origins, so all pre-709 paths
// stay byte-identical.
// ---------------------------------------------------------------------------

const ACCOUNT_UNAVAILABLE_NOTICE =
  "The account service is unreachable right now — you can play locally " +
  "and try again later.";

function setAccountMenu(next: AccountMenuModel | null): void {
  accountMenu = next;
  renderApp();
}

function accountActionMessage(error: unknown): string {
  if (
    error instanceof ApiError &&
    (error.status === 409 || error.status === 422 || error.status === 403)
  ) {
    return error.message;
  }
  return ACCOUNT_UNAVAILABLE_NOTICE;
}

async function refreshAccountCharacters(): Promise<void> {
  if (accountClient === null || accountMenu === null) return;
  try {
    const list = await accountClient.listCharacters();
    setAccountMenu({
      ...accountMenu,
      phase: "ready",
      characters: list.map((entry) => ({
        id: entry.id,
        name: entry.name,
        className: entry.class,
        level: entry.level,
      })),
      busy: false,
      notice: null,
    });
  } catch {
    setAccountMenu({
      ...accountMenu,
      phase: "unavailable",
      busy: false,
      error: null,
      notice: ACCOUNT_UNAVAILABLE_NOTICE,
    });
  }
}

/**
 * Binds the save pipeline to a server character row and resolves how
 * gameplay should start: "fresh" (never saved — the menu runs the New Game
 * tutorial travel) or "restored" (the envelope decoded and the simulation
 * has been restored). Null means the character could not be entered; the
 * reason is surfaced through the menu model.
 */
async function enterServerCharacter(
  id: string,
): Promise<"fresh" | "restored" | null> {
  if (accountClient === null) return null;
  const repository = new HttpSaveRepository({
    client: accountClient,
    characterId: id,
    codec: CHARACTER_SAVE_CODEC,
    checksumProvider: new WebCryptoSha256(),
    clock: new SystemSaveClock(),
    build: "loot-divers-client",
    contentSchemaVersion: 1,
  });
  const service = new CharacterSaveService(repository);
  const boot = await service.loadForBoot();
  if (boot.save === null && boot.failure !== null) {
    if (accountMenu !== null) {
      setAccountMenu({
        ...accountMenu,
        busy: false,
        error: `This character could not be loaded: ${boot.failure}`,
      });
    }
    return null;
  }
  if (boot.save !== null && restoreServerCharacter?.(boot.save) !== true) {
    if (accountMenu !== null) {
      setAccountMenu({
        ...accountMenu,
        busy: false,
        error: "This character's save could not be restored on this client.",
      });
    }
    return null;
  }
  activeCharacterSaves = service;
  if (accountMenu !== null) {
    setAccountMenu({ ...accountMenu, busy: false, error: null });
  }
  return boot.save === null ? "fresh" : "restored";
}

const accountActions: AccountMenuActions = {
  async select(id) {
    if (accountMenu === null) return null;
    setAccountMenu({ ...accountMenu, busy: true, error: null });
    return enterServerCharacter(id);
  },
  async create(name) {
    if (accountClient === null || accountMenu === null) return null;
    setAccountMenu({ ...accountMenu, busy: true, error: null });
    let id: string;
    try {
      id = await accountClient.createCharacter(name, "barbarian");
    } catch (error) {
      setAccountMenu({
        ...accountMenu,
        busy: false,
        error: accountActionMessage(error),
      });
      return null;
    }
    const outcome = await enterServerCharacter(id);
    return outcome === null ? null : "fresh";
  },
  async remove(id) {
    if (accountClient === null || accountMenu === null) return false;
    setAccountMenu({ ...accountMenu, busy: true, error: null });
    try {
      await accountClient.deleteCharacter(id);
    } catch (error) {
      setAccountMenu({
        ...accountMenu,
        busy: false,
        error: accountActionMessage(error),
      });
      return false;
    }
    await refreshAccountCharacters();
    return true;
  },
  async retry() {
    // TASK-714: recover from the "unavailable" state without a reload.
    if (accountClient === null || accountMenu === null) return;
    setAccountMenu({
      ...accountMenu,
      phase: "loading",
      busy: false,
      error: null,
      notice: null,
    });
    await refreshAccountCharacters();
  },
  async logout() {
    // TASK-714 (DEC-040): end the session server-side (the cookie is
    // HttpOnly, so only the API can clear it), then hand off to the
    // homepage, which owns auth.
    if (accountClient === null) return false;
    if (accountMenu !== null) {
      setAccountMenu({ ...accountMenu, busy: true, error: null });
    }
    try {
      await accountClient.logout();
    } catch {
      if (accountMenu !== null) {
        setAccountMenu({
          ...accountMenu,
          busy: false,
          error: "Could not log out — the account service is unreachable.",
        });
      }
      return false;
    }
    window.location.assign("/");
    return true;
  },
};

/**
 * Resolves the boot session and, when signed in, activates the account
 * menu. On real origins this is the TASK-707 probe (custom domain only);
 * under `?accountTest` it targets the same-origin `/api` base Playwright
 * mocks. Runs only when the main menu will actually show, so `?autostart`
 * and the fixture modes never touch the network beyond the 707 probe.
 */
async function resolveAccountSession(): Promise<{
  origin: string;
  email: string;
} | null> {
  if (accountAutomation) {
    const origin = `${window.location.origin}/api`;
    try {
      const session = await new ApiClient(origin).session();
      if (session !== null) return { origin, email: session.email };
    } catch {
      // Unreachable mock API: treated as signed out.
    }
    return null;
  }
  const probe = await probeAuthSession();
  if (probe.apiOrigin === null) return null; // No API on this origin.
  if (probe.session === null) return null;
  return { origin: probe.apiOrigin, email: probe.session.email };
}

async function initAccountMenu(): Promise<void> {
  if (!showMainMenu) {
    // Preserve the TASK-707 boot probe on gameplay/automation boots.
    if (!accountAutomation) void probeAuthSession();
    return;
  }
  const resolved = await resolveAccountSession();
  if (resolved === null) {
    // TASK-714 (DEC-040): on gated origins a missing session locks the
    // menu behind the account-required screen; ungated dev origins keep
    // the local menu.
    if (accountGateApplies) {
      accountGate = "signed-out";
      renderApp();
    }
    return;
  }
  if (gameplayStarted) return; // The player already started a local game.
  accountGate = null;
  accountClient = new ApiClient(resolved.origin);
  setAccountMenu({
    email: resolved.email,
    phase: "loading",
    characters: [],
    slotLimit: CHARACTER_SLOT_LIMIT,
    busy: false,
    error: null,
    notice: null,
  });
  await refreshAccountCharacters();
}
void initAccountMenu();

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
          useFlask: (slotNumber) =>
            renderer.combat.useFlask(flaskSlotFromNumber(slotNumber)),
          grantFlask: (slotNumber, kind) =>
            renderer.combat.grantAndEquipFlask(
              createTestFlask(kind),
              flaskSlotFromNumber(slotNumber),
            ),
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

        // TASK-705 save triggers (DEC-034, amended by TASK-719): persist on
        // zone travel, death, respawn, banked tutorial step, level-up, a
        // 30-second autosave cadence, and page hide. Trigger-based saves
        // chain onto a FIFO queue so rapid triggers (e.g. two quick zone
        // changes) can never land out of order and leave a stale save as
        // the active generation; the snapshot is captured when its turn
        // arrives, so a queued save always writes the freshest state.
        // Unchanged states are skipped (fingerprint check) so the autosave
        // cadence never uploads redundant blobs.
        let pendingCharacterSave: Promise<void> = Promise.resolve();
        let lastPersistedFingerprint: string | null = null;
        const persistCharacter = (): Promise<void> => {
          // `activeCharacterSaves` is read at flush time so a TASK-709
          // server-character selection swaps every trigger to the HTTP
          // repository atomically.
          pendingCharacterSave = pendingCharacterSave
            .catch(() => undefined)
            .then(async () => {
              const save = renderer.combat.captureCharacterSave();
              const fingerprint = JSON.stringify(save);
              if (fingerprint === lastPersistedFingerprint) return;
              await activeCharacterSaves.save(save);
              lastPersistedFingerprint = fingerprint;
              if (saveWarning) {
                saveWarning = false;
                renderApp();
              }
            });
          return pendingCharacterSave;
        };
        const persistCharacterQuietly = (): void => {
          persistCharacter().catch((error: unknown) => {
            const detail =
              error instanceof Error ? error.message : String(error);
            // TASK-719: a failing save must never be silent — log loudly
            // and surface a persistent HUD warning until a save lands.
            console.error(`Character save failed: ${detail}`);
            if (!saveWarning) {
              saveWarning = true;
              renderApp();
            }
          });
        };
        // TASK-715 (DEC-041): the system menu's exit flow flushes through
        // the same FIFO save queue as every other trigger, then navigates.
        // A failed save never strands the player in-game — local saves are
        // best-effort (DEC-014) and the failure is logged.
        exitGame = async (destination) => {
          try {
            await persistCharacter();
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : String(error);
            console.warn(`Exit save failed: ${detail}`);
          }
          window.location.assign(exitDestinationUrl(destination));
        };
        // The simulation always boots into Hearthmere, so that is the
        // baseline; the first hud snapshot with a different zone marks a
        // completed travel (including New Game's move to Wakeshore Landing).
        // The same read model drives the TASK-710 death trigger: the moment
        // the player dies, the character persists with the respawn
        // destination already committed (core capture semantics, DEC-037),
        // so reloading from the death screen can never rewind past the
        // death.
        let lastObservedZoneId: string | null =
          renderer.combat.diagnostics()?.zoneId ?? null;
        let lastObservedPlayerDead =
          renderer.combat.diagnostics()?.playerDead ?? false;
        // TASK-719 triggers: banked tutorial steps and level-ups persist the
        // moment they happen. Before this, a tutorial-only session's
        // progress rode entirely on the page-hide save, whose HTTP PUT the
        // browser aborts at tab close — the owner's "resets to tutorial"
        // defect (see DEC-042 amendment).
        let lastObservedTutorialSteps =
          renderer.combat.diagnostics()?.tutorial?.stepsCompleted ?? 0;
        let lastObservedLevel = renderer.combat.diagnostics()?.level ?? 1;
        window.addEventListener("rarpg:combat-hud", (event) => {
          const hud = (event as CustomEvent<CombatHudReadModel>).detail;
          const died = !lastObservedPlayerDead && hud.playerDead;
          lastObservedPlayerDead = hud.playerDead;
          const banked =
            hud.tutorial !== null &&
            hud.tutorial.stepsCompleted > lastObservedTutorialSteps;
          if (hud.tutorial !== null) {
            lastObservedTutorialSteps = hud.tutorial.stepsCompleted;
          }
          const leveled = hud.level > lastObservedLevel;
          lastObservedLevel = hud.level;
          if (lastObservedZoneId === null) {
            lastObservedZoneId = hud.zoneId;
            return;
          }
          const traveled = hud.zoneId !== lastObservedZoneId;
          lastObservedZoneId = hud.zoneId;
          if (!gameplayStarted) return;
          if (traveled || died || banked || leveled) persistCharacterQuietly();
        });
        // TASK-710 save-at-respawn trigger (DEC-037): the presentation
        // adapter announces every accepted respawn. Same-zone respawns
        // (Wakeshore, Hearthmere) never change the hud zone id, so the
        // travel trigger alone would miss them.
        window.addEventListener(CHARACTER_RESPAWN_EVENT, () => {
          if (!gameplayStarted) return;
          persistCharacterQuietly();
        });
        const persistOnHide = (): void => {
          // Never persist from an unstarted menu session, and skip the dead
          // state: the TASK-710 death trigger already persisted the
          // respawn-committed character the moment the player died.
          if (!gameplayStarted) return;
          if (renderer.combat.diagnostics()?.playerDead !== false) return;
          persistCharacterQuietly();
        };
        window.addEventListener("pagehide", persistOnHide);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "hidden") persistOnHide();
        });
        // TASK-719 autosave cadence: bounds progress loss to 30 seconds even
        // when the page-hide save cannot land (the browser may destroy the
        // document before an HTTP PUT dispatches). The fingerprint check in
        // `persistCharacter` makes idle ticks free.
        window.setInterval(() => {
          if (!gameplayStarted) return;
          if (renderer.combat.diagnostics()?.playerDead !== false) return;
          persistCharacterQuietly();
        }, 30_000);

        // Boot-time load resolves the Continue button (DEC-031 deferral):
        // corrupted or missing saves leave the button disabled, recovered
        // backups surface a notice in the menu.
        //
        // TASK-716 (DEC-042): local character saves are automation/dev-door
        // only. On gated origins the local IndexedDB store is never read —
        // the server is the only save store for players, and any stale
        // local blob from an earlier build is simply ignored (no
        // migration/upload; TASK-717 server-side validation would reject
        // unvetted blobs anyway).
        if (!accountGateApplies) {
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
                console.warn(
                  `Saved character could not be restored: ${detail}`,
                );
                characterSaveMenu = { available: false, recovered: false };
                renderApp();
                return false;
              }
            };
            renderApp();
          });
        }

        // TASK-709: restores a decoded server envelope into the simulation
        // (same semantics as the local Continue closure above).
        restoreServerCharacter = (save) => {
          try {
            renderer.combat.restoreCharacterSave(save);
            return true;
          } catch (error) {
            const detail =
              error instanceof Error ? error.message : String(error);
            console.warn(`Server character could not be restored: ${detail}`);
            return false;
          }
        };

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

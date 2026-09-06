import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createReadModelChannel } from "../../src/adapters/ui/read-model-channel";
import { experienceToNextLevel } from "../../src/core";
import {
  App,
  type SystemMenuExitDestination,
} from "../../src/presentation/App";
import {
  KeybindsStore,
  type KeybindsStorage,
} from "../../src/presentation/keybinds";
import type {
  CombatHudReadModel,
  ShellBindings,
  ShellReadModel,
} from "../../src/presentation/shell-contracts";

/**
 * TASK-715 system menu component coverage (DEC-041): Escape priority and
 * LIFO close order, keybind capture with swap semantics, reset to
 * defaults, rebind-aware shell toggles, and the exit actions.
 */

const readyModel: ShellReadModel = {
  revision: 1,
  phase: { kind: "ready", rendererVersion: "WebGL 2 synthetic" },
  viewport: {
    cssWidth: 960,
    cssHeight: 540,
    backingWidth: 1920,
    backingHeight: 1080,
    devicePixelRatio: 2,
  },
  emittedIntentCount: 0,
  capturedKeyboardCount: 0,
  lastIntentType: null,
};

const baseCombatHud: CombatHudReadModel = {
  paused: false,
  playerHealth: 100,
  playerMaxHealth: 100,
  playerDead: false,
  manaCurrent: 100,
  manaMaximum: 100,
  level: 1,
  experienceCurrent: 0,
  experienceToNextLevel: experienceToNextLevel(1),
  abilities: [],
  activeStatuses: [],
  gatheringLabel: null,
  gatheringProgress: 0,
  zoneId: "zone:hearthmere",
  zoneName: "Hearthmere",
  respawnZoneName: "Hearthmere",
  flasks: [],
  flaskFeedback: null,
  questLabel: null,
  tutorial: null,
  minimap: {
    width: 1_200,
    height: 800,
    floorColor: "#10263a",
    edgeColor: "#64d8cb",
    walkable: { x: 18, y: 18, width: 1_164, height: 764 },
    markers: [],
  },
};

function memoryStorage(): KeybindsStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

interface MountOptions {
  readonly keybinds?: KeybindsStore;
  readonly onExitGame?: (
    destination: SystemMenuExitDestination,
  ) => void | Promise<void>;
}

async function mountCombatShell(options: MountOptions = {}) {
  const channel = createReadModelChannel(readyModel);
  const bindings: ShellBindings = {
    models: channel.source,
    intents: { emit: vi.fn() },
  };
  const keybinds = options.keybinds ?? new KeybindsStore(memoryStorage());
  const container = document.createElement("div");
  document.body.append(container);
  const onExitGame = options.onExitGame ?? (() => undefined);
  await act(() => {
    render(
      <App
        bindings={bindings}
        showCombatPrototype
        keybinds={keybinds}
        onExitGame={onExitGame}
      />,
      container,
    );
  });
  return { container, keybinds };
}

async function pressKey(code: string): Promise<void> {
  await act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, code }),
    );
  });
}

async function publishCombatHud(model: CombatHudReadModel): Promise<void> {
  await act(() => {
    window.dispatchEvent(
      new CustomEvent<CombatHudReadModel>("rarpg:combat-hud", {
        detail: model,
      }),
    );
  });
}

function systemMenu(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="system-menu"]');
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
  if (element === null) throw new Error(`Missing button ${testId}`);
  return element;
}

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
});

describe("system menu (TASK-715)", () => {
  it("opens on Escape when nothing else is open, takes focus, and Resume returns to the canvas", async () => {
    const { container } = await mountCombatShell();
    const canvas = container.querySelector<HTMLCanvasElement>("#game-canvas");
    canvas?.focus();

    expect(systemMenu(container)).toBeNull();
    await pressKey("Escape");
    const menu = systemMenu(container);
    expect(menu).not.toBeNull();
    // Focus left the canvas — that is what pauses the focus-gated runner.
    expect(document.activeElement).toBe(menu);

    await act(() => {
      button(container, "system-menu-resume").click();
    });
    expect(systemMenu(container)).toBeNull();
    expect(document.activeElement).toBe(canvas);
  });

  it("closes menus in LIFO order: Escape closes the inventory first, then opens the system menu, then closes it", async () => {
    const { container } = await mountCombatShell();
    container.querySelector<HTMLCanvasElement>("#game-canvas")?.focus();

    await pressKey("KeyI");
    expect(container.querySelector("#inventory-menu")).not.toBeNull();

    // First Escape only closes the inventory.
    await pressKey("Escape");
    expect(container.querySelector("#inventory-menu")).toBeNull();
    expect(systemMenu(container)).toBeNull();

    // Second Escape opens the system menu; third closes it again.
    await pressKey("Escape");
    expect(systemMenu(container)).not.toBeNull();
    await pressKey("Escape");
    expect(systemMenu(container)).toBeNull();
  });

  it("stays closed while the death screen is on top", async () => {
    const { container } = await mountCombatShell();
    await publishCombatHud({ ...baseCombatHud, playerDead: true });
    expect(
      container.querySelector('[data-testid="death-overlay"]'),
    ).not.toBeNull();

    await pressKey("Escape");
    expect(systemMenu(container)).toBeNull();
  });

  it("makes gameplay menu toggles inert while open", async () => {
    const { container } = await mountCombatShell();
    await pressKey("Escape");
    expect(systemMenu(container)).not.toBeNull();

    await pressKey("KeyI");
    expect(container.querySelector("#inventory-menu")).toBeNull();
    expect(systemMenu(container)).not.toBeNull();
  });

  it("rebinds a key through capture, swaps on conflict, and resets to defaults", async () => {
    const { container, keybinds } = await mountCombatShell();
    await pressKey("Escape");
    await act(() => {
      button(container, "system-menu-keybinds").click();
    });

    // Rebind Flask 1 from Digit1 to the free key Digit5.
    const flaskButton = button(container, "keybind-flask-1");
    expect(flaskButton.textContent).toBe("1");
    await act(() => {
      flaskButton.click();
    });
    expect(button(container, "keybind-flask-1").textContent).toBe(
      "Press a key…",
    );
    await pressKey("Digit5");
    expect(button(container, "keybind-flask-1").textContent).toBe("5");
    expect(keybinds.codeFor("flask-1")).toBe("Digit5");
    expect(keybinds.actionFor("Digit1")).toBeNull();

    // Rebinding Dodge to W swaps with Move up.
    await act(() => {
      button(container, "keybind-dodge").click();
    });
    await pressKey("KeyW");
    expect(button(container, "keybind-dodge").textContent).toBe("W");
    expect(button(container, "keybind-move-up").textContent).toBe("Space");
    expect(
      container.querySelector('[data-testid="keybind-feedback"]')?.textContent,
    ).toContain("Move up took Space");

    // Escape cancels an in-progress capture without closing the screen.
    await act(() => {
      button(container, "keybind-interact").click();
    });
    await pressKey("Escape");
    expect(button(container, "keybind-interact").textContent).toBe("F");
    expect(systemMenu(container)).not.toBeNull();

    // Reserved keys are refused and capture stays armed for another key.
    await act(() => {
      button(container, "keybind-interact").click();
    });
    await pressKey("ShiftLeft");
    expect(button(container, "keybind-interact").textContent).toBe(
      "Press a key…",
    );
    await pressKey("KeyG");
    expect(button(container, "keybind-interact").textContent).toBe("G");

    // Reset restores every default.
    await act(() => {
      button(container, "system-menu-reset-keybinds").click();
    });
    expect(button(container, "keybind-flask-1").textContent).toBe("1");
    expect(button(container, "keybind-dodge").textContent).toBe("Space");
    expect(keybinds.isDefault()).toBe(true);

    // Escape backs out of the keybinds screen, then closes the menu.
    await pressKey("Escape");
    expect(systemMenu(container)).not.toBeNull();
    expect(
      container.querySelector('[data-testid="system-menu-resume"]'),
    ).not.toBeNull();
    await pressKey("Escape");
    expect(systemMenu(container)).toBeNull();
  });

  it("applies a rebound inventory toggle immediately in the shell key handler", async () => {
    const { container, keybinds } = await mountCombatShell();
    keybinds.rebind("toggle-inventory", "KeyX");

    // The old key no longer toggles; the new key does.
    await pressKey("KeyI");
    expect(container.querySelector("#inventory-menu")).toBeNull();
    await pressKey("KeyX");
    expect(container.querySelector("#inventory-menu")).not.toBeNull();
    await pressKey("KeyX");
    expect(container.querySelector("#inventory-menu")).toBeNull();
  });

  it("runs the exit actions through onExitGame and reports the saving state", async () => {
    let resolveExit!: () => void;
    const exitGate = new Promise<void>((resolve) => {
      resolveExit = resolve;
    });
    const onExitGame = vi.fn<
      (destination: SystemMenuExitDestination) => Promise<void>
    >(() => exitGate);
    const { container } = await mountCombatShell({ onExitGame });
    await pressKey("Escape");

    await act(() => {
      button(container, "system-menu-exit-character-select").click();
    });
    expect(onExitGame).toHaveBeenCalledExactlyOnceWith("character-select");
    expect(
      container.querySelector('[data-testid="system-menu-note"]')?.textContent,
    ).toContain("Saving");
    expect(button(container, "system-menu-exit-main-menu").disabled).toBe(true);
    expect(button(container, "system-menu-resume").disabled).toBe(true);
    resolveExit();
  });

  it("sends Exit to Main Menu to the homepage destination", async () => {
    const onExitGame = vi.fn();
    const { container } = await mountCombatShell({ onExitGame });
    await pressKey("Escape");
    await act(() => {
      button(container, "system-menu-exit-main-menu").click();
    });
    expect(onExitGame).toHaveBeenCalledExactlyOnceWith("main-menu");
  });
});

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installKeyboardCapture } from "../../src/adapters/browser/keyboard-capture";
import { createReadModelChannel } from "../../src/adapters/ui/read-model-channel";
import { App } from "../../src/presentation/App";
import type {
  CombatHudReadModel,
  ShellBindings,
  ShellReadModel,
} from "../../src/presentation/shell-contracts";

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

const combatHudModel: CombatHudReadModel = {
  paused: false,
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
};

function mount(model: ShellReadModel, emit = vi.fn()) {
  const channel = createReadModelChannel(model);
  const bindings: ShellBindings = {
    models: channel.source,
    intents: { emit },
  };
  const container = document.createElement("div");
  document.body.append(container);
  render(<App bindings={bindings} />, container);
  return { channel, container, emit };
}

async function publishCombatHud(model: CombatHudReadModel): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  window.dispatchEvent(
    new CustomEvent<CombatHudReadModel>("rarpg:combat-hud", {
      detail: model,
    }),
  );
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

afterEach(() => {
  render(null, document.body);
  document.body.replaceChildren();
});

describe("technical UI shell component", () => {
  it("renders an accessible canvas and emits a typed diagnostic intent", () => {
    const { container, emit } = mount(readyModel);
    const canvas = container.querySelector("canvas");
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Send diagnostic intent",
    );

    expect(canvas?.getAttribute("tabindex")).toBe("0");
    expect(canvas?.getAttribute("aria-describedby")).toBe(
      "canvas-instructions",
    );
    expect(button).toBeDefined();
    expect(
      container.querySelectorAll(
        '[aria-live="polite"], [aria-live="assertive"]',
      ),
    ).toHaveLength(1);

    button?.click();

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      type: "shell.diagnostic-requested",
    });
  });

  it("emits no intents for focus-navigation modifier sequences", () => {
    const { container, emit } = mount(readyModel);
    const canvas = container.querySelector("canvas");
    const skipLink = container.querySelector<HTMLElement>(".skip-link");

    expect(canvas).not.toBeNull();
    expect(skipLink).not.toBeNull();
    canvas?.focus();
    const removeCapture = installKeyboardCapture(
      canvas as HTMLCanvasElement,
      {
        emit,
      },
      skipLink as HTMLElement,
    );

    try {
      for (const event of [
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "ShiftLeft",
          shiftKey: true,
        }),
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Tab",
          shiftKey: true,
        }),
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          code: "AltLeft",
        }),
        new KeyboardEvent("keydown", {
          altKey: true,
          bubbles: true,
          code: "Tab",
        }),
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "ControlLeft",
          ctrlKey: true,
        }),
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "Tab",
          ctrlKey: true,
        }),
      ]) {
        window.dispatchEvent(event);
      }

      expect(emit).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(skipLink);
    } finally {
      removeCapture();
    }
  });

  it("consumes published read models without receiving a state mutator", async () => {
    const loadingModel: ShellReadModel = {
      ...readyModel,
      revision: 0,
      phase: { kind: "loading", message: "Synthetic loading fixture" },
    };
    const { channel, container } = mount(loadingModel);

    expect(container.textContent).toContain("Synthetic loading fixture");
    expect(
      container.textContent?.split("Synthetic loading fixture").length,
    ).toBe(2);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '[aria-live="polite"], [aria-live="assertive"]',
      ),
    ).toHaveLength(1);
    expect(container.querySelector('[data-testid="boot-status"]')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 0));
    channel.publisher.publish(readyModel);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain("Foundation ready");
    expect(container.textContent).not.toContain("Synthetic loading fixture");
  });

  it("announces an actionable renderer error exactly once", () => {
    const { container, emit } = mount({
      ...readyModel,
      phase: {
        kind: "error",
        heading: "Synthetic renderer error",
        detail: "No compatible context was returned.",
        canRetry: true,
      },
    });
    const alerts = container.querySelectorAll('[role="alert"]');
    const retry = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === "Retry renderer",
    );

    expect(alerts).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '[aria-live="polite"], [aria-live="assertive"]',
      ),
    ).toHaveLength(1);
    expect(container.querySelector('[data-testid="boot-status"]')).toBeNull();
    expect(
      container.textContent?.split("Synthetic renderer error").length,
    ).toBe(2);
    expect(container.textContent).toContain(
      "No compatible context was returned.",
    );

    retry?.click();
    expect(emit).toHaveBeenCalledWith({
      type: "shell.renderer-retry-requested",
    });
  });

  it("renders one compact player vitals HUD without enemy DOM UI", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => {
      render(
        <App
          bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
          showCombatPrototype
        />,
        container,
      );
    });

    await publishCombatHud({
      ...combatHudModel,
      playerHealth: 80,
      manaCurrent: 85,
    });

    const hud = container.querySelector('[data-testid="combat-vitals-hud"]');
    const rows = hud?.querySelectorAll(":scope > .combat-vitals-row");
    const labels = Array.from(
      hud?.querySelectorAll(".combat-vitals-label") ?? [],
      (label) => label.textContent,
    );
    const playerMeter = container.querySelector(
      '[role="progressbar"][aria-label="Player health"]',
    );
    const manaMeter = container.querySelector(
      '[role="progressbar"][aria-label="Player mana"]',
    );
    const experienceMeter = container.querySelector(
      '[role="progressbar"][aria-label="Reserved experience placeholder"]',
    );
    expect(
      container.querySelectorAll('[data-testid="combat-vitals-hud"]'),
    ).toHaveLength(1);
    expect(rows).toHaveLength(3);
    expect(labels).toEqual(["HP", "MP", "XP"]);
    expect(hud?.textContent).toBe("HPMPXP");
    expect(hud?.textContent).not.toMatch(
      /HEALTH|STAMINA|READY|FULL|DEFEATED|\d|%/i,
    );
    expect(playerMeter?.getAttribute("aria-valuenow")).toBe("80");
    expect(playerMeter?.getAttribute("aria-valuemax")).toBe("100");
    expect(playerMeter?.getAttribute("aria-valuetext")).toBe(
      "80 of 100 health",
    );
    expect(manaMeter?.getAttribute("aria-valuenow")).toBe("85");
    expect(manaMeter?.getAttribute("aria-valuetext")).toBe("85 of 100 mana");
    expect(experienceMeter?.getAttribute("aria-valuenow")).toBe("0");
    expect(experienceMeter?.getAttribute("aria-valuetext")).toBe(
      "0 of 100 reserved experience placeholder",
    );
    expect(container.textContent).not.toMatch(/STAMINA|\bST\b/i);
    expect(container.querySelector('[aria-label*="Enemy"]')).toBeNull();
    expect(container.textContent).not.toContain("ENEMY");
    const actionHud = container.querySelector(
      '[data-testid="combat-action-hud"]',
    );
    const flaskHud = container.querySelector(
      '[data-testid="combat-flask-slots"]',
    );
    expect(actionHud?.querySelectorAll(".combat-ability")).toHaveLength(4);
    expect(flaskHud?.querySelectorAll(".combat-flask-slot")).toHaveLength(4);
    expect(
      Array.from(
        flaskHud?.querySelectorAll(".combat-flask-slot kbd") ?? [],
        (key) => key.textContent?.trim(),
      ),
    ).toEqual(["1", "2", "3", "4"]);
    expect(
      Array.from(
        actionHud?.querySelectorAll(".combat-ability kbd") ?? [],
        (key) => key.textContent?.trim(),
      ),
    ).toEqual(["LMB", "Q", "E", "F"]);
    expect(
      actionHud
        ?.querySelector('[data-ability-id="ability:cinder-dart"]')
        ?.getAttribute("aria-label"),
    ).toContain("15 mana, 0.5s cooldown");
    expect(
      actionHud
        ?.querySelector('[data-ability-id="ability:basic-cleave"]')
        ?.getAttribute("aria-label"),
    ).toContain("Left click, Basic Cleave");
    expect(actionHud?.textContent).not.toMatch(
      /Move WASD|Aim mouse|Dodge Space|Reset R/,
    );

    await publishCombatHud({
      ...combatHudModel,
      paused: false,
      playerHealth: 0,
      playerDead: true,
    });

    expect(playerMeter?.getAttribute("aria-valuenow")).toBe("0");
    expect(playerMeter?.getAttribute("aria-valuetext")).toBe(
      "0 of 100 health, defeated",
    );
    expect(hud?.textContent).toBe("HPMPXP");
    expect(hud?.querySelector('[data-state="dead"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await publishCombatHud({
      ...combatHudModel,
      paused: true,
    });

    expect(playerMeter?.getAttribute("aria-valuenow")).toBe("100");
    expect(playerMeter?.getAttribute("aria-valuetext")).toBe(
      "100 of 100 health",
    );
    expect(hud?.textContent).toBe("HPMPXP");
    expect(hud?.querySelector('[data-state="dead"]')).toBeNull();
    expect(container.querySelector(".combat-paused-hud")).not.toBeNull();
    expect(
      container.querySelector(".combat-paused-hud")?.contains(hud as Node),
    ).toBe(false);
  });

  it("renders cooldown and active status states from the combat read model", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    document.body.append(container);
    await act(() => {
      render(
        <App
          bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
          showCombatPrototype
        />,
        container,
      );
    });

    await publishCombatHud({
      ...combatHudModel,
      manaCurrent: 80,
      abilities: combatHudModel.abilities.map((ability) =>
        ability.id === "ability:defiant-signal"
          ? {
              ...ability,
              cooldownRemainingSeconds: 4.4,
              state: "cooldown" as const,
            }
          : ability,
      ),
      activeStatuses: [
        {
          id: "player:focused",
          label: "Focused",
          target: "player",
          remainingSeconds: 2.9,
        },
        {
          id: "enemy:weakened",
          label: "Weakened",
          target: "enemy",
          remainingSeconds: 2.9,
        },
      ],
    });

    const signal = container.querySelector(
      '[data-ability-id="ability:defiant-signal"]',
    );
    expect(signal?.getAttribute("data-state")).toBe("cooldown");
    expect(signal?.textContent).toContain("Cooldown 4.4s");
    expect(signal?.getAttribute("aria-label")).toContain("Cooldown 4.4s");
    expect(
      container.querySelector('[aria-label="Active combat effects"]')
        ?.textContent,
    ).toContain("Focused 2.9s");
    expect(
      container.querySelector('[aria-label="Active combat effects"]')
        ?.textContent,
    ).toContain("Enemy Weakened 2.9s");
  });
});

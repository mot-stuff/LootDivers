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
      paused: false,
      playerHealth: 80,
      playerMaxHealth: 100,
      playerDead: false,
      placeholderManaCurrent: 100,
      placeholderManaMaximum: 100,
      placeholderExperienceCurrent: 0,
      placeholderExperienceMaximum: 100,
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
      '[role="progressbar"][aria-label="Reserved mana placeholder"]',
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
    expect(manaMeter?.getAttribute("aria-valuenow")).toBe("100");
    expect(manaMeter?.getAttribute("aria-valuetext")).toBe(
      "100 of 100 reserved mana placeholder",
    );
    expect(experienceMeter?.getAttribute("aria-valuenow")).toBe("0");
    expect(experienceMeter?.getAttribute("aria-valuetext")).toBe(
      "0 of 100 reserved experience placeholder",
    );
    expect(container.textContent).not.toMatch(/STAMINA|\bST\b/i);
    expect(container.querySelector('[aria-label*="Enemy"]')).toBeNull();
    expect(container.textContent).not.toContain("ENEMY");

    await publishCombatHud({
      paused: false,
      playerHealth: 0,
      playerMaxHealth: 100,
      playerDead: true,
      placeholderManaCurrent: 100,
      placeholderManaMaximum: 100,
      placeholderExperienceCurrent: 0,
      placeholderExperienceMaximum: 100,
    });

    expect(playerMeter?.getAttribute("aria-valuenow")).toBe("0");
    expect(playerMeter?.getAttribute("aria-valuetext")).toBe(
      "0 of 100 health, defeated",
    );
    expect(hud?.textContent).toBe("HPMPXP");
    expect(hud?.querySelector('[data-state="dead"]')).not.toBeNull();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);

    await publishCombatHud({
      paused: true,
      playerHealth: 100,
      playerMaxHealth: 100,
      playerDead: false,
      placeholderManaCurrent: 100,
      placeholderManaMaximum: 100,
      placeholderExperienceCurrent: 0,
      placeholderExperienceMaximum: 100,
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
});

import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installKeyboardCapture } from "../../src/adapters/browser/keyboard-capture";
import { createReadModelChannel } from "../../src/adapters/ui/read-model-channel";
import { App } from "../../src/presentation/App";
import type {
  CombatHudReadModel,
  InventoryHudReadModel,
  ItemUiCommand,
  ShellBindings,
  ShellReadModel,
} from "../../src/presentation/shell-contracts";
import {
  ITEM_COMMAND_EVENT,
  ITEM_HUD_EVENT,
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

const itemHudModel: InventoryHudReadModel = {
  revision: 3,
  inventorySlots: Array.from({ length: 12 }, (_, index) => ({
    index,
    item:
      index === 0
        ? {
            kind: "equipment" as const,
            instanceId: "item-instance:cleaver",
            displayName: "Tempered Worn Cleaver of Steadfast Grip",
            rarity: "rare" as const,
            slotKind: "main-hand" as const,
            typeLabel: "Melee weapon",
            modifiers: [
              {
                id: "base:damage",
                source: "base" as const,
                label: "+5% outgoing ability damage",
                tier: null,
              },
              {
                id: "affix:tempered",
                source: "affix" as const,
                label: "+7% outgoing ability damage",
                tier: 2,
              },
            ],
          }
        : index === 1
          ? {
              kind: "ability-stone" as const,
              instanceId: "item-instance:stone",
              displayName: "Ability Stone",
              rarity: "common" as const,
              typeLabel: "Ability Stone" as const,
              quantity: 2,
            }
          : null,
  })),
  equipmentSlots: [
    { slot: "helmet", label: "Helmet", item: null },
    {
      slot: "chest",
      label: "Chest",
      item: {
        kind: "equipment",
        instanceId: "item-instance:vest",
        displayName: "Reinforced Trailguard Vest",
        rarity: "magic",
        slotKind: "chest",
        typeLabel: "Body armor",
        modifiers: [
          {
            id: "base:health",
            source: "base",
            label: "+10 maximum health",
            tier: null,
          },
          {
            id: "affix:reinforced",
            source: "affix",
            label: "+14 maximum health",
            tier: 2,
          },
        ],
      },
    },
    { slot: "amulet", label: "Amulet", item: null },
    { slot: "belt", label: "Belt", item: null },
    { slot: "boots", label: "Boots", item: null },
    { slot: "main-hand", label: "Main hand", item: null },
    { slot: "offhand", label: "Offhand", item: null },
    { slot: "ring-1", label: "Ring 1", item: null },
    { slot: "ring-2", label: "Ring 2", item: null },
  ],
  abilityChoices: [
    {
      id: "ability:basic-cleave",
      displayName: "Basic Cleave",
      owned: true,
      selectableFromStone: false,
    },
    {
      id: "ability:cinder-dart",
      displayName: "Cinder Dart",
      owned: false,
      selectableFromStone: true,
    },
    {
      id: "ability:winter-pulse",
      displayName: "Winter Pulse",
      owned: false,
      selectableFromStone: true,
    },
    {
      id: "ability:defiant-signal",
      displayName: "Defiant Signal",
      owned: true,
      selectableFromStone: false,
    },
  ],
  loadout: [
    {
      slot: "lmb",
      keyLabel: "LMB",
      accessibleKeyLabel: "Left click",
      abilityId: "ability:basic-cleave",
      displayName: "Basic Cleave",
      borrowedDefault: false,
    },
    {
      slot: "q",
      keyLabel: "Q",
      accessibleKeyLabel: "Q",
      abilityId: "ability:cinder-dart",
      displayName: "Cinder Dart",
      borrowedDefault: true,
    },
    {
      slot: "e",
      keyLabel: "E",
      accessibleKeyLabel: "E",
      abilityId: "ability:winter-pulse",
      displayName: "Winter Pulse",
      borrowedDefault: true,
    },
    {
      slot: "f",
      keyLabel: "F",
      accessibleKeyLabel: "F",
      abilityId: "ability:defiant-signal",
      displayName: "Defiant Signal",
      borrowedDefault: false,
    },
  ],
  playerMaximumHealth: 124,
  outgoingAbilityDamagePercent: 112,
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

async function publishItemHud(model: InventoryHudReadModel): Promise<void> {
  await act(() => {
    window.dispatchEvent(
      new CustomEvent<InventoryHudReadModel>(ITEM_HUD_EVENT, {
        detail: model,
      }),
    );
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

  it("opens Inventory with I only from canvas focus and restores focus on Escape", async () => {
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

    const canvas = container.querySelector<HTMLCanvasElement>("#game-canvas");
    const inventoryButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Inventory"));
    expect(inventoryButton?.getAttribute("aria-keyshortcuts")).toBe("I");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    inventoryButton?.focus();
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    canvas?.focus();
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
      );
    });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);

    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(canvas);
  });

  it("renders bounded inventory, equipment, tooltips, stats, and equip commands", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    const commands = vi.fn<(command: ItemUiCommand) => void>();
    const captureCommand = (event: CustomEvent<ItemUiCommand>) => {
      commands(event.detail);
    };
    window.addEventListener(ITEM_COMMAND_EVENT, captureCommand);
    document.body.append(container);

    try {
      await act(() => {
        render(
          <App
            bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
            showCombatPrototype
          />,
          container,
        );
      });
      await publishItemHud(itemHudModel);
      await act(() => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Inventory"))
          ?.click();
      });

      expect(
        container.querySelectorAll(".inventory-grid .inventory-slot"),
      ).toHaveLength(12);
      expect(
        container.querySelectorAll(".equipment-list .equipment-slot"),
      ).toHaveLength(9);
      expect(container.textContent).toContain("Maximum health124");
      expect(container.textContent).toContain("Outgoing damage112%");

      const cleaver = container.querySelector<HTMLButtonElement>(
        '[aria-label*="Tempered Worn Cleaver"]',
      );
      await act(() => cleaver?.focus());
      const tooltip = container.querySelector('[data-testid="item-tooltip"]');
      expect(tooltip?.textContent).toContain(
        "Tempered Worn Cleaver of Steadfast Grip",
      );
      expect(tooltip?.textContent).toContain("rare");
      expect(tooltip?.textContent).toContain("Main hand · Melee weapon");
      expect(tooltip?.textContent).toContain(
        "Base +5% outgoing ability damage",
      );
      expect(tooltip?.textContent).toContain(
        "Affix +7% outgoing ability damage",
      );

      await act(() => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.startsWith("Equip Tempered"))
          ?.click();
      });
      await act(() => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === "Unequip Chest")
          ?.click();
      });
      expect(commands).toHaveBeenNthCalledWith(1, {
        type: "item.equip",
        inventoryIndex: 0,
      });
      expect(commands).toHaveBeenNthCalledWith(2, {
        type: "item.unequip",
        equipmentSlot: "chest",
      });
    } finally {
      window.removeEventListener(ITEM_COMMAND_EVENT, captureCommand);
    }
  });

  it("emits stone creation and owned-only loadout assignment commands", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    const commands = vi.fn<(command: ItemUiCommand) => void>();
    const captureCommand = (event: CustomEvent<ItemUiCommand>) => {
      commands(event.detail);
    };
    window.addEventListener(ITEM_COMMAND_EVENT, captureCommand);
    document.body.append(container);

    try {
      await act(() => {
        render(
          <App
            bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
            showCombatPrototype
          />,
          container,
        );
      });
      await publishItemHud(itemHudModel);
      await act(() => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Inventory"))
          ?.click();
      });
      await act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Inventory slot 2, Ability Stone"]',
          )
          ?.click();
      });

      const stoneButtons = Array.from(
        container.querySelectorAll(".stone-choice button"),
        (button) => button.textContent,
      );
      expect(stoneButtons).toEqual([
        "Create Cinder Dart",
        "Create Winter Pulse",
      ]);
      await act(() => {
        Array.from(
          container.querySelectorAll<HTMLButtonElement>(".stone-choice button"),
        )
          .find((button) => button.textContent === "Create Cinder Dart")
          ?.click();
      });

      const qAssignment = container.querySelector<HTMLSelectElement>(
        '[aria-label="Assign Q ability"]',
      );
      expect(
        qAssignment?.querySelector(
          'option[value="ability:cinder-dart"][disabled]',
        ),
      ).not.toBeNull();
      expect(
        qAssignment?.querySelector('option[value="ability:winter-pulse"]'),
      ).toBeNull();
      if (qAssignment !== null) {
        qAssignment.value = "ability:defiant-signal";
        await act(() => {
          qAssignment.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }

      expect(commands).toHaveBeenNthCalledWith(1, {
        type: "item.consume-ability-stone",
        inventoryIndex: 1,
        abilityId: "ability:cinder-dart",
      });
      expect(commands).toHaveBeenNthCalledWith(2, {
        type: "item.assign-ability",
        loadoutSlot: "q",
        abilityId: "ability:defiant-signal",
      });
      expect(container.textContent).toContain("Borrowed default");
      expect(
        container.querySelectorAll(
          '[data-testid="combat-flask-slots"] .combat-flask-slot',
        ),
      ).toHaveLength(4);
      expect(
        Array.from(container.querySelectorAll(".combat-flask-slot"), (slot) =>
          slot.getAttribute("aria-label"),
        ),
      ).toEqual([
        "Flask slot 1, not implemented",
        "Flask slot 2, not implemented",
        "Flask slot 3, not implemented",
        "Flask slot 4, not implemented",
      ]);
    } finally {
      window.removeEventListener(ITEM_COMMAND_EVENT, captureCommand);
    }
  });
});

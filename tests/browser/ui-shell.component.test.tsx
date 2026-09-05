import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { installKeyboardCapture } from "../../src/adapters/browser/keyboard-capture";
import { createReadModelChannel } from "../../src/adapters/ui/read-model-channel";
import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_LABELS,
  ATTRIBUTE_SUMMARIES,
  INVENTORY_SLOT_COUNT,
  PASSIVE_CATALOG,
  WAKESHORE_LANDING_ID,
} from "../../src/core";
import { App } from "../../src/presentation/App";
import type {
  CharacterHudReadModel,
  CombatHudReadModel,
  InventoryHudReadModel,
  ItemUiCommand,
  ProfessionUiCommand,
  ProgressionUiCommand,
  ShellBindings,
  ShellReadModel,
  WorldUiCommand,
} from "../../src/presentation/shell-contracts";
import {
  CHARACTER_HUD_EVENT,
  ITEM_COMMAND_EVENT,
  ITEM_HUD_EVENT,
  PROFESSION_COMMAND_EVENT,
  PROGRESSION_COMMAND_EVENT,
  WORLD_COMMAND_EVENT,
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
  level: 1,
  experienceCurrent: 0,
  experienceToNextLevel: 40,
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
      keyLabel: "R",
      accessibleKeyLabel: "R",
      name: "Defiant Signal",
      manaCost: 20,
      cooldownRemainingSeconds: 0,
      cooldownMaximumSeconds: 5,
      state: "ready",
    },
  ],
  activeStatuses: [],
  gatheringLabel: null,
  gatheringProgress: 0,
  zoneName: "Ashtrail Expanse",
  questLabel: null,
  tutorial: null,
  minimap: {
    width: 1_200,
    height: 800,
    floorColor: "#10263a",
    edgeColor: "#64d8cb",
    walkable: { x: 18, y: 18, width: 1_164, height: 764 },
    markers: [
      { id: "player", kind: "player", x: 600, y: 400 },
      {
        id: "enemy:ashtrail-gnasher-1",
        kind: "enemy",
        x: 820,
        y: 390,
        rank: "normal",
      },
      {
        id: "enemy:ashtrail-brute",
        kind: "enemy",
        x: 920,
        y: 520,
        rank: "elite",
      },
      { id: "portal:ashtrail-to-hearthmere", kind: "portal", x: 80, y: 400 },
    ],
  },
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
            requiredLevel: 2,
            origin: "loot" as const,
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
          : index === 2
            ? {
                kind: "equipment" as const,
                instanceId: "item-instance:loopband",
                displayName: "Hearty Plain Loopband",
                rarity: "magic" as const,
                slotKind: "ring" as const,
                typeLabel: "Ring",
                requiredLevel: 1,
                origin: "loot" as const,
                modifiers: [
                  {
                    id: "affix:hearty",
                    source: "affix" as const,
                    label: "+11 maximum health",
                    tier: 1,
                  },
                ],
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
        requiredLevel: 1,
        origin: "loot",
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
  flaskSlots: [
    { slot: "flask-1", label: "Flask 1", item: null },
    { slot: "flask-2", label: "Flask 2", item: null },
    { slot: "flask-3", label: "Flask 3", item: null },
    { slot: "flask-4", label: "Flask 4", item: null },
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
      slot: "r",
      keyLabel: "R",
      accessibleKeyLabel: "R",
      abilityId: "ability:defiant-signal",
      displayName: "Defiant Signal",
      borrowedDefault: false,
    },
  ],
  playerMaximumHealth: 124,
  outgoingAbilityDamagePercent: 112,
};

const characterHudModel: CharacterHudReadModel = {
  revision: 1,
  level: 2,
  experienceCurrent: 20,
  experienceToNextLevel: 60,
  unspentAttributePoints: 3,
  unspentPassivePoints: 1,
  attributes: ATTRIBUTE_IDS.map((id, index) => ({
    id,
    label: ATTRIBUTE_LABELS[id],
    summary: ATTRIBUTE_SUMMARIES[id],
    allocated: index === 2 ? 1 : 0,
  })),
  passives: PASSIVE_CATALOG.map((passive) => ({
    id: passive.id,
    displayName: passive.displayName,
    summary: passive.summary,
    rank: 0,
    maximumRank: passive.maximumRank,
  })),
  maximumHealth: 130,
  maximumMana: 104,
  outgoingAbilityDamagePercent: 112,
  moveSpeedPercent: 100,
  abilityChoices: itemHudModel.abilityChoices,
  loadout: itemHudModel.loadout,
  professions: [
    {
      id: "mining",
      label: "Mining",
      level: 1,
      experienceCurrent: 0,
      experienceToNextLevel: 20,
    },
    {
      id: "smithing",
      label: "Smithing",
      level: 1,
      experienceCurrent: 0,
      experienceToNextLevel: 20,
    },
  ],
  forgeOpen: false,
  recipes: [],
  vendorOpen: false,
  vendorOffers: [],
  quest: {
    id: "quest:hollowdeep-culling",
    displayName: "Hollowdeep Culling",
    summary: "Slay the Hollowdeep Bruiser and return to the Roadwarden.",
    stage: "inactive",
  },
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

async function publishCharacterHud(
  model: CharacterHudReadModel,
): Promise<void> {
  await act(() => {
    window.dispatchEvent(
      new CustomEvent<CharacterHudReadModel>(CHARACTER_HUD_EVENT, {
        detail: model,
      }),
    );
  });
}

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      pointerId: 7,
      isPrimary: true,
      button: 0,
    }),
  );
}

function centerOf(element: Element): { x: number; y: number } {
  element.scrollIntoView({ block: "center" });
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

async function dragTo(source: Element, destination: Element): Promise<void> {
  const from = centerOf(source);
  await act(() => {
    dispatchPointer(source, "pointerdown", from.x, from.y);
  });
  await act(() => {
    dispatchPointer(window, "pointermove", from.x + 16, from.y + 16);
  });
  const to = centerOf(destination);
  await act(() => {
    dispatchPointer(window, "pointermove", to.x, to.y);
  });
  await act(() => {
    dispatchPointer(window, "pointerup", to.x, to.y);
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

  it("shows the tutorial prompt block only while a tutorial step is active", async () => {
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

    expect(
      container.querySelector('[data-testid="combat-tutorial"]'),
    ).toBeNull();

    await publishCombatHud({
      ...combatHudModel,
      tutorial: {
        stepId: "move",
        prompt: "Move with W, A, S, and D.",
        stepsCompleted: 0,
        totalSteps: 6,
      },
    });

    const tutorial = container.querySelector('[data-testid="combat-tutorial"]');
    expect(tutorial).not.toBeNull();
    expect(tutorial?.getAttribute("data-step-id")).toBe("move");
    expect(tutorial?.textContent).toContain("Step 1 of 6");
    expect(
      container.querySelector('[data-testid="combat-tutorial-prompt"]')
        ?.textContent,
    ).toBe("Move with W, A, S, and D.");

    await publishCombatHud({ ...combatHudModel, tutorial: null });
    expect(
      container.querySelector('[data-testid="combat-tutorial"]'),
    ).toBeNull();
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
      '[role="progressbar"][aria-label="Experience"]',
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
    expect(experienceMeter?.getAttribute("aria-valuemax")).toBe("40");
    expect(experienceMeter?.getAttribute("aria-valuetext")).toBe(
      "Level 1, 0 of 40 experience",
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
    const minimap = container.querySelector('[data-testid="combat-minimap"]');
    expect(minimap).not.toBeNull();
    const bounds = minimap?.querySelector(
      '[data-testid="combat-minimap-bounds"]',
    );
    const floor = minimap?.querySelector(".combat-minimap-floor");
    expect(bounds).not.toBeNull();
    expect(floor?.getAttribute("fill")).toBe("#10263a");
    expect(bounds?.getAttribute("stroke")).toBe("#64d8cb");
    expect(minimap?.querySelectorAll("[data-kind='enemy']")).toHaveLength(2);
    expect(minimap?.querySelector("[data-rank='elite']")).not.toBeNull();
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
    ).toEqual(["LMB", "Q", "E", "R"]);
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

  it("toggles Inventory with I from anywhere outside text entry", async () => {
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
    expect(inventoryButton?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Opens even when focus is outside the canvas.
    inventoryButton?.focus();
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
      );
    });
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(inventoryButton?.getAttribute("aria-expanded")).toBe("true");

    // I toggles the open menu closed and restores canvas focus.
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(canvas);

    // Modifier chords never toggle.
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          code: "KeyI",
          ctrlKey: true,
        }),
      );
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();

    // Typing "i" into a text-entry element never toggles.
    const input = document.createElement("input");
    document.body.append(input);
    try {
      input.focus();
      await act(() => {
        input.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
        );
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    } finally {
      input.remove();
    }

    // Escape still closes and restores canvas focus.
    canvas?.focus();
    await act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
      );
    });
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
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
      ).toHaveLength(INVENTORY_SLOT_COUNT);
      expect(container.querySelector(".inventory-grid-scroll")).not.toBeNull();
      expect(
        container.querySelectorAll(".paper-doll > .equipment-slot"),
      ).toHaveLength(9);
      expect(
        container.querySelectorAll(
          "[data-testid='inventory-flask-slots'] .equipment-slot",
        ),
      ).toHaveLength(4);
      // Every slot is addressable as a drop target with its concrete slot ID.
      expect(
        Array.from(
          container.querySelectorAll(".paper-doll [data-drop-equipment-slot]"),
          (slot) => slot.getAttribute("data-drop-equipment-slot"),
        ).sort(),
      ).toEqual([
        "amulet",
        "belt",
        "boots",
        "chest",
        "flask-1",
        "flask-2",
        "flask-3",
        "flask-4",
        "helmet",
        "main-hand",
        "offhand",
        "ring-1",
        "ring-2",
      ]);
      expect(
        container.querySelector('[data-testid="inventory-menu"]')?.textContent,
      ).not.toContain("Combat loadout");
      expect(container.textContent).not.toContain("Maximum health");
      expect(container.textContent).not.toContain("Outgoing damage");
      expect(
        container.querySelectorAll(
          "[data-testid='inventory-flask-slots'] .paper-doll-flask",
        ),
      ).toHaveLength(4);

      const cleaver = container.querySelector<HTMLButtonElement>(
        '[aria-label*="Tempered Worn Cleaver"]',
      );
      await act(() => cleaver?.focus());
      const tooltip = container.querySelector('[data-testid="item-tooltip"]');
      expect(tooltip?.textContent).toContain(
        "Tempered Worn Cleaver of Steadfast Grip",
      );
      expect(tooltip?.textContent).toContain("rare");
      expect(tooltip?.textContent).toContain(
        "Main hand · Melee weapon · Requires level 2",
      );
      expect(tooltip?.textContent).toContain(
        "Base +5% outgoing ability damage",
      );
      expect(tooltip?.textContent).toContain(
        "Affix +7% outgoing ability damage",
      );
      // Affix lines carry a compact tier marker; base lines never do.
      expect(
        tooltip?.querySelector('li[data-source="affix"] .affix-tier')
          ?.textContent,
      ).toBe("T2");
      expect(
        tooltip?.querySelector('li[data-source="base"] .affix-tier'),
      ).toBeNull();

      await act(() => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.startsWith("Equip Tempered"))
          ?.click();
      });
      await act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Chest, Reinforced Trailguard Vest"]',
          )
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

      // A selected ring offers an explicit per-ring-slot equip choice.
      await act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Inventory slot 3, Hearty Plain Loopband"]',
          )
          ?.click();
      });
      expect(
        tooltip?.querySelector('li[data-source="affix"] .affix-tier')
          ?.textContent,
      ).toBe("T1");
      await act(() => {
        Array.from(container.querySelectorAll("button"))
          .find(
            (button) =>
              button.textContent === "Equip Hearty Plain Loopband to Ring 2",
          )
          ?.click();
      });
      expect(commands).toHaveBeenNthCalledWith(3, {
        type: "item.equip",
        inventoryIndex: 2,
        targetEquipmentSlot: "ring-2",
      });
    } finally {
      window.removeEventListener(ITEM_COMMAND_EVENT, captureCommand);
    }
  });

  it("drag-equips, rejects incompatible drops, and drag-unequips items", async () => {
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

      const cleaver = container.querySelector(
        '[aria-label="Inventory slot 1, Tempered Worn Cleaver of Steadfast Grip"]',
      );
      const mainHand = container.querySelector(
        '[data-drop-equipment-slot="main-hand"]',
      );
      const helmet = container.querySelector(
        '[data-drop-equipment-slot="helmet"]',
      );
      if (cleaver === null || mainHand === null || helmet === null) {
        throw new Error("Drag fixtures were missing from the item menu.");
      }

      // Mid-drag affordances: only kind-compatible slots read as valid.
      const from = centerOf(cleaver);
      await act(() => {
        dispatchPointer(cleaver, "pointerdown", from.x, from.y);
      });
      await act(() => {
        dispatchPointer(window, "pointermove", from.x + 16, from.y + 16);
      });
      expect(
        document.querySelector('[data-testid="drag-ghost"]'),
      ).not.toBeNull();
      expect(mainHand.classList.contains("drop-valid")).toBe(true);
      expect(helmet.classList.contains("drop-invalid")).toBe(true);

      const to = centerOf(mainHand);
      await act(() => {
        dispatchPointer(window, "pointermove", to.x, to.y);
      });
      await act(() => {
        dispatchPointer(window, "pointerup", to.x, to.y);
      });
      expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull();
      expect(commands).toHaveBeenCalledExactlyOnceWith({
        type: "item.equip",
        inventoryIndex: 0,
        targetEquipmentSlot: "main-hand",
      });
      commands.mockClear();

      // Dropping on an incompatible slot emits nothing.
      await dragTo(cleaver, helmet);
      expect(commands).not.toHaveBeenCalled();

      // Rings can target a specific ring slot by dropping on it.
      const ring = container.querySelector(
        '[aria-label="Inventory slot 3, Hearty Plain Loopband"]',
      );
      const ringTwo = container.querySelector(
        '[data-drop-equipment-slot="ring-2"]',
      );
      if (ring === null || ringTwo === null) {
        throw new Error("Ring drag fixtures were missing.");
      }
      await dragTo(ring, ringTwo);
      expect(commands).toHaveBeenCalledExactlyOnceWith({
        type: "item.equip",
        inventoryIndex: 2,
        targetEquipmentSlot: "ring-2",
      });
      commands.mockClear();

      // Dragging an equipped item onto the inventory area unequips it.
      const chest = container.querySelector(
        '[data-drop-equipment-slot="chest"]',
      );
      const inventoryArea = container.querySelector("[data-drop-inventory]");
      if (chest === null || inventoryArea === null) {
        throw new Error("Unequip drag fixtures were missing.");
      }
      await dragTo(chest, inventoryArea);
      expect(commands).toHaveBeenCalledExactlyOnceWith({
        type: "item.unequip",
        equipmentSlot: "chest",
      });
      commands.mockClear();

      // Ability Stones are not equipment and never start a drag.
      const stone = container.querySelector(
        '[aria-label="Inventory slot 2, Ability Stone"]',
      );
      if (stone === null) {
        throw new Error("Ability Stone fixture was missing.");
      }
      await dragTo(stone, mainHand);
      expect(document.querySelector('[data-testid="drag-ghost"]')).toBeNull();
      expect(commands).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(ITEM_COMMAND_EVENT, captureCommand);
    }
  });

  it("emits stone creation commands and keeps flask slots reserved", async () => {
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

      expect(commands).toHaveBeenCalledExactlyOnceWith({
        type: "item.consume-ability-stone",
        inventoryIndex: 1,
        abilityId: "ability:cinder-dart",
      });
      expect(container.textContent).not.toContain("Combat loadout");
      expect(
        container.querySelector('[aria-label="Assign Q ability"]'),
      ).toBeNull();
      expect(
        container.querySelectorAll(
          '[data-testid="combat-flask-slots"] .combat-flask-slot',
        ),
      ).toHaveLength(4);
      expect(
        container.querySelectorAll(
          "[data-testid='inventory-flask-slots'] .paper-doll-flask",
        ),
      ).toHaveLength(4);
      expect(
        Array.from(
          container.querySelectorAll(
            "[data-testid='inventory-flask-slots'] [data-drop-equipment-slot]",
          ),
          (slot) => slot.getAttribute("aria-label"),
        ),
      ).toEqual([
        "Flask 1, empty",
        "Flask 2, empty",
        "Flask 3, empty",
        "Flask 4, empty",
      ]);
    } finally {
      window.removeEventListener(ITEM_COMMAND_EVENT, captureCommand);
    }
  });

  it("opens Character with C, spends points, and assigns the combat loadout", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    const itemCommands = vi.fn<(command: ItemUiCommand) => void>();
    const progressionCommands =
      vi.fn<(command: ProgressionUiCommand) => void>();
    const captureItem = (event: CustomEvent<ItemUiCommand>) => {
      itemCommands(event.detail);
    };
    const captureProgression = (event: CustomEvent<ProgressionUiCommand>) => {
      progressionCommands(event.detail);
    };
    window.addEventListener(ITEM_COMMAND_EVENT, captureItem);
    window.addEventListener(PROGRESSION_COMMAND_EVENT, captureProgression);
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
      await publishCharacterHud(characterHudModel);

      const inventoryButton = container.querySelector(".inventory-menu-toggle");
      const characterButton = container.querySelector(".character-menu-toggle");
      expect(characterButton?.getAttribute("aria-keyshortcuts")).toBe("C");
      expect(characterButton?.textContent).toContain("Character");
      expect(inventoryButton).not.toBeNull();
      expect(characterButton).not.toBeNull();
      expect(
        characterButton!.compareDocumentPosition(inventoryButton!) &
          Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();

      await act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, code: "KeyC" }),
        );
      });
      const dialog = container.querySelector('[data-testid="character-menu"]');
      expect(dialog).not.toBeNull();
      expect(dialog?.textContent).toContain("Level 2");
      expect(dialog?.textContent).toContain("Attributes · 3 unspent");
      expect(dialog?.textContent).toContain("Masteries · 1 unspent");
      expect(dialog?.textContent).toContain("Combat loadout");
      expect(dialog?.textContent).toContain("Restore Training");
      expect(dialog?.textContent).toContain("Mining 1");
      expect(dialog?.textContent).toContain("Smithing 1");
      expect(dialog?.textContent).toContain("Hollowdeep Culling");

      await act(() => {
        container
          .querySelector<HTMLButtonElement>('[aria-label="Increase Strength"]')
          ?.click();
      });
      expect(progressionCommands).toHaveBeenCalledWith({
        type: "progression.allocate-attribute",
        attribute: "strength",
      });

      await act(() => {
        Array.from(dialog?.querySelectorAll("button") ?? [])
          .find((button) => button.textContent === "Train")
          ?.click();
      });
      expect(progressionCommands).toHaveBeenCalledWith({
        type: "progression.allocate-passive",
        passiveId: PASSIVE_CATALOG[0]!.id,
      });

      await act(() => {
        Array.from(dialog?.querySelectorAll("button") ?? [])
          .find((button) => button.textContent === "Defiant Signal")
          ?.click();
      });
      expect(itemCommands).toHaveBeenCalledWith({
        type: "item.assign-ability",
        loadoutSlot: "lmb",
        abilityId: "ability:defiant-signal",
      });

      await act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
        );
      });
      expect(
        container.querySelector('[data-testid="character-menu"]'),
      ).toBeNull();
      expect(
        container.querySelector('[data-testid="inventory-menu"]'),
      ).not.toBeNull();
    } finally {
      window.removeEventListener(ITEM_COMMAND_EVENT, captureItem);
      window.removeEventListener(PROGRESSION_COMMAND_EVENT, captureProgression);
    }
  });

  it("shows gathering feedback, material tooltips, and a forge craft menu", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    const professionCommands = vi.fn<(command: ProfessionUiCommand) => void>();
    const captureProfession = (event: CustomEvent<ProfessionUiCommand>) => {
      professionCommands(event.detail);
    };
    window.addEventListener(PROFESSION_COMMAND_EVENT, captureProfession);
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
      await publishCombatHud({
        ...combatHudModel,
        gatheringLabel: "Veinshard Outcrop",
        gatheringProgress: 0.5,
      });
      expect(
        container.querySelector('[data-testid="combat-gathering"]')
          ?.textContent,
      ).toContain("Veinshard Outcrop");

      await publishItemHud({
        ...itemHudModel,
        inventorySlots: itemHudModel.inventorySlots.map((slot) =>
          slot.index === 3
            ? {
                index: 3,
                item: {
                  kind: "material",
                  instanceId: "item-instance:veinshard",
                  displayName: "Veinshard Ore",
                  rarity: "common",
                  typeLabel: "Material",
                  quantity: 3,
                  summary: "Common ore used for Tempering crafts",
                },
              }
            : slot,
        ),
      });
      await act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
        );
      });
      await act(() => {
        container
          .querySelector<HTMLButtonElement>(
            '[aria-label="Inventory slot 4, Veinshard Ore"]',
          )
          ?.click();
      });
      const tooltip = container.querySelector('[data-testid="item-tooltip"]');
      expect(tooltip?.textContent).toContain("Veinshard Ore");
      expect(tooltip?.textContent).toContain(
        "Common ore used for Tempering crafts",
      );
      expect(tooltip?.textContent).toContain("Stack 3");

      await act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, code: "Escape" }),
        );
      });
      await publishCharacterHud({
        ...characterHudModel,
        forgeOpen: true,
        recipes: [
          {
            id: "recipe:tempering-cleaver",
            displayName: "Tempering Cleaver",
            summary: "A forged main-hand with a stronger damage implicit",
            requiredSmithingLevel: 1,
            ingredients: [
              {
                materialId: "material:veinshard-ore",
                displayName: "Veinshard Ore",
                required: 3,
                owned: 3,
              },
            ],
            canCraft: true,
            blockedReason: null,
          },
        ],
      });
      const craftMenu = container.querySelector('[data-testid="craft-menu"]');
      expect(craftMenu).not.toBeNull();
      expect(craftMenu?.textContent).toContain("Tempering Forge");
      expect(craftMenu?.textContent).toContain("Tempering Cleaver");
      await act(() => {
        Array.from(craftMenu?.querySelectorAll("button") ?? [])
          .find((button) => button.textContent === "Forge")
          ?.click();
      });
      expect(professionCommands).toHaveBeenCalledWith({
        type: "profession.craft",
        recipeId: "recipe:tempering-cleaver",
      });
    } finally {
      window.removeEventListener(PROFESSION_COMMAND_EVENT, captureProfession);
    }
  });
  it("boots into the menu shell state and New Game travels to the tutorial", async () => {
    const channel = createReadModelChannel(readyModel);
    const container = document.createElement("div");
    const worldCommands = vi.fn<(command: WorldUiCommand) => void>();
    const captureWorld = (event: CustomEvent<WorldUiCommand>) => {
      worldCommands(event.detail);
    };
    window.addEventListener(WORLD_COMMAND_EVENT, captureWorld);
    document.body.append(container);

    try {
      await act(() => {
        render(
          <App
            bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
            showCombatPrototype
            showMainMenu
          />,
          container,
        );
      });

      const menu = container.querySelector('[data-testid="main-menu"]');
      expect(menu).not.toBeNull();
      expect(menu?.getAttribute("aria-modal")).toBe("true");
      expect(
        menu?.querySelector<HTMLImageElement>(".main-menu-logo")?.alt,
      ).toBe("Loot Divers");
      const newGame = menu?.querySelector<HTMLButtonElement>(
        '[data-testid="main-menu-new-game"]',
      );
      const continueButton = menu?.querySelector<HTMLButtonElement>(
        '[data-testid="main-menu-continue"]',
      );
      expect(newGame?.disabled).toBe(false);
      expect(document.activeElement).toBe(newGame);
      expect(continueButton?.disabled).toBe(true);
      expect(menu?.textContent).toContain("No saved hero yet");

      // Gameplay menu shortcuts stay inert while the main menu gates entry.
      await act(() => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, code: "KeyI" }),
        );
      });
      expect(
        container.querySelector('[data-testid="inventory-menu"]'),
      ).toBeNull();

      // The disabled Continue slot emits nothing.
      await act(() => continueButton?.click());
      expect(worldCommands).not.toHaveBeenCalled();

      await act(() => newGame?.click());
      expect(worldCommands).toHaveBeenCalledExactlyOnceWith({
        type: "world.travel",
        zoneId: WAKESHORE_LANDING_ID,
      });
      expect(container.querySelector('[data-testid="main-menu"]')).toBeNull();
    } finally {
      window.removeEventListener(WORLD_COMMAND_EVENT, captureWorld);
      // The shared afterEach never unmounts child-container roots, so the
      // menu App's window listeners and focus effects must be torn down here.
      render(null, container);
    }
  });

  it("disables New Game until the renderer is ready and never menus automation", async () => {
    const loadingModel: ShellReadModel = {
      ...readyModel,
      phase: { kind: "loading", message: "Synthetic loading fixture" },
    };
    const channel = createReadModelChannel(loadingModel);
    const container = document.createElement("div");
    const bare = document.createElement("div");
    document.body.append(container, bare);
    try {
      await act(() => {
        render(
          <App
            bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
            showCombatPrototype
            showMainMenu
          />,
          container,
        );
      });

      const newGame = container.querySelector<HTMLButtonElement>(
        '[data-testid="main-menu-new-game"]',
      );
      expect(newGame?.disabled).toBe(true);

      await act(() => {
        channel.publisher.publish(readyModel);
      });
      expect(newGame?.disabled).toBe(false);

      // Without the menu prop (automation and fixture modes) no menu renders.
      await act(() => {
        render(
          <App
            bindings={{ models: channel.source, intents: { emit: vi.fn() } }}
            showCombatPrototype
          />,
          bare,
        );
      });
      expect(bare.querySelector('[data-testid="main-menu"]')).toBeNull();
    } finally {
      // The shared afterEach never unmounts child-container roots, so the
      // menu App's window listeners and focus effects must be torn down here.
      render(null, container);
      render(null, bare);
    }
  });
});

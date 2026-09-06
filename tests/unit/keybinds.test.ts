import { describe, expect, it } from "vitest";

import {
  DEFAULT_KEYBINDS,
  KEYBIND_ACTIONS,
  KEYBINDS_STORAGE_KEY,
  KeybindsStore,
  RESERVED_KEYBIND_CODES,
  isMovementKeybindAction,
  keyCodeLabel,
  parseStoredKeybinds,
  type KeybindsStorage,
} from "../../src/presentation/keybinds";

/** In-memory Storage stand-in for persistence round-trip tests. */
function fakeStorage(initial: Record<string, string> = {}): KeybindsStorage & {
  readonly data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

describe("keybind defaults", () => {
  it("cover every action exactly once with no duplicate codes", () => {
    const codes = KEYBIND_ACTIONS.map((action) => DEFAULT_KEYBINDS[action]);
    expect(codes).toHaveLength(KEYBIND_ACTIONS.length);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("never assign a reserved code", () => {
    for (const action of KEYBIND_ACTIONS) {
      expect(RESERVED_KEYBIND_CODES.has(DEFAULT_KEYBINDS[action])).toBe(false);
    }
  });

  it("classify exactly the four movement actions", () => {
    expect(
      KEYBIND_ACTIONS.filter((action) => isMovementKeybindAction(action)),
    ).toEqual(["move-up", "move-down", "move-left", "move-right"]);
  });
});

describe("keyCodeLabel", () => {
  it("shortens letter, digit, numpad, and named codes", () => {
    expect(keyCodeLabel("KeyW")).toBe("W");
    expect(keyCodeLabel("Digit5")).toBe("5");
    expect(keyCodeLabel("Numpad7")).toBe("Num 7");
    expect(keyCodeLabel("Space")).toBe("Space");
    expect(keyCodeLabel("ArrowLeft")).toBe("Arrow Left");
    expect(keyCodeLabel("F5")).toBe("F5");
  });
});

describe("KeybindsStore mapping", () => {
  it("resolves codes to actions and actions to codes", () => {
    const store = new KeybindsStore();
    expect(store.codeFor("dodge")).toBe("Space");
    expect(store.actionFor("Space")).toBe("dodge");
    expect(store.actionFor("KeyZ")).toBeNull();
    expect(store.label("flask-1")).toBe("1");
    expect(store.isDefault()).toBe(true);
  });

  it("rebinds a free key and reports no swap", () => {
    const store = new KeybindsStore();
    const result = store.rebind("flask-1", "Digit5");
    expect(result).toEqual({
      accepted: true,
      action: "flask-1",
      code: "Digit5",
      swappedAction: null,
      swappedCode: null,
    });
    expect(store.actionFor("Digit5")).toBe("flask-1");
    expect(store.actionFor("Digit1")).toBeNull();
    expect(store.isDefault()).toBe(false);
  });

  it("swaps keys when the requested key is already taken", () => {
    const store = new KeybindsStore();
    const result = store.rebind("dodge", "KeyW");
    expect(result).toEqual({
      accepted: true,
      action: "dodge",
      code: "KeyW",
      swappedAction: "move-up",
      swappedCode: "Space",
    });
    expect(store.codeFor("dodge")).toBe("KeyW");
    expect(store.codeFor("move-up")).toBe("Space");
    // Every action still holds exactly one key.
    const codes = KEYBIND_ACTIONS.map((action) => store.codeFor(action));
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("treats rebinding an action to its own key as an accepted no-op", () => {
    const storage = fakeStorage();
    const store = new KeybindsStore(storage);
    const result = store.rebind("dodge", "Space");
    expect(result.accepted).toBe(true);
    expect(store.codeFor("dodge")).toBe("Space");
    // No-op writes nothing.
    expect(storage.data.size).toBe(0);
  });

  it("rejects Escape and pure modifier keys", () => {
    const store = new KeybindsStore();
    for (const code of ["Escape", "ShiftLeft", "ControlRight", "MetaLeft"]) {
      expect(store.rebind("dodge", code)).toEqual({
        accepted: false,
        reason: "reserved-code",
      });
    }
    expect(store.codeFor("dodge")).toBe("Space");
  });

  it("restores defaults and notifies subscribers", () => {
    const store = new KeybindsStore();
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.rebind("interact", "KeyG");
    expect(notified).toBe(1);
    store.resetToDefaults();
    expect(notified).toBe(2);
    expect(store.isDefault()).toBe(true);
    unsubscribe();
    store.rebind("interact", "KeyG");
    expect(notified).toBe(2);
  });
});

describe("KeybindsStore persistence", () => {
  it("round-trips a customized mapping through storage", () => {
    const storage = fakeStorage();
    const store = new KeybindsStore(storage);
    store.rebind("flask-1", "Digit5");
    store.rebind("dodge", "KeyW"); // swaps with move-up

    const reloaded = new KeybindsStore(storage);
    expect(reloaded.codeFor("flask-1")).toBe("Digit5");
    expect(reloaded.codeFor("dodge")).toBe("KeyW");
    expect(reloaded.codeFor("move-up")).toBe("Space");
    expect(reloaded.codeFor("interact")).toBe("KeyF");
  });

  it("reset removes the storage entry so a reload sees defaults", () => {
    const storage = fakeStorage();
    const store = new KeybindsStore(storage);
    store.rebind("flask-1", "Digit5");
    expect(storage.data.has(KEYBINDS_STORAGE_KEY)).toBe(true);
    store.resetToDefaults();
    expect(storage.data.has(KEYBINDS_STORAGE_KEY)).toBe(false);
    expect(new KeybindsStore(storage).isDefault()).toBe(true);
  });

  it("survives a throwing storage without breaking rebinds", () => {
    const store = new KeybindsStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(store.isDefault()).toBe(true);
    expect(store.rebind("dodge", "KeyX").accepted).toBe(true);
    expect(store.codeFor("dodge")).toBe("KeyX");
    store.resetToDefaults();
    expect(store.isDefault()).toBe(true);
  });
});

describe("parseStoredKeybinds", () => {
  it("merges stored bindings over defaults and ignores unknown actions", () => {
    const parsed = parseStoredKeybinds(
      JSON.stringify({
        version: 1,
        bindings: { "flask-1": "Digit5", "not-an-action": "KeyZ" },
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.["flask-1"]).toBe("Digit5");
    expect(parsed?.["move-up"]).toBe("KeyW");
  });

  it.each([
    ["null input", null],
    ["invalid JSON", "{not json"],
    ["non-object", JSON.stringify(7)],
    ["wrong version", JSON.stringify({ version: 2, bindings: {} })],
    ["missing bindings", JSON.stringify({ version: 1 })],
    [
      "reserved code",
      JSON.stringify({ version: 1, bindings: { dodge: "Escape" } }),
    ],
    ["non-string code", JSON.stringify({ version: 1, bindings: { dodge: 4 } })],
    [
      "duplicate assignment",
      JSON.stringify({ version: 1, bindings: { dodge: "KeyW" } }),
    ],
  ])("rejects %s so the store falls back to defaults", (_name, raw) => {
    expect(parseStoredKeybinds(raw)).toBeNull();
  });

  it("feeds a corrupt payload store back to defaults", () => {
    const storage = fakeStorage({ [KEYBINDS_STORAGE_KEY]: "{corrupt" });
    expect(new KeybindsStore(storage).isDefault()).toBe(true);
  });
});

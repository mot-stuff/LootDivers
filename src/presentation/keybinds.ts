/**
 * TASK-715 (DEC-041) keyboard binding module.
 *
 * One shared, observable mapping from gameplay actions to
 * `KeyboardEvent.code` values. The combat input adapter and the shell key
 * handlers resolve every keyboard event through this module at event time,
 * so a rebind applies immediately without reload. The mapping is a
 * per-device setting persisted in `localStorage` — it is deliberately NOT
 * part of the character save (DEC-034 schema untouched).
 *
 * This file lives in `src/presentation/` because both consumers already
 * depend on this layer (the Phaser adapters import `shell-contracts`), and
 * the module itself is framework-free: plain data, a small store, and an
 * injectable storage seam for tests.
 *
 * Mouse attack aiming and the LMB primary slot are not rebindable in v1;
 * Escape is reserved for the system menu and pure modifier keys are
 * rejected because the input adapters ignore modifier-chorded events.
 */

/** Every rebindable gameplay action (TASK-715 v1 scope). */
export type KeybindAction =
  | "move-up"
  | "move-down"
  | "move-left"
  | "move-right"
  | "dodge"
  | "interact"
  | "ability-q"
  | "ability-e"
  | "ability-r"
  | "flask-1"
  | "flask-2"
  | "flask-3"
  | "flask-4"
  | "toggle-inventory"
  | "toggle-character";

/** Display order for the keybinds settings screen. */
export const KEYBIND_ACTIONS: readonly KeybindAction[] = [
  "move-up",
  "move-down",
  "move-left",
  "move-right",
  "dodge",
  "interact",
  "ability-q",
  "ability-e",
  "ability-r",
  "flask-1",
  "flask-2",
  "flask-3",
  "flask-4",
  "toggle-inventory",
  "toggle-character",
];

export const KEYBIND_ACTION_LABELS: Readonly<Record<KeybindAction, string>> = {
  "move-up": "Move up",
  "move-down": "Move down",
  "move-left": "Move left",
  "move-right": "Move right",
  dodge: "Dodge",
  interact: "Interact / pick up",
  "ability-q": "Ability 1",
  "ability-e": "Ability 2",
  "ability-r": "Ability 3",
  "flask-1": "Flask 1",
  "flask-2": "Flask 2",
  "flask-3": "Flask 3",
  "flask-4": "Flask 4",
  "toggle-inventory": "Inventory",
  "toggle-character": "Character",
};

export const DEFAULT_KEYBINDS: Readonly<Record<KeybindAction, string>> = {
  "move-up": "KeyW",
  "move-down": "KeyS",
  "move-left": "KeyA",
  "move-right": "KeyD",
  dodge: "Space",
  interact: "KeyF",
  "ability-q": "KeyQ",
  "ability-e": "KeyE",
  "ability-r": "KeyR",
  "flask-1": "Digit1",
  "flask-2": "Digit2",
  "flask-3": "Digit3",
  "flask-4": "Digit4",
  "toggle-inventory": "KeyI",
  "toggle-character": "KeyC",
};

const MOVEMENT_ACTIONS = new Set<KeybindAction>([
  "move-up",
  "move-down",
  "move-left",
  "move-right",
]);

export function isMovementKeybindAction(
  action: KeybindAction,
): action is "move-up" | "move-down" | "move-left" | "move-right" {
  return MOVEMENT_ACTIONS.has(action);
}

/**
 * Codes that can never be assigned: Escape opens/closes the system menu,
 * and pure modifier keys are dead binds because both input paths ignore
 * modifier-chorded keyboard events.
 */
export const RESERVED_KEYBIND_CODES: ReadonlySet<string> = new Set([
  "Escape",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

export const KEYBINDS_STORAGE_KEY = "rarpg:keybinds:v1";

const KEY_CODE_LABELS: Readonly<Record<string, string>> = {
  Space: "Space",
  Tab: "Tab",
  Enter: "Enter",
  Backspace: "Backspace",
  CapsLock: "Caps Lock",
  ArrowUp: "Arrow Up",
  ArrowDown: "Arrow Down",
  ArrowLeft: "Arrow Left",
  ArrowRight: "Arrow Right",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/** Short player-facing label for a `KeyboardEvent.code`. */
export function keyCodeLabel(code: string): string {
  const named = KEY_CODE_LABELS[code];
  if (named !== undefined) return named;
  if (code.startsWith("Key") && code.length === 4) return code.slice(3);
  if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}

export type KeybindRebindResult =
  | {
      readonly accepted: true;
      readonly action: KeybindAction;
      readonly code: string;
      /** Action that received the old key when the new key was taken. */
      readonly swappedAction: KeybindAction | null;
      /** The key handed to `swappedAction` (the rebound action's old key). */
      readonly swappedCode: string | null;
    }
  | { readonly accepted: false; readonly reason: "reserved-code" };

export type KeybindsStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

interface StoredKeybinds {
  readonly version: number;
  readonly bindings: Readonly<Partial<Record<KeybindAction, string>>>;
}

function isValidStoredCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !RESERVED_KEYBIND_CODES.has(value)
  );
}

/**
 * Parses a persisted mapping. Unknown actions are ignored and missing
 * actions fall back to their defaults; any invalid shape, reserved code,
 * or duplicate assignment in the merged result rejects the whole payload
 * (returns null) so the store falls back to defaults instead of loading a
 * conflicted state.
 */
export function parseStoredKeybinds(
  raw: string | null,
): Record<KeybindAction, string> | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const stored = parsed as Partial<StoredKeybinds>;
  if (stored.version !== 1) return null;
  if (typeof stored.bindings !== "object" || stored.bindings === null) {
    return null;
  }
  const result: Record<KeybindAction, string> = { ...DEFAULT_KEYBINDS };
  for (const action of KEYBIND_ACTIONS) {
    const code: unknown = stored.bindings[action];
    if (code === undefined) continue;
    if (!isValidStoredCode(code)) return null;
    result[action] = code;
  }
  const codes = new Set(Object.values(result));
  if (codes.size !== KEYBIND_ACTIONS.length) return null;
  return result;
}

/**
 * The observable keybind mapping. Reads resolve against current state, so
 * consumers that translate events through `actionFor`/`codeFor` pick up
 * rebinds immediately. Persistence is best-effort (storage failures are
 * swallowed), mirroring the DEC-014 local-save stance.
 */
export class KeybindsStore {
  #bindings: Record<KeybindAction, string>;
  readonly #storage: KeybindsStorage | null;
  readonly #listeners = new Set<() => void>();

  public constructor(storage: KeybindsStorage | null = null) {
    this.#storage = storage;
    let raw: string | null = null;
    try {
      raw = storage?.getItem(KEYBINDS_STORAGE_KEY) ?? null;
    } catch {
      // Unreadable storage falls back to defaults.
    }
    this.#bindings = parseStoredKeybinds(raw) ?? { ...DEFAULT_KEYBINDS };
  }

  public bindings(): Readonly<Record<KeybindAction, string>> {
    return { ...this.#bindings };
  }

  public codeFor(action: KeybindAction): string {
    return this.#bindings[action];
  }

  /** Resolves a `KeyboardEvent.code` to its bound action, if any. */
  public actionFor(code: string): KeybindAction | null {
    for (const action of KEYBIND_ACTIONS) {
      if (this.#bindings[action] === code) return action;
    }
    return null;
  }

  /** Player-facing label of the key currently bound to `action`. */
  public label(action: KeybindAction): string {
    return keyCodeLabel(this.#bindings[action]);
  }

  public isDefault(): boolean {
    return KEYBIND_ACTIONS.every(
      (action) => this.#bindings[action] === DEFAULT_KEYBINDS[action],
    );
  }

  /**
   * Rebinds `action` to `code`. Reserved codes are rejected; a code held
   * by another action swaps — the other action receives this action's old
   * key — so every action always has exactly one key (DEC-041 swap
   * semantics).
   */
  public rebind(action: KeybindAction, code: string): KeybindRebindResult {
    if (RESERVED_KEYBIND_CODES.has(code) || code.length === 0) {
      return { accepted: false, reason: "reserved-code" };
    }
    const previousCode = this.#bindings[action];
    const holder = this.actionFor(code);
    if (holder === action || previousCode === code) {
      return {
        accepted: true,
        action,
        code,
        swappedAction: null,
        swappedCode: null,
      };
    }
    this.#bindings = { ...this.#bindings, [action]: code };
    let swappedAction: KeybindAction | null = null;
    let swappedCode: string | null = null;
    if (holder !== null) {
      this.#bindings[holder] = previousCode;
      swappedAction = holder;
      swappedCode = previousCode;
    }
    this.persist();
    this.notify();
    return { accepted: true, action, code, swappedAction, swappedCode };
  }

  public resetToDefaults(): void {
    this.#bindings = { ...DEFAULT_KEYBINDS };
    try {
      this.#storage?.removeItem(KEYBINDS_STORAGE_KEY);
    } catch {
      // Best-effort persistence: an unavailable storage never breaks play.
    }
    this.notify();
  }

  /** Subscribes to mapping changes; returns the unsubscribe function. */
  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  private persist(): void {
    try {
      this.#storage?.setItem(
        KEYBINDS_STORAGE_KEY,
        JSON.stringify({ version: 1, bindings: this.#bindings }),
      );
    } catch {
      // Best-effort persistence: an unavailable storage never breaks play.
    }
  }

  private notify(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}

let shared: KeybindsStore | null = null;

/**
 * The device-wide store shared by the input adapter, the shell key
 * handlers, and the system menu. Lazily bound to `window.localStorage`
 * (null storage when unavailable, e.g. blocked third-party contexts).
 */
export function sharedKeybinds(): KeybindsStore {
  if (shared === null) {
    let storage: KeybindsStorage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      // Blocked storage (e.g. sandboxed context): bindings stay in memory.
    }
    shared = new KeybindsStore(storage);
  }
  return shared;
}

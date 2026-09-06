import Phaser from "phaser";

import type { FlaskSlot, LoadoutSlot } from "../../core";
import {
  isMovementKeybindAction,
  sharedKeybinds,
  type KeybindsStore,
} from "../../presentation/keybinds";

/*
 * TASK-715 (DEC-041): keyboard codes resolve through the shared keybinds
 * store at event time, so rebinds from the system menu apply immediately.
 * Ability keybind actions map onto the three keyboard loadout slots; flask
 * keybind actions carry the flask slot ids directly.
 */

export interface CombatInputSnapshot {
  readonly movementX: number;
  readonly movementY: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly hasPointer: boolean;
  readonly dodgeRequested: boolean;
  readonly abilitySlotsRequested: readonly LoadoutSlot[];
  readonly flaskSlotsRequested: readonly FlaskSlot[];
  readonly lootPickupRequested: boolean;
}

export class CombatInputAdapter {
  readonly #held = new Set<string>();
  #pointerX = 0;
  #pointerY = 0;
  #hasPointer = false;
  #dodgeRequested = false;
  readonly #abilitySlotsRequested: LoadoutSlot[] = [];
  readonly #flaskSlotsRequested: FlaskSlot[] = [];
  #lootPickupRequested = false;
  readonly #keyDown = (event: KeyboardEvent): void => {
    if (!this.isGameplayFocused(event)) {
      return;
    }
    const action = this.keybinds.actionFor(event.code);
    if (action === null) {
      return;
    }
    if (isMovementKeybindAction(action)) {
      this.#held.add(event.code);
      event.preventDefault();
    } else if (action === "dodge") {
      if (!event.repeat) {
        this.#dodgeRequested = true;
      }
      event.preventDefault();
    } else if (action === "interact") {
      if (!event.repeat) {
        this.#lootPickupRequested = true;
      }
      event.preventDefault();
    } else if (
      action === "ability-q" ||
      action === "ability-e" ||
      action === "ability-r"
    ) {
      if (!event.repeat) {
        this.#abilitySlotsRequested.push(
          action === "ability-q" ? "q" : action === "ability-e" ? "e" : "r",
        );
      }
      event.preventDefault();
    } else if (
      action === "flask-1" ||
      action === "flask-2" ||
      action === "flask-3" ||
      action === "flask-4"
    ) {
      if (!event.repeat) {
        this.#flaskSlotsRequested.push(action);
      }
      event.preventDefault();
    }
    // "toggle-inventory" / "toggle-character" stay shell-owned (App.tsx).
  };
  readonly #keyUp = (event: KeyboardEvent): void => {
    this.#held.delete(event.code);
  };
  readonly #blur = (): void => {
    this.clearHeldInput();
  };
  readonly #pointerMove = (pointer: Phaser.Input.Pointer): void => {
    this.#pointerX = pointer.x;
    this.#pointerY = pointer.y;
    this.#hasPointer = true;
  };
  readonly #pointerDown = (event: PointerEvent): void => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !document.hasFocus()
    ) {
      return;
    }
    this.canvas.focus({ preventScroll: true });
    if (this.gameplayFocused) {
      const bounds = this.canvas.getBoundingClientRect();
      this.#pointerX =
        ((event.clientX - bounds.left) / bounds.width) * this.canvas.width;
      this.#pointerY =
        ((event.clientY - bounds.top) / bounds.height) * this.canvas.height;
      this.#hasPointer = true;
      this.#abilitySlotsRequested.push("lmb");
      event.preventDefault();
    }
  };

  public constructor(
    readonly scene: Phaser.Scene,
    readonly canvas: HTMLCanvasElement,
    readonly keybinds: KeybindsStore = sharedKeybinds(),
  ) {
    window.addEventListener("keydown", this.#keyDown, true);
    window.addEventListener("keyup", this.#keyUp, true);
    window.addEventListener("blur", this.#blur);
    scene.input.on("pointermove", this.#pointerMove);
    canvas.addEventListener("pointerdown", this.#pointerDown);
  }

  public get gameplayFocused(): boolean {
    return document.activeElement === this.canvas && document.hasFocus();
  }

  public sample(): CombatInputSnapshot {
    if (!this.gameplayFocused) {
      this.clearHeldInput();
    }
    const movementX =
      Number(this.#held.has(this.keybinds.codeFor("move-right"))) -
      Number(this.#held.has(this.keybinds.codeFor("move-left")));
    const movementY =
      Number(this.#held.has(this.keybinds.codeFor("move-down"))) -
      Number(this.#held.has(this.keybinds.codeFor("move-up")));
    const snapshot = {
      movementX,
      movementY,
      pointerX: this.#pointerX,
      pointerY: this.#pointerY,
      hasPointer: this.#hasPointer,
      dodgeRequested: this.#dodgeRequested,
      abilitySlotsRequested: [...this.#abilitySlotsRequested],
      flaskSlotsRequested: [...this.#flaskSlotsRequested],
      lootPickupRequested: this.#lootPickupRequested,
    };
    this.#dodgeRequested = false;
    this.#abilitySlotsRequested.length = 0;
    this.#flaskSlotsRequested.length = 0;
    this.#lootPickupRequested = false;
    return snapshot;
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.#keyDown, true);
    window.removeEventListener("keyup", this.#keyUp, true);
    window.removeEventListener("blur", this.#blur);
    this.scene.input.off("pointermove", this.#pointerMove);
    this.canvas.removeEventListener("pointerdown", this.#pointerDown);
    this.clearHeldInput();
  }

  private clearHeldInput(): void {
    this.#held.clear();
    this.#dodgeRequested = false;
    this.#abilitySlotsRequested.length = 0;
    this.#flaskSlotsRequested.length = 0;
    this.#lootPickupRequested = false;
  }

  private isGameplayFocused(event: KeyboardEvent): boolean {
    return (
      document.activeElement === this.canvas &&
      !event.isComposing &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    );
  }
}

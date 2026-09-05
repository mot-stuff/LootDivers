import Phaser from "phaser";

import type { FlaskSlot, LoadoutSlot } from "../../core";

/** Digit keys 1–4 map onto the four flask slots (TASK-711, DEC-038). */
const FLASK_KEY_CODES: Readonly<Record<string, FlaskSlot>> = {
  Digit1: "flask-1",
  Digit2: "flask-2",
  Digit3: "flask-3",
  Digit4: "flask-4",
};

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
    if (this.isMovementCode(event.code)) {
      this.#held.add(event.code);
      event.preventDefault();
    } else if (event.code === "Space") {
      if (!event.repeat) {
        this.#dodgeRequested = true;
      }
      event.preventDefault();
    } else if (event.code === "KeyF") {
      if (!event.repeat) {
        this.#lootPickupRequested = true;
      }
      event.preventDefault();
    } else if (
      event.code === "KeyQ" ||
      event.code === "KeyE" ||
      event.code === "KeyR"
    ) {
      if (!event.repeat) {
        this.#abilitySlotsRequested.push(
          event.code === "KeyQ" ? "q" : event.code === "KeyE" ? "e" : "r",
        );
      }
      event.preventDefault();
    } else if (FLASK_KEY_CODES[event.code] !== undefined) {
      if (!event.repeat) {
        this.#flaskSlotsRequested.push(FLASK_KEY_CODES[event.code]!);
      }
      event.preventDefault();
    }
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
      Number(this.#held.has("KeyD")) - Number(this.#held.has("KeyA"));
    const movementY =
      Number(this.#held.has("KeyS")) - Number(this.#held.has("KeyW"));
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

  private isMovementCode(code: string): boolean {
    return (
      code === "KeyW" || code === "KeyA" || code === "KeyS" || code === "KeyD"
    );
  }
}

import Phaser from "phaser";

export interface CombatInputSnapshot {
  readonly movementX: number;
  readonly movementY: number;
  readonly pointerX: number;
  readonly pointerY: number;
  readonly hasPointer: boolean;
  readonly dodgeRequested: boolean;
  readonly resetRequested: boolean;
}

export class CombatInputAdapter {
  readonly #held = new Set<string>();
  #pointerX = 0;
  #pointerY = 0;
  #hasPointer = false;
  #dodgeRequested = false;
  #resetRequested = false;
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
    } else if (event.code === "KeyR") {
      if (!event.repeat) {
        this.#resetRequested = true;
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

  public constructor(
    readonly scene: Phaser.Scene,
    readonly canvas: HTMLCanvasElement,
  ) {
    window.addEventListener("keydown", this.#keyDown, true);
    window.addEventListener("keyup", this.#keyUp, true);
    window.addEventListener("blur", this.#blur);
    scene.input.on("pointermove", this.#pointerMove);
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
      resetRequested: this.#resetRequested,
    };
    this.#dodgeRequested = false;
    this.#resetRequested = false;
    return snapshot;
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.#keyDown, true);
    window.removeEventListener("keyup", this.#keyUp, true);
    window.removeEventListener("blur", this.#blur);
    this.scene.input.off("pointermove", this.#pointerMove);
    this.clearHeldInput();
  }

  private clearHeldInput(): void {
    this.#held.clear();
    this.#dodgeRequested = false;
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

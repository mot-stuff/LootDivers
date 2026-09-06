import Phaser from "phaser";

/**
 * Original isometric loot-diver sheets. Each sheet is an 8-row grid of
 * 96x96 frames. Rows are screen-space facings ordered clockwise
 * (screen y down) from east: E, SE, S, SW, W, NW, N, NE. Column counts
 * differ per animation. Dodge reuses a dedicated tumble sheet.
 */
export const BARBARIAN_FRAME_SIZE = 96;
export const BARBARIAN_DIRECTION_ROWS = 8;

export type BarbarianAnimationId = "idle" | "run" | "attack" | "roll" | "die";

interface BarbarianSheetDefinition {
  readonly id: BarbarianAnimationId;
  readonly file: string;
  readonly columns: number;
  readonly frameRate: number;
  readonly repeat: number;
}

const SHEETS: readonly BarbarianSheetDefinition[] = [
  { id: "idle", file: "Idle.png", columns: 4, frameRate: 6, repeat: -1 },
  { id: "run", file: "Run.png", columns: 6, frameRate: 12, repeat: -1 },
  { id: "attack", file: "Attack.png", columns: 6, frameRate: 14, repeat: 0 },
  { id: "roll", file: "Rolling.png", columns: 6, frameRate: 16, repeat: 0 },
  { id: "die", file: "Die.png", columns: 6, frameRate: 10, repeat: 0 },
];

// Root-absolute so the sheets resolve identically from "/" and from the
// "/play/" page the game shell moved to in TASK-708 (DEC-035).
const ASSET_ROOT = "/assets/characters/diver";
const IDLE_COLUMNS = 4;

function textureKey(id: BarbarianAnimationId): string {
  return `barbarian:${id}`;
}

function animationKey(id: BarbarianAnimationId, row: number): string {
  return `barbarian:${id}:${row}`;
}

/**
 * Maps a screen-space direction (y down) onto one of the eight sheet
 * rows. Row order matches the screen-space octant clockwise from east.
 */
export function barbarianDirectionRow(
  screenX: number,
  screenY: number,
): number {
  if (screenX === 0 && screenY === 0) return 2;
  const octant = Math.round(Math.atan2(screenY, screenX) / (Math.PI / 4));
  return ((octant % 8) + 8) % 8;
}

export interface BarbarianViewState {
  readonly canvasX: number;
  readonly canvasY: number;
  readonly facingScreenX: number;
  readonly facingScreenY: number;
  readonly movementScreenX: number;
  readonly movementScreenY: number;
  readonly moving: boolean;
  readonly dead: boolean;
  readonly dodging: boolean;
  readonly attackPhase: "idle" | "startup" | "active" | "recovery";
  readonly attackAimScreenX: number;
  readonly attackAimScreenY: number;
  readonly paused: boolean;
  readonly flashing: boolean;
}

export interface BarbarianSpriteDiagnostics {
  readonly ready: boolean;
  readonly animationKey: string | null;
  readonly directionRow: number | null;
}

/**
 * Loads the diver sheets on demand and drives one player sprite from
 * combat diagnostics. Until textures finish loading, callers should keep
 * their geometric fallback.
 */
export class BarbarianSpritePresentation {
  #sprite: Phaser.GameObjects.Sprite | null = null;
  #ready = false;
  #disposed = false;
  #currentKey: string | null = null;
  #lastRow = 2;
  #wasDodging = false;
  #lastAttackPhase: BarbarianViewState["attackPhase"] = "idle";

  public constructor(
    readonly scene: Phaser.Scene,
    readonly depth: number,
  ) {
    const frameConfig = {
      frameWidth: BARBARIAN_FRAME_SIZE,
      frameHeight: BARBARIAN_FRAME_SIZE,
    };
    for (const sheet of SHEETS) {
      scene.load.spritesheet(
        textureKey(sheet.id),
        `${ASSET_ROOT}/${sheet.file}`,
        frameConfig,
      );
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.#disposed) return;
      this.createAnimations();
      // Origin sits on the baked contact-shadow / feet (y=88 of 96).
      const origin = 88 / BARBARIAN_FRAME_SIZE;
      const southIdle = 2 * IDLE_COLUMNS;
      this.#sprite = scene.add
        .sprite(0, 0, textureKey("idle"), southIdle)
        .setOrigin(0.5, origin)
        .setScale(1.05)
        .setDepth(depth)
        .setVisible(false);
      this.#ready = true;
    });
    scene.load.start();
  }

  public get ready(): boolean {
    return this.#ready;
  }

  public update(state: BarbarianViewState): BarbarianSpriteDiagnostics {
    const sprite = this.#sprite;
    if (!this.#ready || sprite === null) {
      return { ready: false, animationKey: null, directionRow: null };
    }
    sprite.setVisible(true);
    sprite.setPosition(state.canvasX, state.canvasY + 8);

    const attacking = state.attackPhase !== "idle";
    const selection = this.selectAnimation(state, attacking);
    let key = animationKey(selection.id, selection.row);
    const dodgeStarted = state.dodging && !this.#wasDodging;
    this.#wasDodging = state.dodging;
    const attackStarted =
      state.attackPhase === "startup" && this.#lastAttackPhase !== "startup";
    this.#lastAttackPhase = state.attackPhase;
    const current = this.#currentKey;
    const currentPlaying = sprite.anims.isPlaying || sprite.anims.isPaused;
    const holdCurrent =
      current !== null &&
      currentPlaying &&
      !state.dead &&
      ((current.startsWith("barbarian:roll:") &&
        !attacking &&
        (selection.id === "idle" || selection.id === "run")) ||
        (current.startsWith("barbarian:attack:") &&
          !state.dodging &&
          selection.id === "idle"));
    let row = selection.row;
    if (holdCurrent) {
      key = current;
      row = this.#lastRow;
    } else {
      this.#lastRow = selection.row;
    }
    if (this.#currentKey !== key) {
      sprite.play(key);
      this.#currentKey = key;
    } else if (
      (dodgeStarted && selection.id === "roll") ||
      (attackStarted && selection.id === "attack")
    ) {
      sprite.play(key);
    }
    if (state.paused) {
      sprite.anims.pause();
    } else if (sprite.anims.isPaused) {
      sprite.anims.resume();
    }
    if (state.flashing && !state.dead) {
      sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    } else {
      sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
    }
    return { ready: true, animationKey: key, directionRow: row };
  }

  public dispose(): void {
    this.#disposed = true;
    this.#sprite?.destroy();
    this.#sprite = null;
  }

  private selectAnimation(
    state: BarbarianViewState,
    attacking: boolean,
  ): {
    readonly id: BarbarianAnimationId;
    readonly row: number;
  } {
    if (state.dead) {
      return { id: "die", row: this.#lastRow };
    }
    if (state.dodging) {
      const rollX = state.moving ? state.movementScreenX : state.facingScreenX;
      const rollY = state.moving ? state.movementScreenY : state.facingScreenY;
      return { id: "roll", row: barbarianDirectionRow(rollX, rollY) };
    }
    if (attacking) {
      return {
        id: "attack",
        row: barbarianDirectionRow(
          state.attackAimScreenX,
          state.attackAimScreenY,
        ),
      };
    }
    if (state.moving) {
      return {
        id: "run",
        row: barbarianDirectionRow(
          state.movementScreenX,
          state.movementScreenY,
        ),
      };
    }
    return { id: "idle", row: this.#lastRow };
  }

  private createAnimations(): void {
    for (const sheet of SHEETS) {
      for (let row = 0; row < BARBARIAN_DIRECTION_ROWS; row += 1) {
        const key = animationKey(sheet.id, row);
        if (this.scene.anims.exists(key)) continue;
        this.scene.anims.create({
          key,
          frames: this.scene.anims.generateFrameNumbers(textureKey(sheet.id), {
            start: row * sheet.columns,
            end: row * sheet.columns + sheet.columns - 1,
          }),
          frameRate: sheet.frameRate,
          repeat: sheet.repeat,
        });
      }
    }
  }
}

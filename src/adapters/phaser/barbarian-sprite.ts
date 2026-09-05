import Phaser from "phaser";

/**
 * Owner-authored barbarian spritesheets. Every sheet is a 15-column,
 * 8-row grid of 128x128 frames. Rows are screen-space facings ordered
 * clockwise (screen y down) from east: E, SE, S, SW, W, NW, N, NE.
 */
export const BARBARIAN_FRAME_SIZE = 128;
export const BARBARIAN_COLUMNS = 15;
export const BARBARIAN_DIRECTION_ROWS = 8;

export type BarbarianAnimationId = "idle" | "run" | "attack" | "roll" | "die";

interface BarbarianSheetDefinition {
  readonly id: BarbarianAnimationId;
  readonly file: string;
  readonly frameRate: number;
  readonly repeat: number;
  /** The sheet has a frame-aligned overlay in effects/. */
  readonly hasEffect?: boolean;
}

// Roll and attack play once at a readable speed (15 frames each: the
// roll runs 0.47s, the swing 0.5s) and may finish visually after the
// much shorter simulation windows (0.18s dodge dash, 0.25s cleave).
// Every sheet has a frame-aligned cast-shadow companion in shadow/.
const SHEETS: readonly BarbarianSheetDefinition[] = [
  { id: "idle", file: "Idle.png", frameRate: 12, repeat: -1 },
  { id: "run", file: "Run.png", frameRate: 24, repeat: -1 },
  {
    id: "attack",
    file: "Attack1.png",
    frameRate: 30,
    repeat: 0,
    hasEffect: true,
  },
  { id: "roll", file: "Rolling.png", frameRate: 32, repeat: 0 },
  { id: "die", file: "Die.png", frameRate: 20, repeat: 0 },
];

// Root-absolute so the sheets resolve identically from "/" and from the
// "/play/" page the game shell moved to in TASK-708 (DEC-035).
const ASSET_ROOT = "/assets/characters/barbarian";
const SHADOW_ALPHA = 0.5;

function textureKey(id: BarbarianAnimationId): string {
  return `barbarian:${id}`;
}

function shadowTextureKey(id: BarbarianAnimationId): string {
  return `barbarian-shadow:${id}`;
}

function effectTextureKey(id: BarbarianAnimationId): string {
  return `barbarian-fx:${id}`;
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
 * Loads the barbarian sheets on demand and drives one player sprite from
 * combat diagnostics. Until textures finish loading, callers should keep
 * their geometric fallback.
 */
export class BarbarianSpritePresentation {
  #sprite: Phaser.GameObjects.Sprite | null = null;
  #shadow: Phaser.GameObjects.Sprite | null = null;
  #effect: Phaser.GameObjects.Sprite | null = null;
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
      scene.load.spritesheet(
        shadowTextureKey(sheet.id),
        `${ASSET_ROOT}/shadow/${sheet.file}`,
        frameConfig,
      );
      if (sheet.hasEffect === true) {
        scene.load.spritesheet(
          effectTextureKey(sheet.id),
          `${ASSET_ROOT}/effects/${sheet.file}`,
          frameConfig,
        );
      }
    }
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.#disposed) return;
      this.createAnimations();
      // Origin sits on the feet (opaque art ends at y=90 of 128) so the
      // sprite plants on the ground shadow at any scale. The shadow and
      // effect layers share the grid, origin, and scale, and mirror the
      // body's current frame each update, so they never drift. Creation
      // order gives the paint order: shadow, body, effect.
      const origin = 90 / BARBARIAN_FRAME_SIZE;
      this.#shadow = scene.add
        .sprite(0, 0, shadowTextureKey("idle"), 2 * BARBARIAN_COLUMNS)
        .setOrigin(0.5, origin)
        .setScale(1.3)
        .setDepth(depth)
        .setAlpha(SHADOW_ALPHA)
        .setVisible(false);
      this.#sprite = scene.add
        .sprite(0, 0, textureKey("idle"), 2 * BARBARIAN_COLUMNS)
        .setOrigin(0.5, origin)
        .setScale(1.3)
        .setDepth(depth)
        .setVisible(false);
      this.#effect = scene.add
        .sprite(0, 0, effectTextureKey("attack"), 0)
        .setOrigin(0.5, origin)
        .setScale(1.3)
        .setDepth(depth)
        .setBlendMode(Phaser.BlendModes.ADD)
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
    // Started rolls and swings play to completion past their shorter
    // simulation windows. Death always cuts in, an attack cuts a roll,
    // and moving cuts a finished swing's follow-through.
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
      // #lastRow still holds the held animation's direction row.
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
      // Re-trigger repeated dodges and swings in the same direction.
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
    this.syncCompanionLayers(sprite, key);
    return { ready: true, animationKey: key, directionRow: row };
  }

  /**
   * The shadow and slash-effect sheets are frame-aligned with the body
   * sheets, so both layers copy the body's texture id and frame index.
   */
  private syncCompanionLayers(
    sprite: Phaser.GameObjects.Sprite,
    key: string,
  ): void {
    const animId = key.split(":")[1] as BarbarianAnimationId;
    const frame = sprite.frame.name;
    this.#shadow
      ?.setVisible(true)
      .setPosition(sprite.x, sprite.y)
      .setTexture(shadowTextureKey(animId), frame);
    if (this.#effect === null) return;
    if (animId === "attack") {
      this.#effect
        .setVisible(true)
        .setPosition(sprite.x, sprite.y)
        .setTexture(effectTextureKey("attack"), frame);
    } else {
      this.#effect.setVisible(false);
    }
  }

  public dispose(): void {
    this.#disposed = true;
    this.#sprite?.destroy();
    this.#sprite = null;
    this.#shadow?.destroy();
    this.#shadow = null;
    this.#effect?.destroy();
    this.#effect = null;
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
    // The character faces where they are running, not the cursor; the
    // cursor only orients attacks. Standing still keeps the last facing.
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
            start: row * BARBARIAN_COLUMNS,
            end: row * BARBARIAN_COLUMNS + BARBARIAN_COLUMNS - 1,
          }),
          frameRate: sheet.frameRate,
          repeat: sheet.repeat,
        });
      }
    }
  }
}

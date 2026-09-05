import Phaser from "phaser";

import {
  BASIC_CLEAVE_ID,
  CombatArenaSimulation,
  CINDER_DART_ID,
  DEFIANT_SIGNAL_ID,
  FIXED_STEP_SECONDS,
  FIXED_TICKS_PER_SECOND,
  FixedStepRunner,
  IMPLEMENTED_ABILITY_CATALOG,
  WINTER_PULSE_ID,
  affixById,
  definitionById,
  equipmentBaseById,
  type CombatArenaDiagnostics,
  type CombatArenaEvent,
  type CombatAbilityId,
  type DamageResult,
  EQUIPMENT_SLOTS,
  FLASK_SLOTS,
  formatItemModifierLabel,
  type EquipmentItemInstance,
  type EquipmentSlot,
  type EquipmentSlotKind,
  type FlaskSlot,
  type ItemInstance,
  type LoadoutSlot,
  type WorldLootDrop,
} from "../../core";
import {
  ITEM_COMMAND_EVENT,
  ITEM_HUD_EVENT,
  type CombatHudReadModel,
  type EquipmentItemHudReadModel,
  type InventoryHudReadModel,
  type ItemModifierHudReadModel,
  type ItemUiCommand,
} from "../../presentation/shell-contracts";
import { CombatInputAdapter } from "./combat-input";
import { worldLootLabel } from "./loot-label";

const ORIGIN_X = 480;
const ORIGIN_Y = 72;
const ISO_X_SCALE = 0.65;
const ISO_Y_SCALE = 0.34;
const PRESENTATION_DEPTH = 3_500_000;
/** Vertical distance from a drop's ground point to its label's bottom edge. */
const LOOT_LABEL_BASE_LIFT = 18;
/** Vertical spacing between stacked labels of overlapping drops. */
const LOOT_LABEL_STACK_GAP = 2;

const HUD_SLOTS: readonly {
  readonly slot: LoadoutSlot;
  readonly keyLabel: string;
  readonly accessibleKeyLabel: string;
}[] = [
  {
    slot: "lmb",
    keyLabel: "LMB",
    accessibleKeyLabel: "Left click",
  },
  {
    slot: "q",
    keyLabel: "Q",
    accessibleKeyLabel: "Q",
  },
  {
    slot: "e",
    keyLabel: "E",
    accessibleKeyLabel: "E",
  },
  {
    slot: "r",
    keyLabel: "R",
    accessibleKeyLabel: "R",
  },
];

const ABILITY_NAMES: Readonly<Record<string, string>> = {
  [BASIC_CLEAVE_ID]: "Basic Cleave",
  [CINDER_DART_ID]: "Cinder Dart",
  [WINTER_PULSE_ID]: "Winter Pulse",
  [DEFIANT_SIGNAL_ID]: "Defiant Signal",
};

const EQUIPMENT_SLOT_LABELS: Readonly<Record<EquipmentSlot, string>> = {
  helmet: "Helmet",
  chest: "Chest",
  amulet: "Amulet",
  belt: "Belt",
  boots: "Boots",
  "main-hand": "Main hand",
  offhand: "Offhand",
  "ring-1": "Ring 1",
  "ring-2": "Ring 2",
};

const EQUIPMENT_TYPE_LABELS: Readonly<Record<EquipmentSlotKind, string>> = {
  helmet: "Helmet",
  chest: "Body armor",
  amulet: "Amulet",
  belt: "Belt",
  boots: "Boots",
  "main-hand": "Melee weapon",
  offhand: "Offhand",
  ring: "Ring",
  flask: "Flask",
};

const FLASK_SLOT_LABELS: Readonly<Record<FlaskSlot, string>> = {
  "flask-1": "Flask 1",
  "flask-2": "Flask 2",
  "flask-3": "Flask 3",
  "flask-4": "Flask 4",
};

const STATUS_LABELS = {
  chilled: "Chilled",
  focused: "Focused",
  weakened: "Weakened",
} as const;

export interface CombatPresentationDiagnostics extends CombatArenaDiagnostics {
  readonly pausedForUi: boolean;
  readonly playerCanvasX: number;
  readonly playerCanvasY: number;
  readonly facingCanvasX: number;
  readonly facingCanvasY: number;
  readonly enemyCanvasX: number;
  readonly enemyCanvasY: number;
  readonly enemyHealthBarCanvasX: number;
  readonly enemyHealthBarCanvasY: number;
  readonly enemyHealthBarVisible: boolean;
  readonly impactCount: number;
  readonly deathFeedbackCount: number;
  readonly enemyStrikeFeedbackCount: number;
  readonly renderedProjectileCount: number;
  readonly renderedAreaCount: number;
  readonly renderedStatusCount: number;
  readonly renderedLoot: readonly {
    readonly dropId: string;
    readonly itemKind: ItemInstance["kind"];
    readonly canvasX: number;
    readonly canvasY: number;
    readonly labelText: string;
    readonly labelColor: string;
    readonly labelCanvasX: number;
    readonly labelCanvasY: number;
  }[];
}

export class CombatArenaPresentation {
  readonly #simulation = new CombatArenaSimulation();
  readonly #input: CombatInputAdapter;
  readonly #runner: FixedStepRunner;
  readonly #arenaGraphics: Phaser.GameObjects.Graphics;
  readonly #combatGraphics: Phaser.GameObjects.Graphics;
  readonly #playerGraphics: Phaser.GameObjects.Graphics;
  readonly #renderedPlayerPoint = new Phaser.Math.Vector2();
  readonly #renderedFacingPoint = new Phaser.Math.Vector2();
  readonly #renderedEnemyPoint = new Phaser.Math.Vector2();
  readonly #renderedEnemyHealthBarPoint = new Phaser.Math.Vector2();
  #pausedForUi = true;
  #automationPaused = false;
  #lastHudKey = "";
  #lastItemHudKey = "";
  #itemHudRevision = 0;
  #lastPointerX = ORIGIN_X + 150;
  #lastPointerY = ORIGIN_Y + 180;
  #impactCount = 0;
  #deathFeedbackCount = 0;
  #enemyStrikeFeedbackCount = 0;
  #targetFlashUntil = 0;
  #playerFlashUntil = 0;
  #enemyStrikeUntil = 0;
  #renderedProjectileCount = 0;
  #renderedAreaCount = 0;
  #renderedStatusCount = 0;
  #renderedLoot: CombatPresentationDiagnostics["renderedLoot"] = [];
  readonly #lootLabels = new Map<string, Phaser.GameObjects.Text>();
  readonly #itemCommand = (event: CustomEvent<ItemUiCommand>): void => {
    this.executeItemCommand(event.detail);
  };

  public constructor(
    readonly scene: Phaser.Scene,
    readonly canvas: HTMLCanvasElement,
  ) {
    this.#input = new CombatInputAdapter(scene, canvas);
    this.#runner = new FixedStepRunner(
      { nowMilliseconds: () => performance.now() },
      (step) => this.#simulation.step(step),
    );
    this.#arenaGraphics = scene.add.graphics().setDepth(PRESENTATION_DEPTH);
    this.#combatGraphics = scene.add
      .graphics()
      .setDepth(PRESENTATION_DEPTH + 1);
    this.#playerGraphics = scene.add
      .graphics()
      .setDepth(PRESENTATION_DEPTH + 2);
    window.addEventListener(ITEM_COMMAND_EVENT, this.#itemCommand);
    this.drawArena();
    this.render(0);
  }

  public update(): void {
    const input = this.#input.sample();
    const focused = this.#input.gameplayFocused;
    if (focused && !this.#automationPaused && !this.#runner.isRunning) {
      this.#runner.resume();
    } else if ((!focused || this.#automationPaused) && this.#runner.isRunning) {
      this.#runner.pause();
    }
    this.#pausedForUi = !focused;

    this.#simulation.setMovement(input.movementX, input.movementY);
    if (input.dodgeRequested) {
      this.#simulation.requestDodge();
    }
    if (input.lootPickupRequested) {
      this.#simulation.requestLootPickup();
    }
    if (input.hasPointer) {
      this.#lastPointerX = input.pointerX;
      this.#lastPointerY = input.pointerY;
    }
    const player = this.#simulation.diagnostics();
    const playerPoint = this.project(player.x, player.y);
    this.scene.cameras.main.centerOn(playerPoint.x, playerPoint.y);
    const aimOriginY = playerPoint.y - 8;
    const pointerPoint = this.scene.cameras.main.getWorldPoint(
      this.#lastPointerX,
      this.#lastPointerY,
    );
    const aim = this.inverseProjectDelta(
      pointerPoint.x - playerPoint.x,
      pointerPoint.y - aimOriginY,
    );
    this.#simulation.setAim(aim.x, aim.y);
    for (const slot of input.abilitySlotsRequested) {
      this.#simulation.requestAbilitySlot(slot, {
        kind: "point",
        x: player.x + aim.x,
        y: player.y + aim.y,
      });
    }

    const result = this.#runner.advance();
    this.consumeEvents(this.#simulation.drainEvents());
    this.render(result.interpolationAlpha);
  }

  public reset(): void {
    this.#runner.reset();
    this.#simulation.reset();
    this.#impactCount = 0;
    this.#deathFeedbackCount = 0;
    this.#enemyStrikeFeedbackCount = 0;
    this.#targetFlashUntil = 0;
    this.#playerFlashUntil = 0;
    this.#enemyStrikeUntil = 0;
    this.render(0);
  }

  public diagnostics(): CombatPresentationDiagnostics {
    return {
      ...this.#simulation.diagnostics(),
      pausedForUi: this.#pausedForUi,
      playerCanvasX: this.#renderedPlayerPoint.x,
      playerCanvasY: this.#renderedPlayerPoint.y,
      facingCanvasX: this.#renderedFacingPoint.x,
      facingCanvasY: this.#renderedFacingPoint.y,
      enemyCanvasX: this.#renderedEnemyPoint.x,
      enemyCanvasY: this.#renderedEnemyPoint.y,
      enemyHealthBarCanvasX: this.#renderedEnemyHealthBarPoint.x,
      enemyHealthBarCanvasY: this.#renderedEnemyHealthBarPoint.y,
      enemyHealthBarVisible: !this.#simulation.diagnostics().enemy.dead,
      impactCount: this.#impactCount,
      deathFeedbackCount: this.#deathFeedbackCount,
      enemyStrikeFeedbackCount: this.#enemyStrikeFeedbackCount,
      renderedProjectileCount: this.#renderedProjectileCount,
      renderedAreaCount: this.#renderedAreaCount,
      renderedStatusCount: this.#renderedStatusCount,
      renderedLoot: this.#renderedLoot,
    };
  }

  public applyPlayerDamage(amount: number): DamageResult {
    const result = this.#simulation.applyPlayerDamage({
      amount,
      sourceId: this.#simulation.config.enemy.id,
    });
    this.consumeEvents(this.#simulation.drainEvents());
    this.render(0);
    return result;
  }

  public setAimDirection(x: number, y: number): void {
    this.#simulation.setAim(x, y);
    const state = this.#simulation.diagnostics();
    const target = this.project(state.x + x * 100, state.y + y * 100);
    const canvasTarget = this.scene.cameras.main.matrixCombined.transformPoint(
      target.x,
      target.y,
    );
    this.#lastPointerX = canvasTarget.x;
    this.#lastPointerY = canvasTarget.y;
  }

  public setAutomationPaused(paused: boolean): void {
    this.#automationPaused = paused;
    if (paused) {
      this.#runner.pause();
    }
  }

  public requestDodge(): void {
    this.#simulation.requestDodge();
  }

  public requestPrimaryAttack(): void {
    this.#simulation.requestPrimaryAttack();
  }

  public setMovement(x: number, y: number): void {
    this.#simulation.setMovement(x, y);
  }

  public requestAbilitySlot(slot: LoadoutSlot, x?: number, y?: number): void {
    this.#simulation.requestAbilitySlot(
      slot,
      x === undefined || y === undefined ? undefined : { kind: "point", x, y },
    );
  }

  public requestCinderDart(): void {
    this.#simulation.requestAbility(CINDER_DART_ID);
  }

  public requestWinterPulse(x: number, y: number): void {
    this.#simulation.requestAbility(WINTER_PULSE_ID, { kind: "point", x, y });
  }

  public requestDefiantSignal(): void {
    this.#simulation.requestAbility(DEFIANT_SIGNAL_ID);
  }

  public advancePaused(steps: number): void {
    if (!this.#automationPaused) {
      throw new Error("Combat automation must be paused before advancing.");
    }
    if (!Number.isSafeInteger(steps) || steps < 0) {
      throw new RangeError("Combat steps must be a non-negative safe integer.");
    }
    for (let index = 0; index < steps; index += 1) {
      this.#simulation.step({
        tick: this.#simulation.diagnostics().tick,
        deltaSeconds: FIXED_STEP_SECONDS,
      });
    }
    this.consumeEvents(this.#simulation.drainEvents());
    this.render(0);
  }

  public itemHud(): InventoryHudReadModel {
    return this.createItemHud(this.#itemHudRevision);
  }

  public executeItemCommand(command: ItemUiCommand): void {
    if (command.type === "item.equip") {
      this.#simulation.equipCharacterItem(
        command.inventoryIndex,
        command.targetEquipmentSlot,
      );
    } else if (command.type === "item.unequip") {
      this.#simulation.unequipCharacterItem(command.equipmentSlot);
    } else if (
      command.type === "item.consume-ability-stone" &&
      this.isCombatAbilityId(command.abilityId)
    ) {
      this.#simulation.consumeCharacterAbilityStone(
        command.inventoryIndex,
        command.abilityId,
      );
    } else if (
      command.type === "item.assign-ability" &&
      this.isCombatAbilityId(command.abilityId)
    ) {
      this.#simulation.assignAbilitySlot(
        command.loadoutSlot,
        command.abilityId,
      );
    }
    this.render(0, true);
  }

  public dispose(): void {
    this.#runner.pause();
    this.#input.dispose();
    window.removeEventListener(ITEM_COMMAND_EVENT, this.#itemCommand);
    this.#arenaGraphics.destroy();
    this.#combatGraphics.destroy();
    this.#playerGraphics.destroy();
    for (const label of this.#lootLabels.values()) {
      label.destroy();
    }
    this.#lootLabels.clear();
  }

  private drawArena(): void {
    const top = this.project(0, 0);
    const right = this.project(this.#simulation.config.width, 0);
    const bottom = this.project(
      this.#simulation.config.width,
      this.#simulation.config.height,
    );
    const left = this.project(0, this.#simulation.config.height);
    const points = [top, right, bottom, left].map(
      ({ x, y }) => new Phaser.Math.Vector2(x, y),
    );

    this.#arenaGraphics.fillStyle(0x10263a, 0.98);
    this.#arenaGraphics.fillPoints(points, true);
    this.#arenaGraphics.lineStyle(5, 0x64d8cb, 1);
    this.#arenaGraphics.strokePoints(points, true);

    this.#arenaGraphics.lineStyle(1, 0x31536a, 0.55);
    for (let x = 80; x < this.#simulation.config.width; x += 80) {
      const start = this.project(x, 0);
      const end = this.project(x, this.#simulation.config.height);
      this.#arenaGraphics.lineBetween(start.x, start.y, end.x, end.y);
    }
    for (let y = 60; y < this.#simulation.config.height; y += 60) {
      const start = this.project(0, y);
      const end = this.project(this.#simulation.config.width, y);
      this.#arenaGraphics.lineBetween(start.x, start.y, end.x, end.y);
    }
  }

  private render(alpha: number, forceItemHud = false): void {
    const state = this.#simulation.diagnostics();
    const x = Phaser.Math.Linear(state.previousX, state.x, alpha);
    const y = Phaser.Math.Linear(state.previousY, state.y, alpha);
    const point = this.project(x, y);
    this.scene.cameras.main.centerOn(point.x, point.y);
    const facingScreenX = (state.facingX - state.facingY) * ISO_X_SCALE;
    const facingScreenY = (state.facingX + state.facingY) * ISO_Y_SCALE;
    const facingLength = Math.hypot(facingScreenX, facingScreenY) || 1;
    const facingEndX = point.x + (facingScreenX / facingLength) * 35;
    const facingEndY = point.y - 8 + (facingScreenY / facingLength) * 35;

    this.#combatGraphics.clear();
    this.drawAttack(state, point);
    this.drawAbilityFeedback(state);
    this.drawWorldLoot(state.worldLoot);
    this.drawEnemy(state, alpha);

    this.#playerGraphics.clear();
    const playerColor = state.playerDead
      ? 0x59636f
      : performance.now() < this.#playerFlashUntil
        ? 0xff6b6b
        : state.dodging
          ? 0xf9f3a6
          : 0x5ce1e6;
    this.#playerGraphics.fillStyle(playerColor, 0.24);
    this.#playerGraphics.fillEllipse(point.x, point.y + 8, 52, 25);
    this.#playerGraphics.fillStyle(playerColor, 1);
    this.#playerGraphics.fillCircle(point.x, point.y - 8, 17);
    this.#playerGraphics.lineStyle(5, 0x08111f, 1);
    this.#playerGraphics.lineBetween(
      point.x,
      point.y - 8,
      facingEndX,
      facingEndY,
    );
    const cameraMatrix = this.scene.cameras.main.matrixCombined;
    cameraMatrix.transformPoint(
      point.x,
      point.y - 8,
      this.#renderedPlayerPoint,
    );
    cameraMatrix.transformPoint(
      facingEndX,
      facingEndY,
      this.#renderedFacingPoint,
    );

    this.publishHud(state);
    this.publishItemHud(forceItemHud);
  }

  private drawAttack(
    state: CombatArenaDiagnostics,
    playerPoint: { readonly x: number; readonly y: number },
  ): void {
    if (state.attackPhase === "idle" || state.attackPhase === "recovery") {
      return;
    }
    const attack = definitionById(BASIC_CLEAVE_ID)?.effects.find(
      (effect) => effect.parameters[0]?.value.kind === "cone-damage",
    )?.parameters[0]?.value;
    if (attack?.kind !== "cone-damage") return;
    const centerAngle = Math.atan2(state.attackAimY, state.attackAimX);
    const halfAngle = (attack.halfAngleDegrees * Math.PI) / 180;
    const points = [new Phaser.Math.Vector2(playerPoint.x, playerPoint.y - 8)];
    for (let index = 0; index <= 8; index += 1) {
      const angle = centerAngle - halfAngle + (halfAngle * 2 * index) / 8;
      const endpoint = this.project(
        state.x + Math.cos(angle) * attack.range,
        state.y + Math.sin(angle) * attack.range,
      );
      points.push(new Phaser.Math.Vector2(endpoint.x, endpoint.y));
    }
    this.#combatGraphics.fillStyle(
      state.attackPhase === "active" ? 0xffd166 : 0x8ecae6,
      state.attackPhase === "active" ? 0.34 : 0.15,
    );
    this.#combatGraphics.fillPoints(points, true);
    this.#combatGraphics.lineStyle(3, 0xffd166, 0.9);
    this.#combatGraphics.strokePoints(points.slice(1), false);
  }

  private drawEnemy(state: CombatArenaDiagnostics, alpha: number): void {
    const enemy = state.enemy;
    const x = Phaser.Math.Linear(enemy.previousX, enemy.x, alpha);
    const y = Phaser.Math.Linear(enemy.previousY, enemy.y, alpha);
    const point = this.project(x, y);
    const flashing = performance.now() < this.#targetFlashUntil;
    const color = enemy.dead ? 0x4b5563 : flashing ? 0xffffff : 0xef476f;
    this.#combatGraphics.fillStyle(color, enemy.dead ? 0.45 : 1);
    this.#combatGraphics.fillCircle(point.x, point.y - 8, enemy.radius);
    this.#combatGraphics.lineStyle(4, 0x08111f, 1);
    if (enemy.dead) {
      this.#combatGraphics.lineBetween(
        point.x - 12,
        point.y - 20,
        point.x + 12,
        point.y + 4,
      );
      this.#combatGraphics.lineBetween(
        point.x + 12,
        point.y - 20,
        point.x - 12,
        point.y + 4,
      );
    } else {
      const facingScreenX = (enemy.facingX - enemy.facingY) * ISO_X_SCALE;
      const facingScreenY = (enemy.facingX + enemy.facingY) * ISO_Y_SCALE;
      const facingLength = Math.hypot(facingScreenX, facingScreenY) || 1;
      this.#combatGraphics.lineBetween(
        point.x,
        point.y - 8,
        point.x + (facingScreenX / facingLength) * 25,
        point.y - 8 + (facingScreenY / facingLength) * 25,
      );
      if (enemy.state === "windup") {
        const progress =
          1 -
          enemy.windupTicksRemaining /
            this.#simulation.config.enemy.attackWindupTicks;
        this.#combatGraphics.lineStyle(3 + progress * 5, 0xffd166, 0.95);
        this.#combatGraphics.strokeCircle(
          point.x,
          point.y - 8,
          enemy.radius + 8 + progress * 8,
        );
      } else if (performance.now() < this.#enemyStrikeUntil) {
        this.#combatGraphics.lineStyle(7, 0xff9f1c, 0.9);
        this.#combatGraphics.strokeCircle(
          point.x,
          point.y - 8,
          enemy.radius + 15,
        );
      }
      const healthBarWidth = Math.max(28, enemy.radius * 2.4);
      const healthBarY = point.y - enemy.radius - 14;
      const healthWidth = healthBarWidth * (enemy.health / enemy.maxHealth);
      this.#combatGraphics.fillStyle(0x32131b, 1);
      this.#combatGraphics.fillRect(
        point.x - healthBarWidth / 2,
        healthBarY,
        healthBarWidth,
        4,
      );
      this.#combatGraphics.fillStyle(0xff6b6b, 1);
      this.#combatGraphics.fillRect(
        point.x - healthBarWidth / 2,
        healthBarY,
        healthWidth,
        4,
      );
    }
    this.scene.cameras.main.matrixCombined.transformPoint(
      point.x,
      point.y - 8,
      this.#renderedEnemyPoint,
    );
    this.scene.cameras.main.matrixCombined.transformPoint(
      point.x,
      point.y - enemy.radius - 14,
      this.#renderedEnemyHealthBarPoint,
    );
  }

  private drawAbilityFeedback(state: CombatArenaDiagnostics): void {
    this.#renderedProjectileCount = state.projectiles.length;
    this.#renderedAreaCount = state.areaFeedback.length;
    this.#renderedStatusCount = state.statuses.length;
    for (const area of state.areaFeedback) {
      const point = this.project(area.x, area.y);
      const color = area.abilityId === WINTER_PULSE_ID ? 0x80d8ff : 0xffd166;
      this.#combatGraphics.fillStyle(color, 0.16);
      this.#combatGraphics.fillEllipse(
        point.x,
        point.y,
        area.radius * ISO_X_SCALE * 2,
        area.radius * ISO_Y_SCALE * 2,
      );
      this.#combatGraphics.lineStyle(3, color, 0.9);
      this.#combatGraphics.strokeEllipse(
        point.x,
        point.y,
        area.radius * ISO_X_SCALE * 2,
        area.radius * ISO_Y_SCALE * 2,
      );
    }
    for (const projectile of state.projectiles) {
      const point = this.project(projectile.x, projectile.y);
      this.#combatGraphics.fillStyle(0xff6b35, 1);
      this.#combatGraphics.fillCircle(point.x, point.y - 8, projectile.radius);
      this.#combatGraphics.lineStyle(3, 0xffc15e, 0.8);
      this.#combatGraphics.strokeCircle(
        point.x,
        point.y - 8,
        projectile.radius + 3,
      );
    }
    const enemyStatus = state.statuses.some(
      (status) => status.targetId === state.enemy.id,
    );
    if (enemyStatus && !state.enemy.dead) {
      const point = this.project(state.enemy.x, state.enemy.y);
      this.#combatGraphics.lineStyle(3, 0x9adff5, 0.95);
      this.#combatGraphics.strokeCircle(
        point.x,
        point.y - 8,
        state.enemy.radius + 6,
      );
    }
  }

  private drawWorldLoot(drops: readonly WorldLootDrop[]): void {
    const rendered: Array<
      CombatPresentationDiagnostics["renderedLoot"][number]
    > = [];
    const liveDropIds = new Set<string>();
    const placedLabelBounds: Array<{
      readonly left: number;
      readonly right: number;
      readonly top: number;
      readonly bottom: number;
    }> = [];
    for (const drop of drops) {
      const point = this.project(drop.x, drop.y);
      const color =
        drop.item.kind === "ability-stone"
          ? 0xc084fc
          : drop.item.rarity === "rare"
            ? 0xffd166
            : drop.item.rarity === "magic"
              ? 0x60a5fa
              : 0xd1d5db;
      this.#combatGraphics.fillStyle(0x06101c, 0.55);
      this.#combatGraphics.fillEllipse(point.x, point.y + 3, 28, 12);
      this.#combatGraphics.fillStyle(color, 0.92);
      const marker = [
        new Phaser.Math.Vector2(point.x, point.y - 13),
        new Phaser.Math.Vector2(point.x + 10, point.y - 4),
        new Phaser.Math.Vector2(point.x, point.y + 5),
        new Phaser.Math.Vector2(point.x - 10, point.y - 4),
      ];
      this.#combatGraphics.fillPoints(marker, true);
      this.#combatGraphics.lineStyle(2, 0x08111f, 1);
      this.#combatGraphics.strokePoints(marker, true);
      if (drop.item.kind === "ability-stone") {
        this.#combatGraphics.lineStyle(2, 0xffffff, 0.9);
        this.#combatGraphics.strokeCircle(point.x, point.y - 4, 4);
      }
      liveDropIds.add(drop.dropId);
      const label = worldLootLabel(drop.item);
      const text = this.ensureLootLabel(drop.dropId, label.text, label.color);
      // Float the label above the marker tip; when labels from nearby drops
      // would overlap, push this one upward until it sits in a free row.
      let labelBottom = point.y - LOOT_LABEL_BASE_LIFT;
      const halfWidth = text.width / 2;
      const overlapsPlaced = (bottom: number): boolean =>
        placedLabelBounds.some(
          (bounds) =>
            point.x - halfWidth < bounds.right &&
            point.x + halfWidth > bounds.left &&
            bottom - text.height < bounds.bottom &&
            bottom > bounds.top,
        );
      while (overlapsPlaced(labelBottom)) {
        labelBottom -= text.height + LOOT_LABEL_STACK_GAP;
      }
      text.setPosition(point.x, labelBottom);
      placedLabelBounds.push({
        left: point.x - halfWidth,
        right: point.x + halfWidth,
        top: labelBottom - text.height,
        bottom: labelBottom,
      });
      const canvasPoint = this.scene.cameras.main.matrixCombined.transformPoint(
        point.x,
        point.y - 4,
      );
      const labelCanvasPoint =
        this.scene.cameras.main.matrixCombined.transformPoint(
          point.x,
          labelBottom,
        );
      rendered.push({
        dropId: drop.dropId,
        itemKind: drop.item.kind,
        canvasX: canvasPoint.x,
        canvasY: canvasPoint.y,
        labelText: label.text,
        labelColor: label.color,
        labelCanvasX: labelCanvasPoint.x,
        labelCanvasY: labelCanvasPoint.y,
      });
    }
    for (const [dropId, text] of this.#lootLabels) {
      if (!liveDropIds.has(dropId)) {
        text.destroy();
        this.#lootLabels.delete(dropId);
      }
    }
    this.#renderedLoot = rendered;
  }

  private ensureLootLabel(
    dropId: string,
    labelText: string,
    labelColor: string,
  ): Phaser.GameObjects.Text {
    const existing = this.#lootLabels.get(dropId);
    if (existing !== undefined) {
      if (existing.text !== labelText) {
        existing.setText(labelText);
      }
      return existing;
    }
    const created = this.scene.add
      .text(0, 0, labelText, {
        fontFamily: "monospace",
        fontSize: "11px",
        color: labelColor,
        backgroundColor: "rgba(6, 16, 28, 0.8)",
        padding: { x: 4, y: 1 },
        stroke: "#06101c",
        strokeThickness: 2,
      })
      .setOrigin(0.5, 1)
      .setDepth(PRESENTATION_DEPTH + 3);
    this.#lootLabels.set(dropId, created);
    return created;
  }

  private consumeEvents(events: readonly CombatArenaEvent[]): void {
    for (const event of events) {
      if (event.type === "damage-applied") {
        this.#impactCount += 1;
        if (event.targetId === "player") {
          this.#playerFlashUntil = performance.now() + 110;
          this.#enemyStrikeFeedbackCount += 1;
          this.#enemyStrikeUntil = performance.now() + 140;
        } else {
          this.#targetFlashUntil = performance.now() + 110;
        }
      } else if (
        event.type === "damage-ignored" &&
        event.targetId === "player"
      ) {
        this.#enemyStrikeFeedbackCount += 1;
        this.#enemyStrikeUntil = performance.now() + 140;
      } else if (event.type === "entity-died") {
        this.#deathFeedbackCount += 1;
      }
    }
  }

  private publishHud(state: CombatArenaDiagnostics): void {
    const assignments = this.#simulation.characterItemLoadout().assignments;
    const hud: CombatHudReadModel = {
      paused: this.#pausedForUi,
      playerHealth: state.playerHealth,
      playerMaxHealth: state.playerMaxHealth,
      playerDead: state.playerDead,
      manaCurrent: state.mana,
      manaMaximum: state.maxMana,
      placeholderExperienceCurrent: 0,
      placeholderExperienceMaximum: 100,
      abilities: HUD_SLOTS.map((slot) => {
        const abilityId = assignments[slot.slot];
        const definition =
          abilityId === null ? undefined : definitionById(abilityId);
        const activation = state.abilities.find(
          (candidate) => candidate.abilityId === abilityId,
        );
        const manaCost = activation?.manaCost ?? 0;
        const cooldownRemainingSeconds =
          (activation?.cooldownTicksRemaining ?? 0) / FIXED_TICKS_PER_SECOND;
        const cooldownMaximumSeconds =
          (definition?.cooldown.durationTicks ?? 0) / FIXED_TICKS_PER_SECOND;
        const hudState =
          activation?.kind === "insufficient-resource"
            ? ("insufficient-mana" as const)
            : activation?.kind === "unknown"
              ? ("busy" as const)
              : (activation?.kind ?? "ready");
        return {
          id: abilityId ?? `empty:${slot.slot}`,
          keyLabel: slot.keyLabel,
          accessibleKeyLabel: slot.accessibleKeyLabel,
          name: abilityId === null ? "Empty" : this.abilityName(abilityId),
          manaCost,
          cooldownRemainingSeconds,
          cooldownMaximumSeconds,
          state: hudState,
        };
      }),
      activeStatuses: state.statuses.map((status) => ({
        id: `${status.targetId}:${status.statusId}`,
        label: STATUS_LABELS[status.statusId],
        target: status.targetId === "player" ? "player" : "enemy",
        remainingSeconds: status.ticksRemaining / FIXED_TICKS_PER_SECOND,
      })),
    };
    const key = JSON.stringify(hud);
    if (key === this.#lastHudKey) {
      return;
    }
    this.#lastHudKey = key;
    this.canvas.dispatchEvent(
      new CustomEvent<CombatHudReadModel>("rarpg:combat-hud", {
        bubbles: true,
        detail: hud,
      }),
    );
  }

  private publishItemHud(force = false): void {
    const comparable = this.createItemHud(0);
    const key = JSON.stringify(comparable);
    if (!force && key === this.#lastItemHudKey) return;
    this.#lastItemHudKey = key;
    this.#itemHudRevision += 1;
    window.dispatchEvent(
      new CustomEvent<InventoryHudReadModel>(ITEM_HUD_EVENT, {
        detail: this.createItemHud(this.#itemHudRevision),
      }),
    );
  }

  private createItemHud(revision: number): InventoryHudReadModel {
    const loadout = this.#simulation.characterItemLoadout();
    const owned = new Set<CombatAbilityId>(loadout.ownedAbilities);
    const hasStone = loadout.inventory.some(
      (item) => item?.kind === "ability-stone",
    );
    return {
      revision,
      inventorySlots: loadout.inventory.map((item, index) => ({
        index,
        item: item === null ? null : this.itemHudModel(item),
      })),
      equipmentSlots: EQUIPMENT_SLOTS.map((slot) => ({
        slot,
        label: EQUIPMENT_SLOT_LABELS[slot],
        item:
          loadout.equipment[slot] === null
            ? null
            : this.equipmentHudModel(loadout.equipment[slot]),
      })),
      flaskSlots: FLASK_SLOTS.map((slot) => ({
        slot,
        label: FLASK_SLOT_LABELS[slot],
        item:
          loadout.flasks[slot] === null
            ? null
            : this.equipmentHudModel(loadout.flasks[slot]),
      })),
      abilityChoices: IMPLEMENTED_ABILITY_CATALOG.map((id) => ({
        id,
        displayName: this.abilityName(id),
        owned: owned.has(id),
        selectableFromStone: hasStone && !owned.has(id),
      })),
      loadout: HUD_SLOTS.map((slot) => {
        const abilityId = loadout.assignments[slot.slot];
        return {
          slot: slot.slot,
          keyLabel: slot.keyLabel,
          accessibleKeyLabel: slot.accessibleKeyLabel,
          abilityId,
          displayName:
            abilityId === null ? "Empty" : this.abilityName(abilityId),
          borrowedDefault: abilityId !== null && !owned.has(abilityId),
        };
      }),
      playerMaximumHealth: loadout.stats.maximumHealth,
      outgoingAbilityDamagePercent:
        loadout.stats.outgoingAbilityDamageBasisPoints / 100,
    };
  }

  private itemHudModel(item: ItemInstance) {
    return item.kind === "equipment"
      ? this.equipmentHudModel(item)
      : {
          kind: "ability-stone" as const,
          instanceId: item.instanceId,
          displayName: "Ability Stone",
          rarity: "common" as const,
          typeLabel: "Ability Stone" as const,
          quantity: item.quantity,
        };
  }

  private equipmentHudModel(
    item: EquipmentItemInstance,
  ): EquipmentItemHudReadModel {
    const base = equipmentBaseById(item.baseId);
    if (base === undefined) {
      throw new Error(
        `Cannot present unknown equipment base "${item.baseId}".`,
      );
    }
    const affixNames = item.affixes.map(
      ({ affixId }) => affixById(affixId)?.displayName ?? String(affixId),
    );
    const modifiers: ItemModifierHudReadModel[] = [
      ...base.baseModifiers.map((modifier, index) => ({
        id: `${base.id}:base-${index}`,
        source: "base" as const,
        label: formatItemModifierLabel(modifier),
        tier: null,
      })),
      ...item.affixes.map((affix) => ({
        id: affix.affixId,
        source: "affix" as const,
        label: formatItemModifierLabel(affix.modifier),
        tier: affix.tier,
      })),
    ];
    return {
      kind: "equipment",
      instanceId: item.instanceId,
      displayName:
        affixNames.length === 0
          ? base.displayName
          : `${affixNames.join(" ")} ${base.displayName}`,
      rarity: item.rarity,
      slotKind: base.slot,
      typeLabel:
        base.slot === "flask"
          ? base.tags.some((tag) => String(tag) === "tag:life-flask")
            ? "Life flask"
            : "Mana flask"
          : EQUIPMENT_TYPE_LABELS[base.slot],
      modifiers,
    };
  }

  private abilityName(abilityId: CombatAbilityId): string {
    return ABILITY_NAMES[abilityId] ?? String(abilityId);
  }

  private isCombatAbilityId(value: string): value is CombatAbilityId {
    return IMPLEMENTED_ABILITY_CATALOG.some((abilityId) => abilityId === value);
  }

  private project(
    x: number,
    y: number,
  ): { readonly x: number; readonly y: number } {
    return {
      x: ORIGIN_X + (x - y) * ISO_X_SCALE,
      y: ORIGIN_Y + (x + y) * ISO_Y_SCALE,
    };
  }

  private inverseProjectDelta(
    screenX: number,
    screenY: number,
  ): { readonly x: number; readonly y: number } {
    const difference = screenX / ISO_X_SCALE;
    const sum = screenY / ISO_Y_SCALE;
    return {
      x: (difference + sum) / 2,
      y: (sum - difference) / 2,
    };
  }
}

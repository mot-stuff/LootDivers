import Phaser from "phaser";

import type {
  CharacterSave,
  DamageResult,
  FlaskDrinkResult,
  FlaskSlot,
  ItemInstance,
  LoadoutSlot,
} from "../../core";
import type {
  CanvasViewportReadModel,
  CharacterHudReadModel,
  InventoryHudReadModel,
  ItemUiCommand,
  ProfessionUiCommand,
  ProgressionUiCommand,
  WorldUiCommand,
} from "../../presentation/shell-contracts";
import { applyCanvasViewport } from "../browser/canvas-viewport";
import { assertWebGL2Context } from "../browser/webgl2";
import {
  CombatArenaPresentation,
  type CombatPresentationDiagnostics,
} from "./combat-arena-presentation";
import {
  IsometricZoneAdapter,
  type ZoneLifecycleDiagnostics,
} from "./isometric-world";
import {
  FIXTURE_CAMERA_CONTRACT,
  SyntheticLifecyclePresentation,
  type FrameSampleSummary,
  type RawFrameSamples,
  type SyntheticPresentationDiagnostics,
} from "./synthetic-lifecycle-presentation";

const LOGICAL_WORLD_WIDTH = 960;
const LOGICAL_WORLD_HEIGHT = 540;
// Combat camera magnification on top of the fit-to-viewport zoom, so the
// player sprite reads larger. The camera recenters on the player every
// frame, so this only trades visible world area for character presence.
const COMBAT_CAMERA_ZOOM = 1.3;
let lastFixtureFailureDiagnostics: SyntheticPresentationDiagnostics | null =
  null;

class TechnicalWorldScene extends Phaser.Scene {
  readonly #onReady: (adapter: IsometricZoneAdapter) => void;
  readonly #onError: (error: Error) => void;
  readonly #fullFixture: boolean;
  readonly #combatPrototype: boolean;
  #fixture: SyntheticLifecyclePresentation | null = null;
  #combat: CombatArenaPresentation | null = null;

  public constructor(
    onReady: (adapter: IsometricZoneAdapter) => void,
    onError: (error: Error) => void,
    fullFixture: boolean,
    combatPrototype: boolean,
  ) {
    super("technical-isometric-world");
    this.#onReady = onReady;
    this.#onError = onError;
    this.#fullFixture = fullFixture;
    this.#combatPrototype = combatPrototype;
  }

  public create(): void {
    this.configureLogicalViewport();
    if (!this.#combatPrototype) {
      this.add
        .text(
          16,
          16,
          this.#fullFixture
            ? "TASK-P0-008 · BEHAVIORLESS LIFECYCLE FIXTURE"
            : "TASK-P0-006 · SYNTHETIC ISOMETRIC FIXTURE",
          {
            color: "#e8f1ff",
            fontFamily: "monospace",
            fontSize: "14px",
          },
        )
        .setDepth(4_000_000);
    }

    const adapter = new IsometricZoneAdapter(this, !this.#combatPrototype);
    void adapter
      .load()
      .then(async () => {
        if (this.#fullFixture) {
          this.#fixture = new SyntheticLifecyclePresentation(this);
          await this.#fixture.create();
          this.configureLogicalViewport();
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.#fixture?.dispose();
            this.#fixture = null;
          });
        }
        if (this.#combatPrototype) {
          this.#combat = new CombatArenaPresentation(this, this.game.canvas);
          this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
            this.#combat?.dispose();
            this.#combat = null;
          });
        }
        this.#onReady(adapter);
      })
      .catch((error: unknown) => {
        lastFixtureFailureDiagnostics =
          this.#fixture?.diagnostics() ?? lastFixtureFailureDiagnostics;
        this.#onError(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  }

  public override update(time: number, delta: number): void {
    this.#fixture?.update(time, delta);
    this.#combat?.update();
  }

  public configureLogicalViewport(): void {
    const logicalWidth = this.#fullFixture
      ? FIXTURE_CAMERA_CONTRACT.width
      : LOGICAL_WORLD_WIDTH;
    const logicalHeight = this.#fullFixture
      ? FIXTURE_CAMERA_CONTRACT.height
      : LOGICAL_WORLD_HEIGHT;
    const widthScale = this.scale.gameSize.width / logicalWidth;
    const heightScale = this.scale.gameSize.height / logicalHeight;
    const zoom =
      Math.min(widthScale, heightScale) *
      (this.#combatPrototype && !this.#fullFixture ? COMBAT_CAMERA_ZOOM : 1);
    this.cameras.main.setZoom(zoom);
    if (!this.#fullFixture) {
      this.cameras.main.setScroll(
        (LOGICAL_WORLD_WIDTH - this.scale.gameSize.width) / 2,
        (LOGICAL_WORLD_HEIGHT - this.scale.gameSize.height) / 2,
      );
    }
  }

  public fixtureDiagnostics(): SyntheticPresentationDiagnostics | null {
    return this.#fixture?.diagnostics() ?? null;
  }

  public beginFixtureSample(): void {
    this.#fixture?.beginSample();
  }

  public endFixtureSample(): FrameSampleSummary {
    if (this.#fixture === null) {
      throw new Error("Full lifecycle fixture is not active.");
    }
    return this.#fixture.endSample();
  }

  public disposeFixture(): void {
    this.#fixture?.dispose();
  }

  public async resetFixture(): Promise<void> {
    this.#fixture?.dispose();
    this.#fixture = new SyntheticLifecyclePresentation(this);
    await this.#fixture.create();
  }

  public async resetFixtureAtStep(steps: number): Promise<void> {
    this.#fixture?.dispose();
    this.#fixture = new SyntheticLifecyclePresentation(this, true);
    await this.#fixture.create();
    this.#fixture.advancePaused(steps);
  }

  public fixtureRawSamples(): RawFrameSamples {
    if (this.#fixture === null) {
      throw new Error("Full lifecycle fixture is not active.");
    }
    return this.#fixture.rawSamples();
  }

  public cycleFixtureActor(actor: number): {
    readonly destroyed: number;
    readonly created: number;
  } {
    if (this.#fixture === null) {
      throw new Error("Full lifecycle fixture is not active.");
    }
    return this.#fixture.cycleActor(actor);
  }

  public setFixtureCullingProbe(enabled: boolean): void {
    this.#fixture?.setCullingProbe(enabled);
  }

  public invalidateFixtureSample(reason: string): void {
    this.#fixture?.invalidateSample(reason);
  }

  public combatDiagnostics(): CombatPresentationDiagnostics | null {
    return this.#combat?.diagnostics() ?? null;
  }

  public resetCombat(): void {
    this.#combat?.reset();
  }

  public setCombatAimDirection(x: number, y: number): void {
    this.#combat?.setAimDirection(x, y);
  }

  public setCombatAutomationPaused(paused: boolean): void {
    this.#combat?.setAutomationPaused(paused);
  }

  public requestCombatDodge(): void {
    this.#combat?.requestDodge();
  }

  public requestCombatInteract(): void {
    this.#combat?.requestInteract();
  }

  public travelCombat(zoneId: string): void {
    this.#combat?.travelTo(zoneId);
  }

  public requestCombatPrimaryAttack(): void {
    this.#combat?.requestPrimaryAttack();
  }

  public setCombatMovement(x: number, y: number): void {
    this.#combat?.setMovement(x, y);
  }

  public requestCombatAbilitySlot(
    slot: LoadoutSlot,
    x?: number,
    y?: number,
  ): void {
    this.#combat?.requestAbilitySlot(slot, x, y);
  }

  public requestCombatCinderDart(): void {
    this.#combat?.requestCinderDart();
  }

  public requestCombatWinterPulse(x: number, y: number): void {
    this.#combat?.requestWinterPulse(x, y);
  }

  public requestCombatDefiantSignal(): void {
    this.#combat?.requestDefiantSignal();
  }

  public useCombatFlask(slot: FlaskSlot): FlaskDrinkResult {
    if (this.#combat === null) {
      throw new Error("Combat prototype is not active.");
    }
    return this.#combat.useFlask(slot);
  }

  public grantCombatFlask(item: ItemInstance, slot: FlaskSlot): boolean {
    if (this.#combat === null) {
      throw new Error("Combat prototype is not active.");
    }
    return this.#combat.grantAndEquipFlask(item, slot);
  }

  public advanceCombatPaused(steps: number): void {
    this.#combat?.advancePaused(steps);
  }

  public combatItemHud(): InventoryHudReadModel | null {
    return this.#combat?.itemHud() ?? null;
  }

  public combatCharacterHud(): CharacterHudReadModel | null {
    return this.#combat?.characterHud() ?? null;
  }

  public executeCombatItemCommand(command: ItemUiCommand): void {
    this.#combat?.executeItemCommand(command);
  }

  public executeCombatProgressionCommand(command: ProgressionUiCommand): void {
    this.#combat?.executeProgressionCommand(command);
  }

  public executeCombatProfessionCommand(command: ProfessionUiCommand): void {
    this.#combat?.executeProfessionCommand(command);
  }

  public executeCombatWorldCommand(command: WorldUiCommand): void {
    this.#combat?.executeWorldCommand(command);
  }

  public applyCombatPlayerDamage(amount: number): DamageResult {
    if (this.#combat === null) {
      throw new Error("Combat prototype is not active.");
    }
    return this.#combat.applyPlayerDamage(amount);
  }

  public captureCombatCharacterSave(): CharacterSave {
    if (this.#combat === null) {
      throw new Error("Combat prototype is not active.");
    }
    return this.#combat.captureCharacterSave();
  }

  public restoreCombatCharacterSave(save: CharacterSave): void {
    if (this.#combat === null) {
      throw new Error("Combat prototype is not active.");
    }
    this.#combat.restoreCharacterSave(save);
  }
}

export interface TechnicalWorldController {
  diagnostics(): ZoneLifecycleDiagnostics;
  load(url?: string): Promise<void>;
  pick(screenX: number, screenY: number): void;
  unload(): void;
}

export interface PhaserBootResult {
  readonly game: Phaser.Game;
  readonly rendererVersion: string;
  readonly world: TechnicalWorldController;
  readonly fixture: {
    diagnostics(): SyntheticPresentationDiagnostics | null;
    beginSample(): void;
    endSample(): FrameSampleSummary;
    dispose(): void;
    reset(): Promise<void>;
    resetAtStep(steps: number): Promise<void>;
    rawSamples(): RawFrameSamples;
    cycleActor(actor: number): {
      readonly destroyed: number;
      readonly created: number;
    };
    setCullingProbe(enabled: boolean): void;
  };
  readonly combat: {
    diagnostics(): CombatPresentationDiagnostics | null;
    reset(): void;
    setAimDirection(x: number, y: number): void;
    setAutomationPaused(paused: boolean): void;
    requestDodge(): void;
    requestInteract(): void;
    travelTo(zoneId: string): void;
    requestPrimaryAttack(): void;
    setMovement(x: number, y: number): void;
    requestAbilitySlot(slot: LoadoutSlot, x?: number, y?: number): void;
    requestCinderDart(): void;
    requestWinterPulse(x: number, y: number): void;
    requestDefiantSignal(): void;
    useFlask(slot: FlaskSlot): FlaskDrinkResult;
    grantAndEquipFlask(item: ItemInstance, slot: FlaskSlot): boolean;
    advancePaused(steps: number): void;
    itemHud(): InventoryHudReadModel | null;
    characterHud(): CharacterHudReadModel | null;
    executeItemCommand(command: ItemUiCommand): void;
    executeProgressionCommand(command: ProgressionUiCommand): void;
    executeProfessionCommand(command: ProfessionUiCommand): void;
    executeWorldCommand(command: WorldUiCommand): void;
    applyPlayerDamage(amount: number): DamageResult;
    captureCharacterSave(): CharacterSave;
    restoreCharacterSave(save: CharacterSave): void;
  };
  resize(viewport: CanvasViewportReadModel): void;
}

export interface PhaserBootOptions {
  readonly fullFixture?: boolean;
  readonly combatPrototype?: boolean;
}

export function bootPhaser(
  canvas: HTMLCanvasElement,
  context: WebGL2RenderingContext,
  options: PhaserBootOptions = {},
): Promise<PhaserBootResult> {
  lastFixtureFailureDiagnostics = null;
  return new Promise((resolve, reject) => {
    try {
      const gameRef: { current?: Phaser.Game } = {};
      const scene = new TechnicalWorldScene(
        (world) => {
          const game = gameRef.current;
          if (game === undefined) {
            reject(
              new Error("Phaser scene became ready before game creation."),
            );
            return;
          }
          try {
            resolve({
              game,
              rendererVersion: assertWebGL2Context(game.canvas),
              world,
              fixture: {
                diagnostics: () => scene.fixtureDiagnostics(),
                beginSample: () => {
                  scene.beginFixtureSample();
                },
                endSample: () => scene.endFixtureSample(),
                dispose: () => {
                  scene.disposeFixture();
                },
                reset: () => scene.resetFixture(),
                resetAtStep: (steps) => scene.resetFixtureAtStep(steps),
                rawSamples: () => scene.fixtureRawSamples(),
                cycleActor: (actor) => scene.cycleFixtureActor(actor),
                setCullingProbe: (enabled) => {
                  scene.setFixtureCullingProbe(enabled);
                },
              },
              combat: {
                diagnostics: () => scene.combatDiagnostics(),
                reset: () => {
                  scene.resetCombat();
                },
                setAimDirection: (x, y) => {
                  scene.setCombatAimDirection(x, y);
                },
                setAutomationPaused: (paused) => {
                  scene.setCombatAutomationPaused(paused);
                },
                requestDodge: () => {
                  scene.requestCombatDodge();
                },
                requestInteract: () => {
                  scene.requestCombatInteract();
                },
                travelTo: (zoneId) => {
                  scene.travelCombat(zoneId);
                },
                requestPrimaryAttack: () => {
                  scene.requestCombatPrimaryAttack();
                },
                setMovement: (x, y) => {
                  scene.setCombatMovement(x, y);
                },
                requestAbilitySlot: (slot, x, y) => {
                  scene.requestCombatAbilitySlot(slot, x, y);
                },
                requestCinderDart: () => {
                  scene.requestCombatCinderDart();
                },
                requestWinterPulse: (x, y) => {
                  scene.requestCombatWinterPulse(x, y);
                },
                requestDefiantSignal: () => {
                  scene.requestCombatDefiantSignal();
                },
                useFlask: (slot) => scene.useCombatFlask(slot),
                grantAndEquipFlask: (item, slot) =>
                  scene.grantCombatFlask(item, slot),
                advancePaused: (steps) => {
                  scene.advanceCombatPaused(steps);
                },
                itemHud: () => scene.combatItemHud(),
                characterHud: () => scene.combatCharacterHud(),
                executeItemCommand: (command) => {
                  scene.executeCombatItemCommand(command);
                },
                executeProgressionCommand: (command) => {
                  scene.executeCombatProgressionCommand(command);
                },
                executeProfessionCommand: (command) => {
                  scene.executeCombatProfessionCommand(command);
                },
                executeWorldCommand: (command) => {
                  scene.executeCombatWorldCommand(command);
                },
                applyPlayerDamage: (amount) =>
                  scene.applyCombatPlayerDamage(amount),
                captureCharacterSave: () => scene.captureCombatCharacterSave(),
                restoreCharacterSave: (save) => {
                  scene.restoreCombatCharacterSave(save);
                },
              },
              resize(viewport) {
                scene.invalidateFixtureSample("viewport-resized");
                game.scale.resize(
                  viewport.backingWidth,
                  viewport.backingHeight,
                );
                scene.configureLogicalViewport();
                applyCanvasViewport(game.canvas, viewport);
              },
            });
          } catch (error: unknown) {
            game.destroy(true);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
        (error) => {
          gameRef.current?.destroy(true);
          reject(error);
        },
        options.fullFixture ?? false,
        options.combatPrototype ?? true,
      );
      gameRef.current = new Phaser.Game({
        type: Phaser.WEBGL,
        width: canvas.width,
        height: canvas.height,
        canvas,
        // Phaser 4.2.1's GameConfig declaration omits WebGL2RenderingContext,
        // although its WebGL renderer accepts and uses the supplied context.
        context: context as unknown as CanvasRenderingContext2D,
        backgroundColor: "#101a2b",
        render: {
          antialias: true,
          transparent: false,
        },
        // Keyboard ownership stays in the browser adapter so DOM focus can gate
        // input before an intent is emitted.
        input: {
          keyboard: false,
        },
        scene,
      });
    } catch (error: unknown) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function fixtureFailureDiagnostics(): SyntheticPresentationDiagnostics | null {
  return lastFixtureFailureDiagnostics;
}

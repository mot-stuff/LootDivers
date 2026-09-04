import Phaser from "phaser";

import {
  ISO_LAYER_ORDER,
  ZONE_BUNDLE_VERSION,
  type CompiledZoneBundle,
  type ZoneLayer,
} from "../../world/contracts";
import {
  compareFootDepth,
  normalizeCanvasPoint,
  pickAuthoredCell,
  projectIsometric,
} from "../../world/projection";

const FIXTURE_URL = "/zones/technical-isometric.zone.json";
const MARKER_TEXTURE = "fixture:iso-marker-texture";

export interface ZoneLifecycleDiagnostics {
  readonly zoneId: string | null;
  readonly objectCount: number;
  readonly chunkCount: number;
  readonly assetCount: number;
  readonly pickedCell: string | null;
}

function isZoneBundle(value: unknown): value is CompiledZoneBundle {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<CompiledZoneBundle>;
  return (
    candidate.bundleVersion === ZONE_BUNDLE_VERSION &&
    candidate.sourceFormat === "tiled-json" &&
    typeof candidate.zoneId === "string" &&
    Array.isArray(candidate.layers) &&
    Array.isArray(candidate.markers)
  );
}

function tileColor(layer: ZoneLayer, gid: number): number {
  const colors: Record<string, number> = {
    ground: gid % 2 === 0 ? 0x244d5a : 0x2b5963,
    detail: 0x3e7780,
    low: 0x6f6751,
    overhang: 0xa8845a,
    foreground: 0x527b68,
  };
  return colors[layer.name] ?? 0xffffff;
}

export class IsometricZoneAdapter {
  readonly #scene: Phaser.Scene;
  readonly #objects: Phaser.GameObjects.GameObject[] = [];
  #bundle: CompiledZoneBundle | null = null;
  #chunkCount = 0;
  #pickedCell: string | null = null;
  #pickLabel: Phaser.GameObjects.Text | null = null;
  #pointerHandler: ((pointer: Phaser.Input.Pointer) => void) | null = null;

  public constructor(scene: Phaser.Scene) {
    this.#scene = scene;
  }

  public async load(url = FIXTURE_URL): Promise<void> {
    this.unload();
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Technical zone request failed with ${response.status}.`);
    }
    const candidate: unknown = await response.json();
    if (!isZoneBundle(candidate)) {
      throw new Error("Technical zone bundle has an incompatible contract.");
    }
    this.#bundle = candidate;
    this.#createMarkerTexture();
    this.#renderLayers(candidate);
    this.#renderMarkers(candidate);
    this.#installPicking();
  }

  public unload(): void {
    if (this.#pointerHandler !== null) {
      this.#scene.input.off("pointerdown", this.#pointerHandler);
      this.#pointerHandler = null;
    }
    for (const object of this.#objects.splice(0)) {
      object.destroy();
    }
    this.#pickLabel = null;
    this.#chunkCount = 0;
    this.#pickedCell = null;
    this.#bundle = null;
    if (this.#scene.textures.exists(MARKER_TEXTURE)) {
      this.#scene.textures.remove(MARKER_TEXTURE);
    }
  }

  public diagnostics(): ZoneLifecycleDiagnostics {
    return {
      zoneId: this.#bundle?.zoneId ?? null,
      objectCount: this.#objects.length,
      chunkCount: this.#chunkCount,
      assetCount: this.#scene.textures.exists(MARKER_TEXTURE) ? 1 : 0,
      pickedCell: this.#pickedCell,
    };
  }

  public pick(screenX: number, screenY: number): void {
    if (this.#bundle === null || this.#pickLabel === null) {
      throw new Error("Technical zone must be ready before picking.");
    }
    const picked = pickAuthoredCell({ x: screenX, y: screenY }, this.#bundle);
    this.#pickedCell =
      picked === null
        ? "outside"
        : `${picked.x},${picked.y},e${picked.elevation}`;
    this.#pickLabel.setText(`Pick: ${this.#pickedCell}`);
  }

  #createMarkerTexture(): void {
    const graphics = this.#scene.add.graphics();
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(16, 16, 12);
    graphics.lineStyle(3, 0x10212d, 1);
    graphics.strokeCircle(16, 16, 12);
    graphics.generateTexture(MARKER_TEXTURE, 32, 32);
    graphics.destroy();
  }

  #renderLayers(bundle: CompiledZoneBundle): void {
    for (const layer of bundle.layers) {
      for (const chunk of layer.chunks) {
        const graphics = this.#scene.add.graphics();
        for (const tile of chunk.tiles) {
          const point = projectIsometric(
            { x: tile.x, y: tile.y, elevation: tile.elevation },
            bundle.projection,
          );
          const halfWidth = bundle.projection.tileWidth / 2;
          const halfHeight = bundle.projection.tileHeight / 2;
          const diamond = [
            new Phaser.Math.Vector2(point.x, point.y),
            new Phaser.Math.Vector2(point.x + halfWidth, point.y + halfHeight),
            new Phaser.Math.Vector2(point.x, point.y + halfHeight * 2),
            new Phaser.Math.Vector2(point.x - halfWidth, point.y + halfHeight),
          ];
          graphics.fillStyle(tileColor(layer, tile.gid), 1);
          graphics.fillPoints(diamond, true);
          graphics.lineStyle(1, 0x10212d, 0.45);
          graphics.strokePoints(diamond, true);
        }
        const layerIndex = ISO_LAYER_ORDER.indexOf(layer.name);
        const depth =
          layer.name === "foreground"
            ? 3_000_000
            : layer.name === "overhang"
              ? 2_000_000
              : layerIndex * 10_000;
        graphics.setDepth(depth);
        if (layer.name === "foreground") {
          graphics.setAlpha(0.72);
        }
        this.#objects.push(graphics);
        this.#chunkCount += 1;
      }
    }
  }

  #renderMarkers(bundle: CompiledZoneBundle): void {
    const sorted = [...bundle.markers].sort(compareFootDepth);
    sorted.forEach((marker, index) => {
      const foot = projectIsometric(
        {
          x: marker.gridX,
          y: marker.gridY,
          elevation: marker.elevation,
        },
        bundle.projection,
      );
      const image = this.#scene.add
        .image(foot.x, foot.y + bundle.projection.tileHeight, MARKER_TEXTURE)
        .setOrigin(0.5, 1)
        .setTint(Phaser.Display.Color.HexStringToColor(marker.color).color)
        .setDepth(
          marker.elevation * 1_000_000 +
            (marker.gridX + marker.gridY) * 1_000 +
            index,
        );
      image.setData("fixtureMarkerId", marker.id);
      const label = this.#scene.add
        .text(image.x, image.y - 34, marker.label, {
          color: "#ffffff",
          fontFamily: "monospace",
          fontSize: "13px",
          stroke: "#10212d",
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setDepth(image.depth + 1);
      this.#objects.push(image, label);
    });
  }

  #installPicking(): void {
    this.#pickLabel = this.#scene.add
      .text(16, 510, "Pick: click a diamond", {
        color: "#e8f1ff",
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setDepth(4_000_000);
    this.#objects.push(this.#pickLabel);
    this.#pointerHandler = (pointer) => {
      const event = pointer.event;
      if (
        event === null ||
        !("clientX" in event) ||
        !("clientY" in event) ||
        typeof event.clientX !== "number" ||
        typeof event.clientY !== "number"
      ) {
        return;
      }
      const canvas = this.#scene.game.canvas;
      const bounds = canvas.getBoundingClientRect();
      const camera = this.#scene.cameras.main;
      const screenPoint = normalizeCanvasPoint(
        { x: event.clientX, y: event.clientY },
        {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        },
        { width: canvas.width, height: canvas.height },
        { width: camera.width, height: camera.height },
      );
      if (screenPoint === null) {
        return;
      }
      const worldPoint = camera.getWorldPoint(screenPoint.x, screenPoint.y);
      this.pick(worldPoint.x, worldPoint.y);
    };
    this.#scene.input.on("pointerdown", this.#pointerHandler);
  }
}

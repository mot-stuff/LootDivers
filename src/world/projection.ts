import type {
  CompiledZoneBundle,
  IsoProjection,
  ZoneMarker,
} from "./contracts";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PixelDimensions {
  readonly width: number;
  readonly height: number;
}

export interface PickedZoneCell extends GridPoint {
  readonly x: number;
  readonly y: number;
}

export function projectIsometric(
  point: GridPoint,
  projection: IsoProjection,
): ScreenPoint {
  return {
    x: projection.originX + (point.x - point.y) * (projection.tileWidth / 2),
    y:
      projection.originY +
      (point.x + point.y) * (projection.tileHeight / 2) -
      point.elevation * projection.elevationUnit,
  };
}

export function unprojectIsometric(
  point: ScreenPoint,
  elevation: number,
  projection: IsoProjection,
): GridPoint {
  const screenX = point.x - projection.originX;
  const screenY =
    point.y - projection.originY + elevation * projection.elevationUnit;
  const x = screenX / projection.tileWidth + screenY / projection.tileHeight;
  const y = screenY / projection.tileHeight - screenX / projection.tileWidth;

  return { x, y, elevation };
}

export function normalizeCanvasPoint(
  clientPoint: ScreenPoint,
  bounds: CanvasBounds,
  backing: PixelDimensions,
  logical: PixelDimensions,
): ScreenPoint | null {
  if (
    bounds.width <= 0 ||
    bounds.height <= 0 ||
    backing.width <= 0 ||
    backing.height <= 0 ||
    logical.width <= 0 ||
    logical.height <= 0
  ) {
    return null;
  }

  const backingX =
    (clientPoint.x - bounds.left) * (backing.width / bounds.width);
  const backingY =
    (clientPoint.y - bounds.top) * (backing.height / bounds.height);

  return {
    x: backingX * (logical.width / backing.width),
    y: backingY * (logical.height / backing.height),
  };
}

export function footDepthKey(marker: ZoneMarker): string {
  const elevationBand = String(marker.elevation).padStart(4, "0");
  const footRow = String(marker.gridX + marker.gridY).padStart(8, "0");
  return `${elevationBand}:${footRow}:${marker.id}`;
}

export function compareFootDepth(left: ZoneMarker, right: ZoneMarker): number {
  const leftKey = footDepthKey(left);
  const rightKey = footDepthKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

export function pickAuthoredCell(
  point: ScreenPoint,
  bundle: CompiledZoneBundle,
): PickedZoneCell | null {
  const surfaceLayers = bundle.layers.filter(
    ({ name }) => name !== "overhang" && name !== "foreground",
  );
  const elevations = [
    ...new Set(
      surfaceLayers.flatMap(({ chunks }) =>
        chunks.flatMap(({ tiles }) => tiles.map(({ elevation }) => elevation)),
      ),
    ),
  ].sort((left, right) => right - left);

  for (const elevation of elevations) {
    const grid = unprojectIsometric(point, elevation, bundle.projection);
    const x = Math.floor(grid.x);
    const y = Math.floor(grid.y);
    if (x < 0 || y < 0 || x >= bundle.width || y >= bundle.height) {
      continue;
    }
    const authored = surfaceLayers.some(({ chunks }) =>
      chunks.some(({ tiles }) =>
        tiles.some(
          (tile) =>
            tile.x === x && tile.y === y && tile.elevation === elevation,
        ),
      ),
    );
    if (authored) {
      return { x, y, elevation };
    }
  }

  return null;
}

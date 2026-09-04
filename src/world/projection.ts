import type { IsoProjection, ZoneMarker } from "./contracts";

export interface GridPoint {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

export interface ScreenPoint {
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

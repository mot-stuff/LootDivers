import {
  SpatialQueryBuffer,
  UniformSpatialHash,
  type Point2,
} from "./spatial.ts";

export interface MutableVector2 {
  x: number;
  y: number;
}

export function computeLocalSeparation(
  spatial: UniformSpatialHash,
  selfId: number,
  position: Point2,
  elevation: number,
  radius: number,
  maximumMagnitude: number,
  queryBuffer: SpatialQueryBuffer,
  output: MutableVector2,
): number {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    !Number.isFinite(maximumMagnitude) ||
    maximumMagnitude < 0
  ) {
    throw new RangeError(
      "Separation radius must be positive and maximumMagnitude non-negative.",
    );
  }

  output.x = 0;
  output.y = 0;
  spatial.queryCircle({ ...position, radius }, elevation, queryBuffer);
  queryBuffer.records.sort((left, right) => left.id - right.id);

  let neighbors = 0;
  for (const record of queryBuffer.records) {
    if (record.id === selfId) {
      continue;
    }
    const otherX = (record.bounds.minX + record.bounds.maxX) * 0.5;
    const otherY = (record.bounds.minY + record.bounds.maxY) * 0.5;
    let dx = position.x - otherX;
    let dy = position.y - otherY;
    let distance = Math.hypot(dx, dy);
    if (distance >= radius) {
      continue;
    }
    if (distance === 0) {
      dx = selfId < record.id ? -1 : 1;
      dy = 0;
      distance = 1;
    }
    const strength = (radius - distance) / radius;
    output.x += (dx / distance) * strength;
    output.y += (dy / distance) * strength;
    neighbors += 1;
  }

  const magnitude = Math.hypot(output.x, output.y);
  if (magnitude > maximumMagnitude && magnitude > 0) {
    const scale = maximumMagnitude / magnitude;
    output.x *= scale;
    output.y *= scale;
  }
  return neighbors;
}

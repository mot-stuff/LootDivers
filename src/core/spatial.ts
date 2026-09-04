export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface Circle extends Point2 {
  readonly radius: number;
}

export interface Aabb {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface Segment {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
}

export interface SpatialRecord {
  readonly id: number;
  readonly elevation: number;
  readonly bounds: Aabb;
}

interface MutableSpatialRecord {
  id: number;
  elevation: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
  cells: string[];
}

export class SpatialQueryBuffer {
  readonly records: SpatialRecord[] = [];
  private readonly seen = new Set<number>();

  reset(): void {
    this.records.length = 0;
    this.seen.clear();
  }

  add(record: SpatialRecord): void {
    if (!this.seen.has(record.id)) {
      this.seen.add(record.id);
      this.records.push(record);
    }
  }
}

function validateAabb(bounds: Aabb): void {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY) ||
    bounds.minX > bounds.maxX ||
    bounds.minY > bounds.maxY
  ) {
    throw new RangeError("Spatial bounds must be finite and ordered.");
  }
}

function overlapsAabb(left: Aabb, right: Aabb): boolean {
  return (
    left.minX <= right.maxX &&
    left.maxX >= right.minX &&
    left.minY <= right.maxY &&
    left.maxY >= right.minY
  );
}

export class UniformSpatialHash {
  private readonly cells = new Map<string, MutableSpatialRecord[]>();
  private readonly records = new Map<number, MutableSpatialRecord>();
  readonly cellSize: number;

  constructor(cellSize: number) {
    if (!Number.isFinite(cellSize) || cellSize <= 0) {
      throw new RangeError(
        "Spatial hash cellSize must be finite and positive.",
      );
    }
    this.cellSize = cellSize;
  }

  get size(): number {
    return this.records.size;
  }

  upsert(id: number, elevation: number, bounds: Aabb): void {
    if (!Number.isSafeInteger(id) || id < 0) {
      throw new RangeError(
        "Spatial record id must be a non-negative safe integer.",
      );
    }
    if (!Number.isSafeInteger(elevation)) {
      throw new RangeError("Spatial record elevation must be a safe integer.");
    }
    validateAabb(bounds);
    const existing = this.records.get(id);
    if (existing !== undefined) {
      const priorMinX = Math.floor(existing.bounds.minX / this.cellSize);
      const priorMinY = Math.floor(existing.bounds.minY / this.cellSize);
      const priorMaxX = Math.floor(existing.bounds.maxX / this.cellSize);
      const priorMaxY = Math.floor(existing.bounds.maxY / this.cellSize);
      const nextMinX = Math.floor(bounds.minX / this.cellSize);
      const nextMinY = Math.floor(bounds.minY / this.cellSize);
      const nextMaxX = Math.floor(bounds.maxX / this.cellSize);
      const nextMaxY = Math.floor(bounds.maxY / this.cellSize);
      if (
        existing.elevation === elevation &&
        priorMinX === nextMinX &&
        priorMinY === nextMinY &&
        priorMaxX === nextMaxX &&
        priorMaxY === nextMaxY
      ) {
        existing.bounds.minX = bounds.minX;
        existing.bounds.minY = bounds.minY;
        existing.bounds.maxX = bounds.maxX;
        existing.bounds.maxY = bounds.maxY;
        return;
      }
      this.detach(existing);
      existing.elevation = elevation;
      existing.bounds.minX = bounds.minX;
      existing.bounds.minY = bounds.minY;
      existing.bounds.maxX = bounds.maxX;
      existing.bounds.maxY = bounds.maxY;
      existing.cells.length = 0;
      this.attach(existing);
      return;
    }

    const record: MutableSpatialRecord = {
      id,
      elevation,
      bounds: { ...bounds },
      cells: [],
    };
    this.attach(record);
    this.records.set(id, record);
  }

  remove(id: number): boolean {
    const record = this.records.get(id);
    if (record === undefined) {
      return false;
    }
    this.detach(record);
    this.records.delete(id);
    return true;
  }

  private detach(record: MutableSpatialRecord): void {
    for (const key of record.cells) {
      const bucket = this.cells.get(key);
      if (bucket === undefined) {
        continue;
      }
      const index = bucket.indexOf(record);
      if (index >= 0) {
        const last = bucket.pop();
        if (last !== undefined && index < bucket.length) {
          bucket[index] = last;
        }
      }
      if (bucket.length === 0) {
        this.cells.delete(key);
      }
    }
  }

  private attach(record: MutableSpatialRecord): void {
    this.visitCellKeys(record.bounds, (key) => {
      let bucket = this.cells.get(key);
      if (bucket === undefined) {
        bucket = [];
        this.cells.set(key, bucket);
      }
      bucket.push(record);
      record.cells.push(key);
    });
  }

  clear(): void {
    this.cells.clear();
    this.records.clear();
  }

  queryAabb(
    bounds: Aabb,
    elevation: number,
    output: SpatialQueryBuffer,
  ): number {
    validateAabb(bounds);
    output.reset();
    this.visitCellKeys(bounds, (key) => {
      const bucket = this.cells.get(key);
      if (bucket === undefined) {
        return;
      }
      for (const record of bucket) {
        if (
          record.elevation === elevation &&
          overlapsAabb(record.bounds, bounds)
        ) {
          output.add(record);
        }
      }
    });
    return output.records.length;
  }

  queryCircle(
    circle: Circle,
    elevation: number,
    output: SpatialQueryBuffer,
  ): number {
    if (!Number.isFinite(circle.radius) || circle.radius < 0) {
      throw new RangeError("Circle radius must be finite and non-negative.");
    }
    const bounds = {
      minX: circle.x - circle.radius,
      minY: circle.y - circle.radius,
      maxX: circle.x + circle.radius,
      maxY: circle.y + circle.radius,
    };
    this.queryAabb(bounds, elevation, output);
    let write = 0;
    for (const record of output.records) {
      if (circleIntersectsAabb(circle, record.bounds)) {
        output.records[write] = record;
        write += 1;
      }
    }
    output.records.length = write;
    return write;
  }

  querySegment(
    segment: Segment,
    padding: number,
    elevation: number,
    output: SpatialQueryBuffer,
  ): number {
    if (!Number.isFinite(padding) || padding < 0) {
      throw new RangeError("Segment padding must be finite and non-negative.");
    }
    const bounds = {
      minX: Math.min(segment.startX, segment.endX) - padding,
      minY: Math.min(segment.startY, segment.endY) - padding,
      maxX: Math.max(segment.startX, segment.endX) + padding,
      maxY: Math.max(segment.startY, segment.endY) + padding,
    };
    this.queryAabb(bounds, elevation, output);
    let write = 0;
    for (const record of output.records) {
      const expanded = {
        minX: record.bounds.minX - padding,
        minY: record.bounds.minY - padding,
        maxX: record.bounds.maxX + padding,
        maxY: record.bounds.maxY + padding,
      };
      if (segmentIntersectsAabb(segment, expanded)) {
        output.records[write] = record;
        write += 1;
      }
    }
    output.records.length = write;
    return write;
  }

  private visitCellKeys(bounds: Aabb, visit: (key: string) => void): void {
    const minCellX = Math.floor(bounds.minX / this.cellSize);
    const minCellY = Math.floor(bounds.minY / this.cellSize);
    const maxCellX = Math.floor(bounds.maxX / this.cellSize);
    const maxCellY = Math.floor(bounds.maxY / this.cellSize);
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        visit(`${cellX},${cellY}`);
      }
    }
  }
}

export function circlesOverlap(left: Circle, right: Circle): boolean {
  const radius = left.radius + right.radius;
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy <= radius * radius;
}

export function aabbsOverlap(left: Aabb, right: Aabb): boolean {
  validateAabb(left);
  validateAabb(right);
  return overlapsAabb(left, right);
}

export function circleIntersectsAabb(circle: Circle, bounds: Aabb): boolean {
  validateAabb(bounds);
  const closestX = Math.max(bounds.minX, Math.min(circle.x, bounds.maxX));
  const closestY = Math.max(bounds.minY, Math.min(circle.y, bounds.maxY));
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

export function segmentIntersectsCircle(
  segment: Segment,
  circle: Circle,
): boolean {
  const dx = segment.endX - segment.startX;
  const dy = segment.endY - segment.startY;
  const lengthSquared = dx * dx + dy * dy;
  const projection =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((circle.x - segment.startX) * dx +
              (circle.y - segment.startY) * dy) /
              lengthSquared,
          ),
        );
  const closestX = segment.startX + dx * projection;
  const closestY = segment.startY + dy * projection;
  const offsetX = circle.x - closestX;
  const offsetY = circle.y - closestY;
  return offsetX * offsetX + offsetY * offsetY <= circle.radius * circle.radius;
}

export function segmentIntersectsAabb(segment: Segment, bounds: Aabb): boolean {
  validateAabb(bounds);
  let minimum = 0;
  let maximum = 1;
  const dx = segment.endX - segment.startX;
  const dy = segment.endY - segment.startY;
  const axes = [
    [-dx, segment.startX - bounds.minX],
    [dx, bounds.maxX - segment.startX],
    [-dy, segment.startY - bounds.minY],
    [dy, bounds.maxY - segment.startY],
  ] as const;
  for (const [denominator, numerator] of axes) {
    if (denominator === 0) {
      if (numerator < 0) {
        return false;
      }
      continue;
    }
    const ratio = numerator / denominator;
    if (denominator < 0) {
      minimum = Math.max(minimum, ratio);
    } else {
      maximum = Math.min(maximum, ratio);
    }
    if (minimum > maximum) {
      return false;
    }
  }
  return true;
}

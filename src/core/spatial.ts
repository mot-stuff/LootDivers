export interface Point2 {
  readonly x: number;
  readonly y: number;
}

export interface Circle extends Point2 {
  readonly radius: number;
}

export interface MutableCircleQuery {
  x: number;
  y: number;
  radius: number;
  elevation: number;
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

export interface MutableSegmentQuery {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  padding: number;
  elevation: number;
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
  cells: (number | undefined)[];
  cellCount: number;
  queryGeneration: number;
}

interface SpatialBucket {
  records: (MutableSpatialRecord | undefined)[];
  count: number;
  highWaterMark: number;
}

export interface SpatialAllocationDiagnostics {
  bucketCount: number;
  bucketCreations: number;
  bucketCapacityGrowths: number;
  recordCellCapacityGrowths: number;
  queryCount: number;
}

const CELL_COORDINATE_OFFSET = 33_554_432;
const CELL_KEY_STRIDE = 67_108_864;
const MINIMUM_CELL_COORDINATE = -CELL_COORDINATE_OFFSET;
const MAXIMUM_CELL_COORDINATE = CELL_COORDINATE_OFFSET - 1;

export class SpatialQueryBuffer {
  readonly records: (SpatialRecord | undefined)[];
  readonly capacity: number;
  count = 0;
  highWaterMark = 0;
  overflowCount = 0;

  constructor(capacity = 256) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        "Spatial query capacity must be a positive integer.",
      );
    }
    this.capacity = capacity;
    this.records = new Array<SpatialRecord | undefined>(capacity);
  }

  reset(): void {
    this.count = 0;
  }

  addSorted(record: SpatialRecord): void {
    if (this.count >= this.capacity) {
      this.overflowCount += 1;
      throw new RangeError(
        `Spatial query capacity ${this.capacity} was exceeded; increase the caller-owned buffer explicitly.`,
      );
    }
    let index = this.count;
    while (index > 0 && (this.records[index - 1]?.id ?? -1) > record.id) {
      this.records[index] = this.records[index - 1];
      index -= 1;
    }
    this.records[index] = record;
    this.count += 1;
    if (this.count > this.highWaterMark) {
      this.highWaterMark = this.count;
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

function cellKey(cellX: number, cellY: number): number {
  if (
    cellX < MINIMUM_CELL_COORDINATE ||
    cellX > MAXIMUM_CELL_COORDINATE ||
    cellY < MINIMUM_CELL_COORDINATE ||
    cellY > MAXIMUM_CELL_COORDINATE
  ) {
    throw new RangeError(
      `Spatial cell (${cellX}, ${cellY}) exceeds the numeric key range.`,
    );
  }
  return (
    (cellX + CELL_COORDINATE_OFFSET) * CELL_KEY_STRIDE +
    cellY +
    CELL_COORDINATE_OFFSET
  );
}

function circleIntersectsBounds(
  x: number,
  y: number,
  radius: number,
  bounds: Aabb,
): boolean {
  const closestX = Math.max(bounds.minX, Math.min(x, bounds.maxX));
  const closestY = Math.max(bounds.minY, Math.min(y, bounds.maxY));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function segmentIntersectsBounds(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  let minimum = 0;
  let maximum = 1;
  const dx = endX - startX;
  const dy = endY - startY;
  if (dx === 0) {
    if (startX < minX || startX > maxX) {
      return false;
    }
  } else {
    const inverseX = 1 / dx;
    const firstX = (minX - startX) * inverseX;
    const secondX = (maxX - startX) * inverseX;
    minimum = Math.max(minimum, Math.min(firstX, secondX));
    maximum = Math.min(maximum, Math.max(firstX, secondX));
    if (minimum > maximum) {
      return false;
    }
  }
  if (dy === 0) {
    return startY >= minY && startY <= maxY;
  }
  const inverseY = 1 / dy;
  const firstY = (minY - startY) * inverseY;
  const secondY = (maxY - startY) * inverseY;
  minimum = Math.max(minimum, Math.min(firstY, secondY));
  maximum = Math.min(maximum, Math.max(firstY, secondY));
  return minimum <= maximum;
}

export class UniformSpatialHash {
  private readonly cells = new Map<number, SpatialBucket>();
  private readonly records = new Map<number, MutableSpatialRecord>();
  private queryGeneration = 0;
  private bucketCreations = 0;
  private bucketCapacityGrowths = 0;
  private recordCellCapacityGrowths = 0;
  private queryCount = 0;
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

  reserve(bounds: Aabb, bucketCapacity = 8): void {
    validateAabb(bounds);
    if (!Number.isInteger(bucketCapacity) || bucketCapacity <= 0) {
      throw new RangeError(
        "Reserved bucket capacity must be a positive integer.",
      );
    }
    const minCellX = Math.floor(bounds.minX / this.cellSize);
    const minCellY = Math.floor(bounds.minY / this.cellSize);
    const maxCellX = Math.floor(bounds.maxX / this.cellSize);
    const maxCellY = Math.floor(bounds.maxY / this.cellSize);
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        this.requireBucket(cellKey(cellX, cellY), bucketCapacity);
      }
    }
  }

  writeAllocationDiagnostics(output: SpatialAllocationDiagnostics): void {
    output.bucketCount = this.cells.size;
    output.bucketCreations = this.bucketCreations;
    output.bucketCapacityGrowths = this.bucketCapacityGrowths;
    output.recordCellCapacityGrowths = this.recordCellCapacityGrowths;
    output.queryCount = this.queryCount;
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
        this.copyBounds(existing, bounds);
        return;
      }
      this.detach(existing);
      existing.elevation = elevation;
      this.copyBounds(existing, bounds);
      existing.cellCount = 0;
      this.attach(existing);
      return;
    }

    const record: MutableSpatialRecord = {
      id,
      elevation,
      bounds: { ...bounds },
      cells: new Array<number | undefined>(4),
      cellCount: 0,
      queryGeneration: 0,
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

  clear(): void {
    this.cells.clear();
    this.records.clear();
    this.queryGeneration = 0;
    this.bucketCreations = 0;
    this.bucketCapacityGrowths = 0;
    this.recordCellCapacityGrowths = 0;
    this.queryCount = 0;
  }

  queryAabb(
    bounds: Aabb,
    elevation: number,
    output: SpatialQueryBuffer,
  ): number {
    validateAabb(bounds);
    return this.queryBounds(
      bounds.minX,
      bounds.minY,
      bounds.maxX,
      bounds.maxY,
      elevation,
      output,
      0,
      undefined,
      undefined,
    );
  }

  queryCircle(query: MutableCircleQuery, output: SpatialQueryBuffer): number {
    if (
      !Number.isFinite(query.x) ||
      !Number.isFinite(query.y) ||
      !Number.isFinite(query.radius) ||
      query.radius < 0
    ) {
      throw new RangeError(
        "Circle query values must be finite and non-negative.",
      );
    }
    return this.queryBounds(
      query.x - query.radius,
      query.y - query.radius,
      query.x + query.radius,
      query.y + query.radius,
      query.elevation,
      output,
      1,
      query,
      undefined,
    );
  }

  querySegment(query: MutableSegmentQuery, output: SpatialQueryBuffer): number {
    if (
      !Number.isFinite(query.startX) ||
      !Number.isFinite(query.startY) ||
      !Number.isFinite(query.endX) ||
      !Number.isFinite(query.endY) ||
      !Number.isFinite(query.padding) ||
      query.padding < 0
    ) {
      throw new RangeError(
        "Segment query values must be finite and padding non-negative.",
      );
    }
    return this.queryBounds(
      Math.min(query.startX, query.endX) - query.padding,
      Math.min(query.startY, query.endY) - query.padding,
      Math.max(query.startX, query.endX) + query.padding,
      Math.max(query.startY, query.endY) + query.padding,
      query.elevation,
      output,
      2,
      undefined,
      query,
    );
  }

  private queryBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    elevation: number,
    output: SpatialQueryBuffer,
    narrowKind: 0 | 1 | 2,
    circleQuery: MutableCircleQuery | undefined,
    segmentQuery: MutableSegmentQuery | undefined,
  ): number {
    output.reset();
    this.queryCount += 1;
    this.queryGeneration = (this.queryGeneration + 1) >>> 0;
    if (this.queryGeneration === 0) {
      for (const record of this.records.values()) {
        record.queryGeneration = 0;
      }
      this.queryGeneration = 1;
    }
    const generation = this.queryGeneration;
    const minCellX = Math.floor(minX / this.cellSize);
    const minCellY = Math.floor(minY / this.cellSize);
    const maxCellX = Math.floor(maxX / this.cellSize);
    const maxCellY = Math.floor(maxY / this.cellSize);
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const bucket = this.cells.get(cellKey(cellX, cellY));
        if (bucket === undefined) {
          continue;
        }
        for (let index = 0; index < bucket.count; index += 1) {
          const record = bucket.records[index];
          if (record === undefined) {
            continue;
          }
          if (
            record.queryGeneration !== generation &&
            record.elevation === elevation &&
            record.bounds.minX <= maxX &&
            record.bounds.maxX >= minX &&
            record.bounds.minY <= maxY &&
            record.bounds.maxY >= minY &&
            (narrowKind === 0 ||
              (narrowKind === 1 &&
                circleQuery !== undefined &&
                circleIntersectsBounds(
                  circleQuery.x,
                  circleQuery.y,
                  circleQuery.radius,
                  record.bounds,
                )) ||
              (narrowKind === 2 &&
                segmentQuery !== undefined &&
                segmentIntersectsBounds(
                  segmentQuery.startX,
                  segmentQuery.startY,
                  segmentQuery.endX,
                  segmentQuery.endY,
                  record.bounds.minX - segmentQuery.padding,
                  record.bounds.minY - segmentQuery.padding,
                  record.bounds.maxX + segmentQuery.padding,
                  record.bounds.maxY + segmentQuery.padding,
                )))
          ) {
            record.queryGeneration = generation;
            output.addSorted(record);
          }
        }
      }
    }
    return output.count;
  }

  private copyBounds(record: MutableSpatialRecord, bounds: Aabb): void {
    record.bounds.minX = bounds.minX;
    record.bounds.minY = bounds.minY;
    record.bounds.maxX = bounds.maxX;
    record.bounds.maxY = bounds.maxY;
  }

  private detach(record: MutableSpatialRecord): void {
    for (let cellIndex = 0; cellIndex < record.cellCount; cellIndex += 1) {
      const key = record.cells[cellIndex];
      if (key === undefined) {
        continue;
      }
      const bucket = this.cells.get(key);
      if (bucket === undefined) {
        continue;
      }
      let index = -1;
      for (let candidate = 0; candidate < bucket.count; candidate += 1) {
        if (bucket.records[candidate] === record) {
          index = candidate;
          break;
        }
      }
      if (index >= 0) {
        bucket.count -= 1;
        const last = bucket.records[bucket.count];
        bucket.records[bucket.count] = undefined;
        if (last !== undefined && index < bucket.count) {
          bucket.records[index] = last;
        }
      }
    }
  }

  private attach(record: MutableSpatialRecord): void {
    const minCellX = Math.floor(record.bounds.minX / this.cellSize);
    const minCellY = Math.floor(record.bounds.minY / this.cellSize);
    const maxCellX = Math.floor(record.bounds.maxX / this.cellSize);
    const maxCellY = Math.floor(record.bounds.maxY / this.cellSize);
    for (let cellY = minCellY; cellY <= maxCellY; cellY += 1) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
        const key = cellKey(cellX, cellY);
        const bucket = this.requireBucket(key, 4);
        this.ensureBucketCapacity(bucket, bucket.count + 1);
        bucket.records[bucket.count] = record;
        bucket.count += 1;
        this.ensureRecordCellCapacity(record, record.cellCount + 1);
        record.cells[record.cellCount] = key;
        record.cellCount += 1;
        if (bucket.count > bucket.highWaterMark) {
          bucket.highWaterMark = bucket.count;
        }
      }
    }
  }

  private requireBucket(key: number, capacity: number): SpatialBucket {
    let bucket = this.cells.get(key);
    if (bucket === undefined) {
      bucket = {
        records: new Array<MutableSpatialRecord | undefined>(capacity),
        count: 0,
        highWaterMark: 0,
      };
      this.cells.set(key, bucket);
      this.bucketCreations += 1;
    } else {
      this.ensureBucketCapacity(bucket, capacity);
    }
    return bucket;
  }

  private ensureBucketCapacity(
    bucket: SpatialBucket,
    minimumCapacity: number,
  ): void {
    if (bucket.records.length >= minimumCapacity) {
      return;
    }
    const next = new Array<MutableSpatialRecord | undefined>(
      Math.max(minimumCapacity, bucket.records.length * 2),
    );
    for (let index = 0; index < bucket.count; index += 1) {
      next[index] = bucket.records[index];
    }
    bucket.records = next;
    this.bucketCapacityGrowths += 1;
  }

  private ensureRecordCellCapacity(
    record: MutableSpatialRecord,
    minimumCapacity: number,
  ): void {
    if (record.cells.length >= minimumCapacity) {
      return;
    }
    const next = new Array<number | undefined>(
      Math.max(minimumCapacity, record.cells.length * 2),
    );
    for (let index = 0; index < record.cellCount; index += 1) {
      next[index] = record.cells[index];
    }
    record.cells = next;
    this.recordCellCapacityGrowths += 1;
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
  return circleIntersectsBounds(circle.x, circle.y, circle.radius, bounds);
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
  return segmentIntersectsBounds(
    segment.startX,
    segment.startY,
    segment.endX,
    segment.endY,
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
  );
}

export const BLOCKED_NAVIGATION_COST = 0;
export const MINIMUM_NAVIGATION_COST = 1;
export const MAXIMUM_NAVIGATION_COST = 255;

export interface CompiledNavigationGridData {
  readonly width: number;
  readonly height: number;
  readonly costs: readonly number[];
  readonly elevations: readonly number[];
}

export interface GridPoint {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

export class NavigationGrid {
  readonly width: number;
  readonly height: number;
  private readonly costs: Uint8Array;
  private readonly elevations: Int16Array;

  constructor(data: CompiledNavigationGridData) {
    if (
      !Number.isInteger(data.width) ||
      data.width <= 0 ||
      !Number.isInteger(data.height) ||
      data.height <= 0
    ) {
      throw new RangeError(
        "Navigation grid dimensions must be positive integers.",
      );
    }
    const size = data.width * data.height;
    if (data.costs.length !== size || data.elevations.length !== size) {
      throw new RangeError(
        `Navigation grid arrays must contain exactly ${size} cells.`,
      );
    }
    this.width = data.width;
    this.height = data.height;
    this.costs = new Uint8Array(size);
    this.elevations = new Int16Array(size);
    for (let index = 0; index < size; index += 1) {
      const cost = data.costs[index];
      const elevation = data.elevations[index];
      if (
        cost === undefined ||
        !Number.isInteger(cost) ||
        cost < BLOCKED_NAVIGATION_COST ||
        cost > MAXIMUM_NAVIGATION_COST
      ) {
        throw new RangeError(`Navigation cost at index ${index} is invalid.`);
      }
      if (
        elevation === undefined ||
        !Number.isSafeInteger(elevation) ||
        elevation < -32_768 ||
        elevation > 32_767
      ) {
        throw new RangeError(
          `Navigation elevation at index ${index} is invalid.`,
        );
      }
      this.costs[index] = cost;
      this.elevations[index] = elevation;
    }
  }

  get size(): number {
    return this.costs.length;
  }

  contains(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  indexOf(x: number, y: number): number {
    if (!this.contains(x, y)) {
      return -1;
    }
    return y * this.width + x;
  }

  xOf(index: number): number {
    this.requireIndex(index);
    return index % this.width;
  }

  yOf(index: number): number {
    this.requireIndex(index);
    return Math.floor(index / this.width);
  }

  costAt(x: number, y: number): number {
    const index = this.indexOf(x, y);
    return index < 0 ? BLOCKED_NAVIGATION_COST : (this.costs[index] ?? 0);
  }

  elevationAt(x: number, y: number): number | undefined {
    const index = this.indexOf(x, y);
    return index < 0 ? undefined : this.elevations[index];
  }

  isWalkable(x: number, y: number, elevation: number): boolean {
    const index = this.indexOf(x, y);
    return (
      index >= 0 &&
      (this.costs[index] ?? 0) >= MINIMUM_NAVIGATION_COST &&
      this.elevations[index] === elevation
    );
  }

  pointAt(index: number): GridPoint {
    return {
      x: this.xOf(index),
      y: this.yOf(index),
      elevation: this.elevations[index] ?? 0,
    };
  }

  minimumWalkableCost(): number {
    let minimum = MAXIMUM_NAVIGATION_COST;
    for (const cost of this.costs) {
      if (cost >= MINIMUM_NAVIGATION_COST && cost < minimum) {
        minimum = cost;
      }
    }
    return minimum;
  }

  private requireIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.size) {
      throw new RangeError("Navigation grid index is outside the grid.");
    }
  }
}

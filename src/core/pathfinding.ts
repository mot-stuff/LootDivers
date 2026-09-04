import { NavigationGrid, type GridPoint } from "./navigation-grid.ts";

export type PathStatus =
  "complete" | "no-path" | "budget-exhausted" | "invalid";

export class PathBuffer {
  readonly points: GridPoint[] = [];

  reset(): void {
    this.points.length = 0;
  }
}

export interface PathResult {
  status: PathStatus;
  expansions: number;
  pathLength: number;
  totalCost: number;
}

const NEIGHBOR_X = [0, -1, 1, 0] as const;
const NEIGHBOR_Y = [-1, 0, 0, 1] as const;

export class BoundedAStar {
  private readonly grid: NavigationGrid;
  private readonly gScore: Float64Array;
  private readonly parent: Int32Array;
  private readonly visitedGeneration: Uint32Array;
  private readonly closedGeneration: Uint32Array;
  private readonly heap: Int32Array;
  private readonly minimumCost: number;
  private heapLength = 0;
  private generation = 0;

  constructor(grid: NavigationGrid) {
    this.grid = grid;
    this.gScore = new Float64Array(grid.size);
    this.parent = new Int32Array(grid.size);
    this.visitedGeneration = new Uint32Array(grid.size);
    this.closedGeneration = new Uint32Array(grid.size);
    this.heap = new Int32Array(grid.size * 4);
    this.minimumCost = grid.minimumWalkableCost();
  }

  findPath(
    start: GridPoint,
    goal: GridPoint,
    expansionCap: number,
    output: PathBuffer,
    result: PathResult,
  ): PathResult {
    if (!Number.isInteger(expansionCap) || expansionCap <= 0) {
      throw new RangeError("A* expansionCap must be a positive integer.");
    }
    output.reset();
    result.expansions = 0;
    result.pathLength = 0;
    result.totalCost = 0;

    if (
      start.elevation !== goal.elevation ||
      !this.grid.isWalkable(start.x, start.y, start.elevation) ||
      !this.grid.isWalkable(goal.x, goal.y, goal.elevation)
    ) {
      result.status = "invalid";
      return result;
    }

    const startIndex = this.grid.indexOf(start.x, start.y);
    const goalIndex = this.grid.indexOf(goal.x, goal.y);
    if (startIndex === goalIndex) {
      output.points.push({ ...start });
      result.status = "complete";
      result.pathLength = 1;
      return result;
    }

    this.beginGeneration();
    this.heapLength = 0;
    this.markVisited(startIndex, 0, -1);
    this.heapPush(startIndex, goalIndex);

    while (this.heapLength > 0 && result.expansions < expansionCap) {
      const current = this.heapPop(goalIndex);
      if (this.closedGeneration[current] === this.generation) {
        continue;
      }
      this.closedGeneration[current] = this.generation;
      result.expansions += 1;
      if (current === goalIndex) {
        this.reconstruct(current, output);
        result.status = "complete";
        result.pathLength = output.points.length;
        result.totalCost = this.gScore[current] ?? 0;
        return result;
      }

      const currentX = current % this.grid.width;
      const currentY = Math.floor(current / this.grid.width);
      const currentCost = this.gScore[current] ?? 0;
      for (let direction = 0; direction < NEIGHBOR_X.length; direction += 1) {
        const neighborX = currentX + (NEIGHBOR_X[direction] ?? 0);
        const neighborY = currentY + (NEIGHBOR_Y[direction] ?? 0);
        if (!this.grid.isWalkable(neighborX, neighborY, start.elevation)) {
          continue;
        }
        const neighbor = this.grid.indexOf(neighborX, neighborY);
        if (
          neighbor < 0 ||
          this.closedGeneration[neighbor] === this.generation
        ) {
          continue;
        }
        const nextCost = currentCost + this.grid.costAt(neighborX, neighborY);
        if (
          this.visitedGeneration[neighbor] !== this.generation ||
          nextCost < (this.gScore[neighbor] ?? Number.POSITIVE_INFINITY)
        ) {
          this.markVisited(neighbor, nextCost, current);
          this.heapPush(neighbor, goalIndex);
        }
      }
    }

    result.status = this.heapLength > 0 ? "budget-exhausted" : "no-path";
    return result;
  }

  private beginGeneration(): void {
    this.generation = (this.generation + 1) >>> 0;
    if (this.generation === 0) {
      this.visitedGeneration.fill(0);
      this.closedGeneration.fill(0);
      this.generation = 1;
    }
  }

  private markVisited(index: number, cost: number, parent: number): void {
    this.visitedGeneration[index] = this.generation;
    this.gScore[index] = cost;
    this.parent[index] = parent;
  }

  private reconstruct(goal: number, output: PathBuffer): void {
    let current = goal;
    while (current >= 0) {
      output.points.push(this.grid.pointAt(current));
      current = this.parent[current] ?? -1;
    }
    output.points.reverse();
  }

  private heapPush(index: number, goal: number): void {
    if (this.heapLength >= this.heap.length) {
      throw new Error("A* open-set capacity invariant failed.");
    }
    let child = this.heapLength;
    this.heapLength += 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      const parentIndex = this.heap[parent] ?? index;
      if (this.compare(parentIndex, index, goal) <= 0) {
        break;
      }
      this.heap[child] = parentIndex;
      child = parent;
    }
    this.heap[child] = index;
  }

  private heapPop(goal: number): number {
    const root = this.heap[0] ?? -1;
    this.heapLength -= 1;
    const last = this.heap[this.heapLength] ?? root;
    if (this.heapLength > 0) {
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1;
        if (left >= this.heapLength) {
          break;
        }
        const right = left + 1;
        let child = left;
        if (
          right < this.heapLength &&
          this.compare(
            this.heap[right] ?? last,
            this.heap[left] ?? last,
            goal,
          ) < 0
        ) {
          child = right;
        }
        const childIndex = this.heap[child] ?? last;
        if (this.compare(last, childIndex, goal) <= 0) {
          break;
        }
        this.heap[parent] = childIndex;
        parent = child;
      }
      this.heap[parent] = last;
    }
    return root;
  }

  private compare(left: number, right: number, goal: number): number {
    const leftHeuristic = this.heuristic(left, goal);
    const rightHeuristic = this.heuristic(right, goal);
    const leftTotal = (this.gScore[left] ?? 0) + leftHeuristic;
    const rightTotal = (this.gScore[right] ?? 0) + rightHeuristic;
    return (
      leftTotal - rightTotal || leftHeuristic - rightHeuristic || left - right
    );
  }

  private heuristic(index: number, goal: number): number {
    const x = index % this.grid.width;
    const y = Math.floor(index / this.grid.width);
    const goalX = goal % this.grid.width;
    const goalY = Math.floor(goal / this.grid.width);
    return (Math.abs(x - goalX) + Math.abs(y - goalY)) * this.minimumCost;
  }
}

export function createPathResult(): PathResult {
  return { status: "invalid", expansions: 0, pathLength: 0, totalCost: 0 };
}

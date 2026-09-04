import type { GridPoint } from "./navigation-grid.ts";
import {
  BoundedAStar,
  PathBuffer,
  createPathResult,
  type PathResult,
} from "./pathfinding.ts";

export interface PathRequest {
  readonly requesterId: number;
  readonly start: GridPoint;
  readonly goal: GridPoint;
}

export type PathRequestRejection = "queue-full" | "already-pending";

export interface PathCompletionSink {
  onPathCompleted(
    request: PathRequest,
    result: Readonly<PathResult>,
    path: PathBuffer,
  ): void;
}

export interface PathSchedulerOptions {
  readonly queueCapacity: number;
  readonly perRequestExpansionCap: number;
  readonly maxRequestsPerTick: number;
  readonly maxExpansionsPerTick: number;
}

export interface PathSchedulerTickResult {
  processedRequests: number;
  expansions: number;
  remainingRequests: number;
}

export class FairPathRequestScheduler {
  private readonly search: BoundedAStar;
  private readonly sink: PathCompletionSink;
  private readonly queue: (PathRequest | undefined)[];
  private readonly pendingRequesters = new Set<number>();
  private readonly path = new PathBuffer();
  private readonly result = createPathResult();
  private readonly tickResult: PathSchedulerTickResult = {
    processedRequests: 0,
    expansions: 0,
    remainingRequests: 0,
  };
  private readIndex = 0;
  private writeIndex = 0;
  private queued = 0;
  readonly options: PathSchedulerOptions;

  constructor(
    search: BoundedAStar,
    sink: PathCompletionSink,
    options: PathSchedulerOptions,
  ) {
    for (const [name, value] of Object.entries(options)) {
      if (!Number.isInteger(value) || value <= 0) {
        throw new RangeError(
          `Path scheduler ${name} must be a positive integer.`,
        );
      }
    }
    this.search = search;
    this.sink = sink;
    this.options = options;
    this.queue = new Array<PathRequest | undefined>(options.queueCapacity);
  }

  get pendingCount(): number {
    return this.queued;
  }

  request(request: PathRequest): PathRequestRejection | undefined {
    if (this.pendingRequesters.has(request.requesterId)) {
      return "already-pending";
    }
    if (this.queued >= this.queue.length) {
      return "queue-full";
    }
    this.queue[this.writeIndex] = request;
    this.writeIndex = (this.writeIndex + 1) % this.queue.length;
    this.queued += 1;
    this.pendingRequesters.add(request.requesterId);
    return undefined;
  }

  processTick(): Readonly<PathSchedulerTickResult> {
    this.tickResult.processedRequests = 0;
    this.tickResult.expansions = 0;

    while (
      this.queued > 0 &&
      this.tickResult.processedRequests < this.options.maxRequestsPerTick &&
      this.tickResult.expansions < this.options.maxExpansionsPerTick
    ) {
      const request = this.dequeue();
      const remaining =
        this.options.maxExpansionsPerTick - this.tickResult.expansions;
      const requestBudget = Math.min(
        this.options.perRequestExpansionCap,
        remaining,
      );
      this.search.findPath(
        request.start,
        request.goal,
        requestBudget,
        this.path,
        this.result,
      );
      this.tickResult.processedRequests += 1;
      this.tickResult.expansions += this.result.expansions;
      this.sink.onPathCompleted(request, this.result, this.path);
    }

    this.tickResult.remainingRequests = this.queued;
    return this.tickResult;
  }

  clear(): void {
    this.queue.fill(undefined);
    this.pendingRequesters.clear();
    this.readIndex = 0;
    this.writeIndex = 0;
    this.queued = 0;
  }

  private dequeue(): PathRequest {
    const request = this.queue[this.readIndex];
    if (request === undefined) {
      throw new Error("Path scheduler queue invariant failed.");
    }
    this.queue[this.readIndex] = undefined;
    this.readIndex = (this.readIndex + 1) % this.queue.length;
    this.queued -= 1;
    this.pendingRequesters.delete(request.requesterId);
    return request;
  }
}

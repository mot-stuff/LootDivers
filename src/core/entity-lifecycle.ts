import {
  SequentialRuntimeEntityIds,
  type RuntimeEntityId,
  type RuntimeEntityIdSource,
} from "./ids";

export const TECHNICAL_UPDATE_ORDER = [
  "snapshot-transforms",
  "technical-waypoints",
  "projectile-wrap",
  "cosmetic-particle-lifetimes",
  "spatial-index-and-queries",
  "bounded-path-requests",
  "cleanup",
  "publish-diagnostics",
] as const;

export type TechnicalUpdateStage = (typeof TECHNICAL_UPDATE_ORDER)[number];

export const enum PresentationKind {
  Actor = 1,
  Projectile = 2,
  CosmeticParticle = 3,
  Loot = 4,
}

export interface TransformWrite {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
}

/**
 * A fixed-capacity, structure-of-arrays transform store. Iteration order is
 * dense and deterministic; removal swaps the final slot into the removed slot.
 */
export class TransformComponentStore {
  readonly ids: Uint32Array;
  readonly previousX: Float64Array;
  readonly previousY: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly elevation: Int16Array;
  readonly #indices = new Map<RuntimeEntityId, number>();
  #count = 0;

  public constructor(readonly capacity: number) {
    requireCapacity(capacity);
    this.ids = new Uint32Array(capacity);
    this.previousX = new Float64Array(capacity);
    this.previousY = new Float64Array(capacity);
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.elevation = new Int16Array(capacity);
  }

  public get size(): number {
    return this.#count;
  }

  public has(id: RuntimeEntityId): boolean {
    return this.#indices.has(id);
  }

  public indexOf(id: RuntimeEntityId): number {
    return this.#indices.get(id) ?? -1;
  }

  public add(id: RuntimeEntityId, value: TransformWrite): number {
    if (this.#indices.has(id)) {
      throw new Error(`Entity ${id} already has a transform.`);
    }
    if (this.#count >= this.capacity) {
      throw new RangeError("Transform component capacity exhausted.");
    }
    requireTransform(value);
    const index = this.#count;
    this.#count += 1;
    this.ids[index] = id;
    this.previousX[index] = value.x;
    this.previousY[index] = value.y;
    this.x[index] = value.x;
    this.y[index] = value.y;
    this.elevation[index] = value.elevation;
    this.#indices.set(id, index);
    return index;
  }

  public snapshot(): void {
    for (let index = 0; index < this.#count; index += 1) {
      this.previousX[index] = this.x[index] ?? 0;
      this.previousY[index] = this.y[index] ?? 0;
    }
  }

  public remove(id: RuntimeEntityId): boolean {
    const index = this.#indices.get(id);
    if (index === undefined) {
      return false;
    }
    const last = this.#count - 1;
    if (index !== last) {
      const movedId = this.ids[last] as RuntimeEntityId;
      this.ids[index] = movedId;
      this.previousX[index] = this.previousX[last] ?? 0;
      this.previousY[index] = this.previousY[last] ?? 0;
      this.x[index] = this.x[last] ?? 0;
      this.y[index] = this.y[last] ?? 0;
      this.elevation[index] = this.elevation[last] ?? 0;
      this.#indices.set(movedId, index);
    }
    this.ids[last] = 0;
    this.#indices.delete(id);
    this.#count = last;
    return true;
  }

  public clear(): void {
    this.ids.fill(0);
    this.#indices.clear();
    this.#count = 0;
  }
}

/** Fixed-capacity presentation metadata; it contains no renderer object. */
export class PresentationComponentStore {
  readonly ids: Uint32Array;
  readonly kinds: Uint8Array;
  readonly variants: Uint8Array;
  readonly #indices = new Map<RuntimeEntityId, number>();
  #count = 0;

  public constructor(readonly capacity: number) {
    requireCapacity(capacity);
    this.ids = new Uint32Array(capacity);
    this.kinds = new Uint8Array(capacity);
    this.variants = new Uint8Array(capacity);
  }

  public get size(): number {
    return this.#count;
  }

  public has(id: RuntimeEntityId): boolean {
    return this.#indices.has(id);
  }

  public add(id: RuntimeEntityId, kind: PresentationKind, variant = 0): number {
    if (this.#indices.has(id)) {
      throw new Error(`Entity ${id} already has presentation metadata.`);
    }
    if (this.#count >= this.capacity) {
      throw new RangeError("Presentation component capacity exhausted.");
    }
    const index = this.#count;
    this.#count += 1;
    this.ids[index] = id;
    this.kinds[index] = kind;
    this.variants[index] = variant;
    this.#indices.set(id, index);
    return index;
  }

  public remove(id: RuntimeEntityId): boolean {
    const index = this.#indices.get(id);
    if (index === undefined) {
      return false;
    }
    const last = this.#count - 1;
    if (index !== last) {
      const movedId = this.ids[last] as RuntimeEntityId;
      this.ids[index] = movedId;
      this.kinds[index] = this.kinds[last] ?? 0;
      this.variants[index] = this.variants[last] ?? 0;
      this.#indices.set(movedId, index);
    }
    this.ids[last] = 0;
    this.#indices.delete(id);
    this.#count = last;
    return true;
  }

  public clear(): void {
    this.ids.fill(0);
    this.#indices.clear();
    this.#count = 0;
  }
}

export interface EntityLifecycleDiagnostics {
  readonly liveEntities: number;
  readonly pendingCleanup: number;
  readonly transformComponents: number;
  readonly presentationComponents: number;
  readonly created: number;
  readonly destroyed: number;
}

/**
 * Narrow lifecycle owner for the Phase 0 fixture. Component stores register a
 * cleanup callback; entity destruction is complete before the ID stops being
 * live. Runtime IDs are process-local and never recycled.
 */
export class TechnicalEntityLifecycle {
  readonly transforms: TransformComponentStore;
  readonly presentations: PresentationComponentStore;
  readonly #ids: RuntimeEntityIdSource;
  readonly #live = new Set<RuntimeEntityId>();
  readonly #pending: RuntimeEntityId[] = [];
  readonly #cleanup: ((id: RuntimeEntityId) => void)[] = [];
  #created = 0;
  #destroyed = 0;

  public constructor(capacity: number, ids = new SequentialRuntimeEntityIds()) {
    this.#ids = ids;
    this.transforms = new TransformComponentStore(capacity);
    this.presentations = new PresentationComponentStore(capacity);
    this.#cleanup.push(
      (id) => {
        this.transforms.remove(id);
      },
      (id) => {
        this.presentations.remove(id);
      },
    );
  }

  public create(
    transform: TransformWrite,
    kind: PresentationKind,
    variant = 0,
  ): RuntimeEntityId {
    const id = this.#ids.next();
    this.#live.add(id);
    try {
      this.transforms.add(id, transform);
      this.presentations.add(id, kind, variant);
    } catch (error: unknown) {
      for (const cleanup of this.#cleanup) {
        cleanup(id);
      }
      this.#live.delete(id);
      throw error;
    }
    this.#created += 1;
    return id;
  }

  public isAlive(id: RuntimeEntityId): boolean {
    return this.#live.has(id);
  }

  public requestDestroy(id: RuntimeEntityId): boolean {
    if (!this.#live.has(id) || this.#pending.includes(id)) {
      return false;
    }
    this.#pending.push(id);
    return true;
  }

  public flushCleanup(onDestroyed?: (id: RuntimeEntityId) => void): number {
    let removed = 0;
    for (const id of this.#pending) {
      if (!this.#live.delete(id)) {
        continue;
      }
      for (const cleanup of this.#cleanup) {
        cleanup(id);
      }
      onDestroyed?.(id);
      this.#destroyed += 1;
      removed += 1;
    }
    this.#pending.length = 0;
    return removed;
  }

  public destroyAll(onDestroyed?: (id: RuntimeEntityId) => void): void {
    this.#pending.length = 0;
    for (const id of this.#live) {
      for (const cleanup of this.#cleanup) {
        cleanup(id);
      }
      onDestroyed?.(id);
      this.#destroyed += 1;
    }
    this.#live.clear();
  }

  public diagnostics(): EntityLifecycleDiagnostics {
    return {
      liveEntities: this.#live.size,
      pendingCleanup: this.#pending.length,
      transformComponents: this.transforms.size,
      presentationComponents: this.presentations.size,
      created: this.#created,
      destroyed: this.#destroyed,
    };
  }
}

function requireCapacity(capacity: number): void {
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError("Component capacity must be a positive safe integer.");
  }
}

function requireTransform(value: TransformWrite): void {
  if (
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isSafeInteger(value.elevation) ||
    value.elevation < -32_768 ||
    value.elevation > 32_767
  ) {
    throw new RangeError(
      "Transform values must be finite with int16 elevation.",
    );
  }
}

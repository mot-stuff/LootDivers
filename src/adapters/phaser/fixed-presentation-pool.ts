export interface FixedPresentationPoolDiagnostics {
  readonly capacity: number;
  readonly active: number;
  readonly available: number;
  readonly highWaterMark: number;
  readonly acquisitions: number;
  readonly releases: number;
  readonly exhaustionAttempts: number;
  readonly overflowAttempts: number;
}

export class FixedPresentationPool<T> {
  readonly #resources: T[];
  readonly #entityIds: Uint32Array;
  readonly #freeSlots: Int32Array;
  readonly #slots = new Map<number, number>();
  readonly #activate: (resource: T, entityId: number) => void;
  readonly #deactivate: (resource: T) => void;
  #freeCount: number;
  #active = 0;
  #highWaterMark = 0;
  #acquisitions = 0;
  #releases = 0;
  #exhaustionAttempts = 0;
  #overflowAttempts = 0;

  public constructor(
    capacity: number,
    create: (slot: number) => T,
    activate: (resource: T, entityId: number) => void,
    deactivate: (resource: T) => void,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError("Presentation pool capacity must be positive.");
    }
    this.#activate = activate;
    this.#deactivate = deactivate;
    this.#resources = new Array<T>(capacity);
    this.#entityIds = new Uint32Array(capacity);
    this.#freeSlots = new Int32Array(capacity);
    this.#freeCount = capacity;
    for (let slot = 0; slot < capacity; slot += 1) {
      const resource = create(slot);
      this.#resources[slot] = resource;
      this.#freeSlots[slot] = capacity - slot - 1;
      deactivate(resource);
    }
  }

  public acquire(entityId: number): T {
    if (this.#slots.has(entityId)) {
      this.#overflowAttempts += 1;
      throw new Error(`Presentation already exists for entity ${entityId}.`);
    }
    if (this.#freeCount === 0) {
      this.#exhaustionAttempts += 1;
      throw new RangeError("Presentation pool capacity exhausted.");
    }
    this.#freeCount -= 1;
    const slot = this.#freeSlots[this.#freeCount] ?? -1;
    const resource = this.#resources[slot];
    if (slot < 0 || resource === undefined) {
      this.#overflowAttempts += 1;
      throw new Error("Presentation pool free-slot invariant failed.");
    }
    this.#entityIds[slot] = entityId;
    this.#slots.set(entityId, slot);
    this.#active += 1;
    this.#acquisitions += 1;
    this.#highWaterMark = Math.max(this.#highWaterMark, this.#active);
    this.#activate(resource, entityId);
    return resource;
  }

  public release(entityId: number): boolean {
    const slot = this.#slots.get(entityId);
    if (slot === undefined) {
      return false;
    }
    const resource = this.#resources[slot];
    if (resource === undefined || this.#freeCount >= this.#freeSlots.length) {
      this.#overflowAttempts += 1;
      throw new Error("Presentation pool release invariant failed.");
    }
    this.#deactivate(resource);
    this.#entityIds[slot] = 0;
    this.#slots.delete(entityId);
    this.#freeSlots[this.#freeCount] = slot;
    this.#freeCount += 1;
    this.#active -= 1;
    this.#releases += 1;
    return true;
  }

  public get(entityId: number): T | undefined {
    const slot = this.#slots.get(entityId);
    return slot === undefined ? undefined : this.#resources[slot];
  }

  public releaseAll(): void {
    const ids = [...this.#slots.keys()];
    for (const id of ids) {
      this.release(id);
    }
  }

  public resources(): readonly T[] {
    return this.#resources;
  }

  public diagnostics(): FixedPresentationPoolDiagnostics {
    return {
      capacity: this.#resources.length,
      active: this.#active,
      available: this.#freeCount,
      highWaterMark: this.#highWaterMark,
      acquisitions: this.#acquisitions,
      releases: this.#releases,
      exhaustionAttempts: this.#exhaustionAttempts,
      overflowAttempts: this.#overflowAttempts,
    };
  }
}

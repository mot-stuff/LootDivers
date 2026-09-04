declare const runtimeEntityIdBrand: unique symbol;
declare const contentIdBrand: unique symbol;
declare const persistentInstanceIdBrand: unique symbol;

/**
 * Process-local simulation identity. Runtime entity IDs must never be saved.
 */
export type RuntimeEntityId = number & {
  readonly [runtimeEntityIdBrand]: "RuntimeEntityId";
};

/**
 * Stable identity for immutable authored definitions.
 */
export type ContentId = string & {
  readonly [contentIdBrand]: "ContentId";
};

/**
 * Stable identity for a persistent or generated instance.
 */
export type PersistentInstanceId = string & {
  readonly [persistentInstanceIdBrand]: "PersistentInstanceId";
};

export interface RuntimeEntityIdSource {
  next(): RuntimeEntityId;
}

const MAX_RUNTIME_ENTITY_ID = 0xffff_ffff;
const NAMESPACED_ID_PATTERN = /^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._/-]*$/;

export class SequentialRuntimeEntityIds implements RuntimeEntityIdSource {
  private nextValue: number;

  constructor(firstValue = 1) {
    if (
      !Number.isSafeInteger(firstValue) ||
      firstValue < 1 ||
      firstValue > MAX_RUNTIME_ENTITY_ID
    ) {
      throw new RangeError(
        "The first runtime entity ID must be a uint32 >= 1.",
      );
    }

    this.nextValue = firstValue;
  }

  next(): RuntimeEntityId {
    if (this.nextValue > MAX_RUNTIME_ENTITY_ID) {
      throw new RangeError("Runtime entity ID space is exhausted.");
    }

    const id = this.nextValue as RuntimeEntityId;
    this.nextValue += 1;
    return id;
  }
}

function requireNamespacedId(value: string, label: string): string {
  if (!NAMESPACED_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${label} must be a lowercase namespaced ID such as "core:example".`,
    );
  }

  return value;
}

export function contentId(value: string): ContentId {
  return requireNamespacedId(value, "Content ID") as ContentId;
}

export function persistentInstanceId(value: string): PersistentInstanceId {
  return requireNamespacedId(
    value,
    "Persistent instance ID",
  ) as PersistentInstanceId;
}

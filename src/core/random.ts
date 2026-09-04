export const MULBERRY32_ALGORITHM = "mulberry32-v1" as const;

export interface RandomState {
  readonly algorithm: typeof MULBERRY32_ALGORITHM;
  readonly state: number;
}

export interface RandomSource {
  nextUint32(): number;
  nextFloat(): number;
  nextInteger(maxExclusive: number): number;
}

export interface StatefulRandomSource extends RandomSource {
  saveState(): RandomState;
}

const UINT32_RANGE = 0x1_0000_0000;
const STATE_INCREMENT = 0x6d2b_79f5;

function requireUint32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) {
    throw new RangeError(`${label} must be an unsigned 32-bit integer.`);
  }

  return value;
}

/**
 * Mulberry32 is a compact, explicitly versioned 32-bit generator.
 *
 * Arithmetic is defined with JavaScript's unsigned shifts and Math.imul, making
 * the sequence stable across conforming runtimes. It is suitable for repeatable
 * game simulation and tests, not cryptography. State is the uint32 accumulator
 * immediately before the next draw.
 */
export class Mulberry32 implements StatefulRandomSource {
  private state: number;

  constructor(seed: number) {
    this.state = requireUint32(seed, "Seed");
  }

  static fromState(snapshot: RandomState): Mulberry32 {
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      snapshot.algorithm !== MULBERRY32_ALGORITHM
    ) {
      throw new TypeError(
        `Random state must use algorithm "${MULBERRY32_ALGORITHM}".`,
      );
    }

    return new Mulberry32(requireUint32(snapshot.state, "Random state"));
  }

  nextUint32(): number {
    this.state = (this.state + STATE_INCREMENT) >>> 0;

    let mixed = this.state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);

    return (mixed ^ (mixed >>> 14)) >>> 0;
  }

  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  nextInteger(maxExclusive: number): number {
    if (
      !Number.isSafeInteger(maxExclusive) ||
      maxExclusive <= 0 ||
      maxExclusive > UINT32_RANGE
    ) {
      throw new RangeError(
        "maxExclusive must be an integer from 1 through 2^32.",
      );
    }

    // Rejection sampling avoids modulo bias for ranges that do not divide 2^32.
    const acceptableRange = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    let value = this.nextUint32();

    while (value >= acceptableRange) {
      value = this.nextUint32();
    }

    return value % maxExclusive;
  }

  saveState(): RandomState {
    return {
      algorithm: MULBERRY32_ALGORITHM,
      state: this.state,
    };
  }
}

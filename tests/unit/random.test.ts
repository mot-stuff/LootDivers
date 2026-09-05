import { describe, expect, it } from "vitest";

import {
  MULBERRY32_ALGORITHM,
  Mulberry32,
  type RandomState,
} from "../../src/core";

describe("Mulberry32", () => {
  it("matches the versioned algorithm vector", () => {
    const random = new Mulberry32(1);

    expect(Array.from({ length: 4 }, () => random.nextFloat())).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
      0.9810509674716741,
    ]);
  });

  it("restores the exact next value from serializable state", () => {
    const original = new Mulberry32(0xdead_beef);

    Array.from({ length: 17 }, () => original.nextUint32());
    const encoded = JSON.stringify(original.saveState());
    const state = JSON.parse(encoded) as RandomState;
    const restored = Mulberry32.fromState(state);

    expect(state.algorithm).toBe(MULBERRY32_ALGORITHM);
    expect(Number.isInteger(state.state)).toBe(true);
    expect(Array.from({ length: 100 }, () => restored.nextUint32())).toEqual(
      Array.from({ length: 100 }, () => original.nextUint32()),
    );
  });

  it("fast-forwards to any draw position in constant time (TASK-712)", () => {
    for (const seed of [0, 1, 0x9e37_79b9, 0xffff_ffff]) {
      for (const draws of [0, 1, 7, 1_000, 0xffff_ffff]) {
        const walked = new Mulberry32(seed);
        // Walk only small counts; huge counts are verified against the
        // closed-form state via a single subsequent step from draws - 1.
        if (draws <= 1_000) {
          for (let index = 0; index < draws; index += 1) {
            walked.nextUint32();
          }
          expect(Mulberry32.atDraw(seed, draws).saveState()).toEqual(
            walked.saveState(),
          );
        } else {
          const before = Mulberry32.atDraw(seed, draws - 1);
          before.nextUint32();
          expect(Mulberry32.atDraw(seed, draws).saveState()).toEqual(
            before.saveState(),
          );
        }
      }
    }
    expect(() => Mulberry32.atDraw(1, -1)).toThrow(RangeError);
    expect(() => Mulberry32.atDraw(1, 1.5)).toThrow(RangeError);
    expect(() => Mulberry32.atDraw(1, 2 ** 32)).toThrow(RangeError);
  });

  it("produces repeatable bounded values across representative seeds", () => {
    const seeds = [0, 1, 2, 0x7fff_ffff, 0x8000_0000, 0xffff_ffff, 0x1234_5678];

    for (const seed of seeds) {
      const first = new Mulberry32(seed);
      const second = new Mulberry32(seed);
      const firstValues = Array.from({ length: 256 }, () =>
        first.nextInteger(37),
      );
      const secondValues = Array.from({ length: 256 }, () =>
        second.nextInteger(37),
      );

      expect(firstValues).toEqual(secondValues);
      expect(firstValues.every((value) => value >= 0 && value < 37)).toBe(true);
    }
  });

  it("rejects invalid seeds, ranges, and state formats", () => {
    expect(() => new Mulberry32(-1)).toThrow(/unsigned 32-bit/);
    expect(() => new Mulberry32(0x1_0000_0000)).toThrow(/unsigned 32-bit/);
    expect(() => new Mulberry32(1).nextInteger(0)).toThrow(/maxExclusive/);
    expect(() =>
      Mulberry32.fromState({
        algorithm: "another-algorithm",
        state: 1,
      } as unknown as RandomState),
    ).toThrow(/mulberry32-v1/);
  });
});

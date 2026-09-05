import { describe, expect, it } from "vitest";

import {
  CHARACTER_SLOT_LIMIT,
  normalizeCharacterName,
} from "../../src/core/character-identity";

/**
 * TASK-709 / DEC-036: the client mirror of the server naming rule. The
 * rejection fixtures here are the same ones `server/test/contract-suite.ts`
 * sends against the live API, so client and server can never silently
 * diverge on what a valid name is.
 */
describe("character identity rules", () => {
  it("accepts valid names and returns them trimmed", () => {
    expect(normalizeCharacterName("Rega the Bold")).toBe("Rega the Bold");
    expect(normalizeCharacterName("  Rega the Bold  ")).toBe("Rega the Bold");
    expect(normalizeCharacterName("Ash")).toBe("Ash");
    expect(normalizeCharacterName("D'Marr")).toBe("D'Marr");
    expect(normalizeCharacterName("Kel-Vren IX")).toBe("Kel-Vren IX");
    expect(normalizeCharacterName("A23456789012345b")).toBe("A23456789012345b");
  });

  it("rejects the server contract-suite invalid fixtures", () => {
    expect(normalizeCharacterName("ab")).toBeNull(); // too short
    expect(normalizeCharacterName("a".repeat(17))).toBeNull(); // too long
    expect(normalizeCharacterName("1Rega")).toBeNull(); // digit first
    expect(normalizeCharacterName("'Rega")).toBeNull(); // separator first
    expect(normalizeCharacterName("Rega--Bold")).toBeNull(); // consecutive separators
    expect(normalizeCharacterName("Rega  Bold")).toBeNull(); // consecutive spaces
    expect(normalizeCharacterName("Rega_Bold")).toBeNull(); // bad character
    expect(normalizeCharacterName("")).toBeNull();
    expect(normalizeCharacterName("   ")).toBeNull();
    expect(normalizeCharacterName("Rega' -Bold")).toBeNull(); // mixed separators
  });

  it("keeps the DEC-036 slot limit at four", () => {
    expect(CHARACTER_SLOT_LIMIT).toBe(4);
  });
});

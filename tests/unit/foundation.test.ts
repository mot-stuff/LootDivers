import { describe, expect, it } from "vitest";

import { FOUNDATION_ID } from "../../src/core";

describe("browser foundation", () => {
  it("exposes a stable framework-free core identity", () => {
    expect(FOUNDATION_ID).toBe("rarpg:browser-foundation");
  });
});

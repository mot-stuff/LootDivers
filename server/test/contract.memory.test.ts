import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { MemoryStore } from "../src/memory-store.js";
import { runContractSuite, testConfig } from "./contract-suite.js";

/**
 * The §2 contract against the in-memory store. This is the always-on unit
 * suite: it needs no Docker and no Postgres (decision documented in the
 * store port; the identical suite runs against real Postgres in
 * contract.postgres.test.ts when TEST_DATABASE_URL is provided).
 */
runContractSuite("v1 API contract (MemoryStore)", () => {
  return Promise.resolve({
    store: new MemoryStore(),
    cleanup: () => Promise.resolve(),
  });
});

describe("auth rate limiting", () => {
  it("throttles repeated login attempts with the contract error shape", async () => {
    const app = await buildApp({
      store: new MemoryStore(),
      config: testConfig(),
      rateLimits: true,
      logger: false,
    });
    try {
      let sawRateLimit = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/auth/login",
          remoteAddress: "203.0.113.7",
          payload: { email: "rate@example.test", password: "wrong password!" },
        });
        if (response.statusCode === 429) {
          expect(response.json<{ error: { code: string } }>().error.code).toBe(
            "rate-limited",
          );
          sawRateLimit = true;
          break;
        }
        expect(response.statusCode).toBe(401);
      }
      expect(sawRateLimit).toBe(true);
    } finally {
      await app.close();
    }
  });
});

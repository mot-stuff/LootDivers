import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Auth tests hash real argon2id passwords; allow headroom on slow CI.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

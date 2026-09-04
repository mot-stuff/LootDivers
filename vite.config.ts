import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { defineConfig } from "vite";

function gitOutput(...arguments_: string[]): string {
  try {
    return execFileSync("git", arguments_, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

export default defineConfig({
  plugins: [preact()],
  define: {
    __RARPG_BUILD_COMMIT__: JSON.stringify(gitOutput("rev-parse", "HEAD")),
    __RARPG_BUILD_DIRTY__: JSON.stringify(
      gitOutput("status", "--short") !== "",
    ),
  },
  build: {
    sourcemap: true,
  },
});

import preact from "@preact/preset-vite";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    // Multi-page build (TASK-708 / DEC-035): "/" is the light homepage
    // (no Phaser), "/play/" is the game shell. Both share /assets/ and
    // the "/" base path.
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("index.html", import.meta.url)),
        play: fileURLToPath(new URL("play/index.html", import.meta.url)),
      },
    },
  },
});

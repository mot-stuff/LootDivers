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

const enableLocalApiProxy = process.env.CI !== "true";

export default defineConfig({
  plugins: [preact()],
  server: {
    // Local login/signup (DEC-032): homepage posts to same-origin `/api`.
    // The memory-store API listens on 8790 (`server`: `npm run dev:memory`).
    // CI e2e starts Vite without that API; proxying would 502 and fail
    // specs that require a clean console. Playwright mocks `/api` instead.
    ...(enableLocalApiProxy
      ? {
          proxy: {
            "/api": {
              target: "http://127.0.0.1:8790",
              changeOrigin: true,
              rewrite: (path: string) => path.replace(/^\/api/, ""),
            },
          },
        }
      : {}),
    watch: {
      // Windows EBUSY on public/assets/branding/logo.png (OneDrive/AV lock).
      ignored: ["**/public/assets/branding/**"],
    },
  },
  define: {
    __RARPG_BUILD_COMMIT__: JSON.stringify(gitOutput("rev-parse", "HEAD")),
    __RARPG_BUILD_DIRTY__: JSON.stringify(
      gitOutput("status", "--short") !== "",
    ),
  },
  build: {
    sourcemap: true,
    // Multi-page build (TASK-708 / DEC-035): "/" is the light homepage
    // (no Phaser), "/play/" is the game shell, and "/admin/" is the owner
    // admin panel (TASK-721 / DEC-047). All share /assets/ and the "/"
    // base path.
    rollupOptions: {
      input: {
        home: fileURLToPath(new URL("index.html", import.meta.url)),
        play: fileURLToPath(new URL("play/index.html", import.meta.url)),
        admin: fileURLToPath(new URL("admin/index.html", import.meta.url)),
      },
    },
  },
});

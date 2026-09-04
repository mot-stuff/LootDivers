# Browser Foundation Tooling

TASK-P0-003 establishes the browser toolchain only. It contains no gameplay or
production content.

## Pinned runtime

- Node.js `24.20.0` (Krypton, Active LTS)
- npm `11.19.0`

The versions are pinned in `.nvmrc`, `.node-version`, `package.json` engines,
Volta metadata, and the npm `packageManager` field. `.npmrc` rejects unsupported
engine versions and preserves exact dependency versions.

These versions were verified on 2026-09-04 against the official
[Node.js release table](https://nodejs.org/en/about/previous-releases) and
[Node.js distribution metadata](https://nodejs.org/dist/index.json). The latter
records npm `11.19.0` as bundled with Node.js `24.20.0`.

## Pinned direct packages

Runtime packages are Phaser `4.2.1` and Preact `10.29.8`. Direct development
packages are:

- Vite `8.2.2` and `@preact/preset-vite` `2.10.6`
- TypeScript `6.0.3`
- ESLint `10.10.0`, `@eslint/js` `10.0.1`, `typescript-eslint` `8.69.0`,
  and `globals` `17.12.0`
- Prettier `3.9.6`
- Vitest `5.0.0`
- Playwright Test `1.62.1`
- Node type declarations `24.13.3`
- Ajv `8.20.0` for build-time content shape validation

Versions and engine/peer constraints were resolved from npm registry package
metadata on 2026-09-04. TypeScript `6.0.3` is the newest release accepted by
`typescript-eslint`'s `<6.1.0` peer range; TypeScript `7.0.2` is intentionally
not used. Ajv `8.20.0` declares no engine or peer dependency constraints and is
compatible with the pinned Node/npm runtime. Every direct dependency is exact,
and `package-lock.json` locks the complete graph.

## Module boundaries

- `src/core`: framework-free rules. Both `.ts` and `.tsx` are compiled
  separately without DOM or browser type libraries. ESLint applies the same
  Phaser, Preact, and direct DOM-global restrictions to both extensions. Unit
  tests inspect the effective ESLint and TypeScript configurations for a
  hypothetical future core `.tsx` file.
- `src/adapters`: browser and Phaser integration.
- `src/presentation`: Preact and CSS presentation.
- `src/content`: reserved content boundary; intentionally empty.
- `src/persistence`: reserved persistence boundary; intentionally empty.
- `tests/unit` and `tests/e2e`: Vitest and Playwright verification.

Core must never import Phaser, Preact, DOM APIs, or browser APIs. Presentation
may read core exports but does not own game state. Phaser remains an adapter.

## Commands

On Windows, no system Node.js or npm installation is required. From the
repository root, provision the pinned official distribution into the ignored
`.tools` directory and capture its absolute npm path:

```powershell
$npm = & .\scripts\bootstrap-toolchain.ps1
& $npm ci
& $npm run format:check
& $npm run lint
& $npm run typecheck
& $npm test
& $npm run build
& $npm run budget
& $npm run content:validate
& $npm run content:compile
& $npm run content:check-determinism
& $npm exec playwright -- install chromium
& $npm run test:smoke
```

The bootstrap downloads Node.js `24.20.0` from `nodejs.org`, verifies the
Windows x64 archive against the release's official `SHASUMS256.txt`, validates
the bundled Node.js and npm versions, prepends that distribution to the current
PowerShell process's `PATH`, and returns only the absolute `npm.cmd` path. The
updated `PATH` is inherited by child processes such as Playwright's preview
server.

If local execution policy blocks scripts, invoke it in a child PowerShell and
apply the returned location to the current process:

```powershell
$npm = powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-toolchain.ps1
$env:PATH = "$(Split-Path $npm);$env:PATH"
```

On another platform with the pinned Node.js and npm versions already active,
the equivalent commands may be run directly with `npm`. Do not use the IDE's
private helper `node.exe` as a project runtime.

`test:smoke` starts Vite preview and tests the production `dist` artifact. It
fails on browser console errors, uncaught page errors, failed requests, HTTP
responses at or above 400, missing semantic readiness, or a non-WebGL2 canvas.

Content schemas, authoring rules, diagnostics, generated output, and version
contracts are documented in [`CONTENT_AUTHORING.md`](CONTENT_AUTHORING.md).

## Renderer and transfer policy

The page preflights WebGL2 before creating Phaser and asserts the canvas context
version after Phaser boot. Failure hides the canvas and shows actionable browser,
hardware-acceleration, and driver guidance. There is no Canvas gameplay fallback.

`npm run budget` runs the literal command
`node scripts/report-transfer-budget.mjs`. It starts at production
`dist/index.html`, follows initial HTML, static JavaScript import, stylesheet,
CSS asset, icon, font, and web-manifest references, and does not follow dynamic
imports or unrelated build output. Missing, external, or dist-escaping initial
references fail the report.

Each discovered artifact is compressed with Node.js `node:zlib` using
`gzipSync(..., { level: 9 })` and the Brotli quality-11 equivalent
`brotliCompressSync(..., { params: { BROTLI_PARAM_QUALITY: 11 } })`. The report
records the expanded Node/script command, Node, zlib, and Brotli versions, the
equivalent operation for every input, content type, initiators, raw/gzip/Brotli
bytes, SHA-256, and that cache status is not measurable during static artifact
inspection.

The command enforces the currently measurable P0-002 shell gates:

- initial JavaScript, CSS, and frameworks: at most 1 MiB Brotli;
- complete initial shell including HTML, manifest, fonts, and icons: at most
  1.25 MiB Brotli;
- each initial JavaScript chunk: at most 512 KiB Brotli;
- zero source maps in the normal initial graph;
- zero missing or unexpected initial references.

The machine-readable output is generated at the intentionally untracked
`reports/transfer-budget.json`. Future lazy zone chunks are not charged until
they become part of the initial request graph.

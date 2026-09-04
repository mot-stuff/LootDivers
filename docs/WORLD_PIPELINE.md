# Synthetic Isometric World Pipeline

TASK-P0-006 implements the DEC-012 technical proof only. The checked-in Tiled
JSON fixture and every marker use the `fixture:` namespace; they are not a
production zone or gameplay content.

## Authoring and compilation

`fixtures/world/technical-isometric.json` is the sole source map. Compiler
version `1.0.0` requires:

- finite Tiled JSON with `orientation: isometric`, `renderorder: right-down`,
  and the 64×32 tile convention;
- ordered `ground`, `detail`, `low`, `overhang`, and `foreground` tile layers;
- tile-layer dimensions equal to the map, integer layer elevation, 16-pixel
  elevation units, positive chunk dimensions, and no undeclared metadata;
- exactly one `markers` object metadata layer, unique stable marker IDs, unique
  positive Tiled object IDs, bounded grid coordinates, and synthetic colors;
- synthetic `fixture:` zone and asset identities.

The deterministic output is
`public/zones/technical-isometric.zone.json`. Runtime code fetches this compiled
bundle and never parses arbitrary Tiled source.

```powershell
& $npm run world:check
& $npm run world:compile # only after an intentional source edit
& $npm run world:check
```

`world:check` compiles twice, compares bytes, and fails if committed output is
stale. Invalid source errors include the source name and rejected field.

## Runtime boundaries and lifecycle

Projection, inverse picking, bundle contracts, and stable foot sorting live in
`src/world` without Phaser imports. `src/adapters/phaser/isometric-world.ts`
owns Phaser graphics, chunk objects, the synthetic generated marker texture,
foreground alpha, pointer wiring, and disposal.

Loading creates one object per visual chunk plus sorted technical markers.
Unloading destroys every owned game object, removes the pointer listener,
clears bundle state, and removes the generated texture from Phaser's texture
manager. The automation-only query parameter exposes counts so Playwright proves
objects and assets reach zero before reload.

The fixture demonstrates discrete elevation, base foot sorting, an overhang
band, foreground occlusion, and elevation-aware inverse picking. Picking tests
resolve the highest authored surface under a screen point and explicitly cover
both an elevation-zero cell and the fixture's elevation-one cell. It does not
define collision, navigation, movement, actors, encounters, interactions, or
procedural generation.

## Verification

Run the clean gate sequence documented in `TOOLING.md`. Relevant focused checks:

```powershell
& $npm run world:check
& $npm run test:smoke
& $npm run test:visual
& $npm run test:browser
& $npm run budget
& $npm run budget:world
```

The canonical visual baseline uses pinned Playwright Chromium at 960×540 and
covers projection, depth, elevation, and occlusion in one deterministic image.
Functional load/pick/unload/reload checks run in every configured project:
Chromium, branded Chrome, branded Edge, Firefox, and WebKit. Browser
unavailability is `NOT RUN`, not a pass. WebKit is only an interim compatibility
signal; real Safari remains `NOT RUN — hardware unavailable`.

All package browser scripts use `scripts/run-playwright.mjs`, which reserves a
free loopback port once and passes it to the preview server and every Playwright
worker, with artifacts isolated by port. Tests wait for semantic fixture
diagnostics and invoke the same screen-coordinate picking path through stable
canvas coordinates; they do not depend on CSS-scaled physical mouse positions.

On 2026-09-04, pinned Playwright `1.62.1` attempted
`npm exec playwright -- install chrome`. Download began, but installation
failed with Playwright's insufficient-privileges diagnostic. Branded Chrome is
therefore `NOT RUN`, not passed. No elevated/admin retry was performed.

Strict P0-002 performance acceptance cannot run on the currently recorded
Ryzen 7/32 GB/RTX 5070 Ti machine because it is not the reference tier. Any
timings from this machine are diagnostic and `INELIGIBLE`.

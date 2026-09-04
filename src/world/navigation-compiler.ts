import { createHash } from "node:crypto";

import {
  NAVIGATION_GRID_VERSION,
  ZONE_BUNDLE_VERSION,
  type CompiledNavigationGridBundle,
} from "./contracts.ts";

interface Rectangle {
  readonly x?: unknown;
  readonly y?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly value?: unknown;
}

interface CompiledRectangle {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly value: number;
}

interface NavigationSource {
  readonly gridVersion?: unknown;
  readonly gridId?: unknown;
  readonly sourceZoneId?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly cellSize?: unknown;
  readonly defaultCost?: unknown;
  readonly defaultElevation?: unknown;
  readonly blocked?: unknown;
  readonly costs?: unknown;
  readonly elevations?: unknown;
}

function fail(source: string, detail: string): never {
  throw new Error(`${source}: ${detail}`);
}

function integer(
  value: unknown,
  source: string,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail(
      source,
      `"${field}" must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value as number;
}

function fixtureId(value: unknown, source: string, field: string): string {
  if (
    typeof value !== "string" ||
    !/^fixture:[a-z0-9][a-z0-9._/-]*$/.test(value)
  ) {
    fail(source, `"${field}" must use the fixture namespace.`);
  }
  return value;
}

function requireExactKeys(
  value: object,
  expected: readonly string[],
  source: string,
  field: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    required.some((key, index) => actual[index] !== key)
  ) {
    fail(source, `"${field}" keys must be exactly: ${required.join(", ")}.`);
  }
}

function rectangles(
  value: unknown,
  source: string,
  field: string,
  gridWidth: number,
  gridHeight: number,
  minimumValue: number,
  maximumValue: number,
): readonly CompiledRectangle[] {
  if (!Array.isArray(value)) {
    fail(source, `"${field}" must be an array.`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(source, `"${field}[${index}]" must be a rectangle.`);
    }
    const rectangle = entry as Rectangle;
    requireExactKeys(
      rectangle,
      ["x", "y", "width", "height", "value"],
      source,
      `${field}[${index}]`,
    );
    const x = integer(rectangle.x, source, `${field}[${index}].x`, 0);
    const y = integer(rectangle.y, source, `${field}[${index}].y`, 0);
    const width = integer(
      rectangle.width,
      source,
      `${field}[${index}].width`,
      1,
    );
    const height = integer(
      rectangle.height,
      source,
      `${field}[${index}].height`,
      1,
    );
    const cellValue = integer(
      rectangle.value,
      source,
      `${field}[${index}].value`,
      minimumValue,
      maximumValue,
    );
    if (x + width > gridWidth || y + height > gridHeight) {
      fail(source, `"${field}[${index}]" exceeds the navigation boundary.`);
    }
    return { x, y, width, height, value: cellValue };
  });
}

function fillRectangles(
  target: number[],
  gridWidth: number,
  definitions: readonly CompiledRectangle[],
): void {
  for (const rectangle of definitions) {
    for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
      for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
        target[y * gridWidth + x] = rectangle.value;
      }
    }
  }
}

export function compileNavigationGrid(
  input: unknown,
  source = "<navigation-grid>",
): CompiledNavigationGridBundle {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail(source, "root must be an object.");
  }
  requireExactKeys(
    input,
    [
      "gridVersion",
      "gridId",
      "sourceZoneId",
      "width",
      "height",
      "cellSize",
      "defaultCost",
      "defaultElevation",
      "blocked",
      "costs",
      "elevations",
    ],
    source,
    "root",
  );
  const definition = input as NavigationSource;
  if (definition.gridVersion !== NAVIGATION_GRID_VERSION) {
    fail(source, `"gridVersion" must be "${NAVIGATION_GRID_VERSION}".`);
  }
  const gridId = fixtureId(definition.gridId, source, "gridId");
  const sourceZoneId = fixtureId(
    definition.sourceZoneId,
    source,
    "sourceZoneId",
  );
  const width = integer(definition.width, source, "width", 1, 512);
  const height = integer(definition.height, source, "height", 1, 512);
  const cellSize = integer(definition.cellSize, source, "cellSize", 1, 1024);
  const defaultCost = integer(
    definition.defaultCost,
    source,
    "defaultCost",
    1,
    255,
  );
  const defaultElevation = integer(
    definition.defaultElevation,
    source,
    "defaultElevation",
    -32_768,
    32_767,
  );
  const costs = new Array<number>(width * height).fill(defaultCost);
  const elevations = new Array<number>(width * height).fill(defaultElevation);
  const costRectangles = rectangles(
    definition.costs,
    source,
    "costs",
    width,
    height,
    1,
    255,
  );
  const elevationRectangles = rectangles(
    definition.elevations,
    source,
    "elevations",
    width,
    height,
    -32_768,
    32_767,
  );
  const blockedRectangles = rectangles(
    definition.blocked,
    source,
    "blocked",
    width,
    height,
    0,
    0,
  );
  fillRectangles(costs, width, costRectangles);
  fillRectangles(elevations, width, elevationRectangles);
  fillRectangles(costs, width, blockedRectangles);

  const canonicalSource = `${JSON.stringify(input)}\n`;
  return {
    gridVersion: NAVIGATION_GRID_VERSION,
    zoneBundleVersion: ZONE_BUNDLE_VERSION,
    gridId,
    sourceZoneId,
    sourceHash: createHash("sha256").update(canonicalSource).digest("hex"),
    width,
    height,
    cellSize,
    costs,
    elevations,
  };
}

export function serializeNavigationGrid(
  bundle: CompiledNavigationGridBundle,
): string {
  return `${JSON.stringify(bundle)}\n`;
}

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { compileTiledMap, serializeZoneBundle } from "../../src/world/compiler";
import {
  compareFootDepth,
  pickAuthoredCell,
  projectIsometric,
  unprojectIsometric,
} from "../../src/world/projection";

function fixture(): Record<string, unknown> {
  const path = fileURLToPath(
    new URL("../../fixtures/world/technical-isometric.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

describe("isometric projection convention", () => {
  const projection = {
    tileWidth: 64,
    tileHeight: 32,
    elevationUnit: 16,
    originX: 480,
    originY: 92,
  } as const;

  it("projects known grid and elevation cases deterministically", () => {
    expect(projectIsometric({ x: 0, y: 0, elevation: 0 }, projection)).toEqual({
      x: 480,
      y: 92,
    });
    expect(projectIsometric({ x: 3, y: 2, elevation: 1 }, projection)).toEqual({
      x: 512,
      y: 156,
    });
  });

  it("round trips picking at each supported elevation", () => {
    for (const elevation of [0, 1, 2]) {
      const source = { x: 2.25, y: 4.5, elevation };
      const screen = projectIsometric(source, projection);
      expect(unprojectIsometric(screen, elevation, projection)).toEqual(source);
    }
  });

  it("sorts by elevation, foot row, then stable fixture ID", () => {
    const markers = [
      {
        id: "fixture:z",
        gridX: 2,
        gridY: 1,
        elevation: 0,
        color: "#fff",
        label: "z",
      },
      {
        id: "fixture:a",
        gridX: 1,
        gridY: 2,
        elevation: 0,
        color: "#fff",
        label: "a",
      },
      {
        id: "fixture:elevated",
        gridX: 0,
        gridY: 0,
        elevation: 1,
        color: "#fff",
        label: "e",
      },
    ];
    expect(markers.sort(compareFootDepth).map(({ id }) => id)).toEqual([
      "fixture:a",
      "fixture:z",
      "fixture:elevated",
    ]);
  });

  it("picks the highest authored discrete surface at screen coordinates", () => {
    const bundle = compileTiledMap(fixture(), "technical-isometric.json");
    const elevatedScreen = projectIsometric(
      { x: 3.5, y: 2.5, elevation: 1 },
      bundle.projection,
    );
    expect(pickAuthoredCell(elevatedScreen, bundle)).toEqual({
      x: 3,
      y: 2,
      elevation: 1,
    });

    const groundScreen = projectIsometric(
      { x: 0.5, y: 0.5, elevation: 0 },
      bundle.projection,
    );
    expect(pickAuthoredCell(groundScreen, bundle)).toEqual({
      x: 0,
      y: 0,
      elevation: 0,
    });
  });
});

describe("Tiled technical-zone compiler", () => {
  it("compiles chunks, ordered layers, elevations, markers, and asset keys", () => {
    const first = serializeZoneBundle(
      compileTiledMap(fixture(), "technical-isometric.json"),
    );
    const second = serializeZoneBundle(
      compileTiledMap(fixture(), "technical-isometric.json"),
    );
    expect(first).toBe(second);

    const bundle = JSON.parse(first) as {
      layers: { name: string; chunks: unknown[] }[];
      markers: unknown[];
      assetKeys: string[];
    };
    expect(bundle.layers.map(({ name }) => name)).toEqual([
      "ground",
      "detail",
      "low",
      "overhang",
      "foreground",
    ]);
    expect(bundle.layers.every(({ chunks }) => chunks.length === 4)).toBe(true);
    expect(bundle.markers).toHaveLength(3);
    expect(bundle.assetKeys).toEqual(["fixture:iso-marker-texture"]);
  });

  it.each([
    ["orientation", "orthogonal", '"orientation" must be "isometric"'],
    ["tilewidth", 32, '"tilewidth"/"tileheight" must be the 64x32 convention'],
    ["infinite", true, '"infinite" must be false'],
  ])(
    "rejects invalid %s metadata with source context",
    (field, value, detail) => {
      const invalid = fixture();
      invalid[field] = value;
      expect(() => compileTiledMap(invalid, "invalid-map.json")).toThrow(
        `invalid-map.json: ${detail}`,
      );
    },
  );

  it("rejects layer-order and elevation metadata drift", () => {
    const invalid = fixture();
    const layers = invalid["layers"] as Record<string, unknown>[];
    layers[0] = { ...layers[0], name: "wrong" };
    expect(() => compileTiledMap(invalid, "bad-layers.json")).toThrow(
      "bad-layers.json: tile layers must be exactly",
    );

    const invalidElevation = fixture();
    const properties = invalidElevation["properties"] as Record<
      string,
      unknown
    >[];
    const elevation = properties.find(
      (entry) => entry["name"] === "elevationUnit",
    );
    if (elevation === undefined) {
      throw new Error("Fixture elevation property missing.");
    }
    elevation["value"] = 8;
    expect(() =>
      compileTiledMap(invalidElevation, "bad-elevation.json"),
    ).toThrow('bad-elevation.json: "property.elevationUnit" must be 16');
  });

  it("rejects non-positive chunk dimensions before chunking", () => {
    const invalid = fixture();
    const properties = invalid["properties"] as Record<string, unknown>[];
    const chunkWidth = properties.find(
      (entry) => entry["name"] === "chunkWidth",
    );
    if (chunkWidth === undefined) {
      throw new Error("Fixture chunk-width property missing.");
    }
    chunkWidth["value"] = 0;
    expect(() => compileTiledMap(invalid, "zero-chunk.json")).toThrow(
      'zero-chunk.json: "property.chunkWidth" must be an integer >= 1',
    );
  });

  it("rejects unresolved synthetic tile references", () => {
    const invalid = fixture();
    const layers = invalid["layers"] as Record<string, unknown>[];
    const data = layers[0]?.["data"] as number[] | undefined;
    if (data === undefined) {
      throw new Error("Fixture ground data missing.");
    }
    data[0] = 99;
    expect(() => compileTiledMap(invalid, "unknown-gid.json")).toThrow(
      'unknown-gid.json: layer "ground" references an unknown gid',
    );
  });

  it.each([
    ["width", 5],
    ["height", 7],
  ])("rejects tile-layer %s that differs from the map", (field, value) => {
    const invalid = fixture();
    const layers = invalid["layers"] as Record<string, unknown>[];
    const ground = layers[0];
    if (ground === undefined) {
      throw new Error("Fixture ground layer missing.");
    }
    ground[field] = value;
    expect(() => compileTiledMap(invalid, "bad-dimensions.json")).toThrow(
      'bad-dimensions.json: layer "ground" dimensions must match the 6x6 map',
    );
  });

  it("rejects duplicate and additional object metadata layers", () => {
    const duplicate = fixture();
    const duplicateLayers = duplicate["layers"] as Record<string, unknown>[];
    const markers = duplicateLayers.at(-1);
    if (markers === undefined) {
      throw new Error("Fixture marker layer missing.");
    }
    duplicateLayers.push(structuredClone(markers));
    expect(() => compileTiledMap(duplicate, "duplicate-markers.json")).toThrow(
      'duplicate-markers.json: exactly one object metadata layer named "markers" is required',
    );

    const additional = fixture();
    const additionalLayers = additional["layers"] as Record<string, unknown>[];
    additionalLayers.push({
      name: "other-metadata",
      objects: [],
      type: "objectgroup",
    });
    expect(() => compileTiledMap(additional, "extra-objects.json")).toThrow(
      'extra-objects.json: exactly one object metadata layer named "markers" is required',
    );
  });

  it("rejects duplicate Tiled object IDs and undeclared metadata", () => {
    const duplicateId = fixture();
    const layers = duplicateId["layers"] as Record<string, unknown>[];
    const markerLayer = layers.at(-1);
    const objects = markerLayer?.["objects"] as
      Record<string, unknown>[] | undefined;
    if (objects?.[1] === undefined) {
      throw new Error("Fixture marker objects missing.");
    }
    objects[1]["id"] = 1;
    expect(() =>
      compileTiledMap(duplicateId, "duplicate-object-id.json"),
    ).toThrow("duplicate-object-id.json: duplicate Tiled object id 1");

    const extraProperty = fixture();
    const metadata = extraProperty["properties"] as Record<string, unknown>[];
    metadata.push({ name: "unexpected", type: "string", value: "invalid" });
    expect(() => compileTiledMap(extraProperty, "extra-property.json")).toThrow(
      "extra-property.json: map properties must be exactly",
    );

    const invalidSurface = fixture();
    const surfaceLayers = invalidSurface["layers"] as Record<string, unknown>[];
    const surfaceMarkerLayer = surfaceLayers.at(-1);
    const surfaceObjects = surfaceMarkerLayer?.["objects"] as
      Record<string, unknown>[] | undefined;
    const markerProperties = surfaceObjects?.[0]?.["properties"] as
      Record<string, unknown>[] | undefined;
    const markerElevation = markerProperties?.find(
      (entry) => entry["name"] === "elevation",
    );
    if (markerElevation === undefined) {
      throw new Error("Fixture marker elevation missing.");
    }
    markerElevation["value"] = 9;
    expect(() =>
      compileTiledMap(invalidSurface, "invalid-surface.json"),
    ).toThrow(
      'invalid-surface.json: marker "fixture:marker/amber" must reference an authored surface',
    );
  });
});

import { createHash } from "node:crypto";

import {
  ISO_LAYER_ORDER,
  ZONE_BUNDLE_VERSION,
  type CompiledZoneBundle,
  type IsoLayerName,
  type ZoneChunk,
  type ZoneMarker,
} from "./contracts.ts";

interface TiledProperty {
  readonly name?: unknown;
  readonly value?: unknown;
}

interface TiledLayer {
  readonly type?: unknown;
  readonly name?: unknown;
  readonly data?: unknown;
  readonly objects?: unknown;
  readonly properties?: unknown;
}

interface TiledMap {
  readonly type?: unknown;
  readonly orientation?: unknown;
  readonly renderorder?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly tilewidth?: unknown;
  readonly tileheight?: unknown;
  readonly infinite?: unknown;
  readonly properties?: unknown;
  readonly layers?: unknown;
  readonly tilesets?: unknown;
}

function fail(source: string, detail: string): never {
  throw new Error(`${source}: ${detail}`);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function integer(
  value: unknown,
  source: string,
  field: string,
  minimum = 0,
): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    fail(source, `"${field}" must be an integer >= ${minimum}.`);
  }
  return value as number;
}

function text(value: unknown, source: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(source, `"${field}" must be a non-empty string.`);
  }
  return value;
}

function properties(
  value: unknown,
  source: string,
): ReadonlyMap<string, unknown> {
  if (!Array.isArray(value)) {
    fail(source, '"properties" must be a Tiled property array.');
  }

  const result = new Map<string, unknown>();
  for (const entry of value as TiledProperty[]) {
    const name = text(entry.name, source, "property.name");
    if (result.has(name)) {
      fail(source, `duplicate property "${name}".`);
    }
    result.set(name, entry.value);
  }
  return result;
}

function property<T>(
  values: ReadonlyMap<string, unknown>,
  name: string,
  source: string,
  check: (value: unknown, source: string, field: string) => T,
): T {
  if (!values.has(name)) {
    fail(source, `missing required property "${name}".`);
  }
  return check(values.get(name), source, `property.${name}`);
}

function chunks(
  data: readonly number[],
  width: number,
  height: number,
  chunkWidth: number,
  chunkHeight: number,
  elevation: number,
): readonly ZoneChunk[] {
  const output: ZoneChunk[] = [];
  for (let originY = 0; originY < height; originY += chunkHeight) {
    for (let originX = 0; originX < width; originX += chunkWidth) {
      const actualWidth = Math.min(chunkWidth, width - originX);
      const actualHeight = Math.min(chunkHeight, height - originY);
      const tiles = [];
      for (let localY = 0; localY < actualHeight; localY += 1) {
        for (let localX = 0; localX < actualWidth; localX += 1) {
          const x = originX + localX;
          const y = originY + localY;
          const gid = data[y * width + x] ?? 0;
          if (gid !== 0) {
            tiles.push({ x, y, gid, elevation });
          }
        }
      }
      output.push({
        x: originX,
        y: originY,
        width: actualWidth,
        height: actualHeight,
        tiles,
      });
    }
  }
  return output;
}

export function compileTiledMap(
  input: unknown,
  source = "<tiled-map>",
): CompiledZoneBundle {
  const map = record(input) as TiledMap | undefined;
  if (map === undefined || map.type !== "map") {
    fail(source, 'root "type" must be "map".');
  }
  if (map.orientation !== "isometric") {
    fail(source, '"orientation" must be "isometric".');
  }
  if (map.renderorder !== "right-down") {
    fail(source, '"renderorder" must be "right-down".');
  }
  if (map.infinite !== false) {
    fail(source, '"infinite" must be false for this compiler version.');
  }

  const width = integer(map.width, source, "width", 1);
  const height = integer(map.height, source, "height", 1);
  if (map.tilewidth !== 64 || map.tileheight !== 32) {
    fail(source, '"tilewidth"/"tileheight" must be the 64x32 convention.');
  }
  if (!Array.isArray(map.tilesets) || map.tilesets.length !== 1) {
    fail(source, '"tilesets" must contain one embedded synthetic tileset.');
  }
  const tileset = record(map.tilesets[0]);
  if (
    tileset?.["firstgid"] !== 1 ||
    tileset["name"] !== "fixture:technical-tileset" ||
    tileset["tilecount"] !== 5
  ) {
    fail(
      source,
      'synthetic tileset must use firstgid 1, name "fixture:technical-tileset", and tilecount 5.',
    );
  }

  const metadata = properties(map.properties, source);
  const zoneId = property(metadata, "zoneId", source, text);
  if (!/^fixture:[a-z0-9][a-z0-9._/-]*$/.test(zoneId)) {
    fail(source, '"property.zoneId" must use the synthetic fixture namespace.');
  }
  const positiveInteger = (value: unknown, itemSource: string, field: string) =>
    integer(value, itemSource, field, 1);
  const chunkWidth = property(metadata, "chunkWidth", source, positiveInteger);
  const chunkHeight = property(
    metadata,
    "chunkHeight",
    source,
    positiveInteger,
  );
  const elevationUnit = property(metadata, "elevationUnit", source, integer);
  if (elevationUnit !== 16) {
    fail(source, '"property.elevationUnit" must be 16.');
  }

  if (!Array.isArray(map.layers)) {
    fail(source, '"layers" must be an array.');
  }
  const tiledLayers = map.layers as TiledLayer[];
  const visualLayers = tiledLayers.filter(
    (layer) => layer.type === "tilelayer",
  );
  const actualNames = visualLayers.map((layer) => layer.name);
  if (
    actualNames.length !== ISO_LAYER_ORDER.length ||
    ISO_LAYER_ORDER.some((name, index) => actualNames[index] !== name)
  ) {
    fail(source, `tile layers must be exactly: ${ISO_LAYER_ORDER.join(", ")}.`);
  }

  const layers = visualLayers.map((layer, index) => {
    if (!Array.isArray(layer.data) || layer.data.length !== width * height) {
      fail(source, `layer "${String(layer.name)}" data must cover the map.`);
    }
    const data = layer.data.map((gid, dataIndex) =>
      integer(gid, source, `${String(layer.name)}.data[${dataIndex}]`),
    );
    if (data.some((gid) => gid > 5)) {
      fail(source, `layer "${String(layer.name)}" references an unknown gid.`);
    }
    const layerProperties = properties(layer.properties, source);
    const elevation = property(layerProperties, "elevation", source, integer);
    return {
      name: ISO_LAYER_ORDER[index] as IsoLayerName,
      band: index,
      chunks: chunks(data, width, height, chunkWidth, chunkHeight, elevation),
    };
  });

  const markerLayer = tiledLayers.find(
    (layer) => layer.type === "objectgroup" && layer.name === "markers",
  );
  if (markerLayer === undefined || !Array.isArray(markerLayer.objects)) {
    fail(source, 'one object layer named "markers" is required.');
  }
  const seenIds = new Set<string>();
  const markers: ZoneMarker[] = markerLayer.objects.map((value, index) => {
    const object = record(value);
    if (object === undefined) {
      fail(source, `markers.objects[${index}] must be an object.`);
    }
    const id = text(object["name"], source, `markers.objects[${index}].name`);
    if (!/^fixture:[a-z0-9][a-z0-9._/-]*$/.test(id) || seenIds.has(id)) {
      fail(source, `marker "${id}" must be a unique synthetic fixture ID.`);
    }
    seenIds.add(id);
    const values = properties(object["properties"], source);
    return {
      id,
      gridX: property(values, "gridX", source, integer),
      gridY: property(values, "gridY", source, integer),
      elevation: property(values, "elevation", source, integer),
      color: property(values, "color", source, text),
      label: property(values, "label", source, text),
    };
  });

  const canonicalSource = `${JSON.stringify(input)}\n`;
  return {
    bundleVersion: ZONE_BUNDLE_VERSION,
    sourceFormat: "tiled-json",
    zoneId,
    sourceHash: createHash("sha256").update(canonicalSource).digest("hex"),
    width,
    height,
    chunkWidth,
    chunkHeight,
    projection: {
      tileWidth: 64,
      tileHeight: 32,
      elevationUnit: 16,
      originX: 480,
      originY: 92,
    },
    layers,
    markers,
    assetKeys: ["fixture:iso-marker-texture"],
  };
}

export function serializeZoneBundle(bundle: CompiledZoneBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

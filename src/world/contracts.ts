export const ZONE_BUNDLE_VERSION = "1.0.0" as const;
export const NAVIGATION_GRID_VERSION = "1.0.0" as const;

export const ISO_LAYER_ORDER = [
  "ground",
  "detail",
  "low",
  "overhang",
  "foreground",
] as const;

export type IsoLayerName = (typeof ISO_LAYER_ORDER)[number];

export interface IsoProjection {
  readonly tileWidth: 64;
  readonly tileHeight: 32;
  readonly elevationUnit: 16;
  readonly originX: number;
  readonly originY: number;
}

export interface ZoneTile {
  readonly x: number;
  readonly y: number;
  readonly gid: number;
  readonly elevation: number;
}

export interface ZoneChunk {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly ZoneTile[];
}

export interface ZoneLayer {
  readonly name: IsoLayerName;
  readonly band: number;
  readonly chunks: readonly ZoneChunk[];
}

export interface ZoneMarker {
  readonly id: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly elevation: number;
  readonly color: string;
  readonly label: string;
}

export interface CompiledZoneBundle {
  readonly bundleVersion: typeof ZONE_BUNDLE_VERSION;
  readonly sourceFormat: "tiled-json";
  readonly zoneId: string;
  readonly sourceHash: string;
  readonly width: number;
  readonly height: number;
  readonly chunkWidth: number;
  readonly chunkHeight: number;
  readonly projection: IsoProjection;
  readonly layers: readonly ZoneLayer[];
  readonly markers: readonly ZoneMarker[];
  readonly assetKeys: readonly string[];
}

export interface CompiledNavigationGridBundle {
  readonly gridVersion: typeof NAVIGATION_GRID_VERSION;
  readonly zoneBundleVersion: typeof ZONE_BUNDLE_VERSION;
  readonly gridId: string;
  readonly sourceZoneId: string;
  readonly sourceHash: string;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly costs: readonly number[];
  readonly elevations: readonly number[];
}

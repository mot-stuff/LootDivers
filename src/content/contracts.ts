export const STABLE_ID_PATTERN =
  "^[a-z][a-z0-9_-]{1,31}:[a-z][a-z0-9_.-]{1,63}$";

export const SUPPORTED_SCHEMA_VERSION = "1.0.0";
export const SUPPORTED_COMPILER_VERSION = "1.0.0";

export type StableId = `${string}:${string}`;

export interface VersionedDocument {
  readonly schemaVersion: string;
  readonly contentVersion: string;
}

export interface ContentProject extends VersionedDocument {
  readonly kind: "project";
  readonly id: StableId;
}

export interface StatDefinition {
  readonly id: StableId;
  readonly minimum: number;
  readonly maximum: number;
}

export interface StatRegistry extends VersionedDocument {
  readonly kind: "stat-registry";
  readonly entries: readonly StatDefinition[];
}

export interface TagDefinition {
  readonly id: StableId;
}

export interface TagRegistry extends VersionedDocument {
  readonly kind: "tag-registry";
  readonly entries: readonly TagDefinition[];
}

export type AssetType = "audio" | "data" | "image";

export interface AssetDefinition {
  readonly id: StableId;
  readonly type: AssetType;
  readonly source: string;
}

export interface AssetRegistry extends VersionedDocument {
  readonly kind: "asset-registry";
  readonly entries: readonly AssetDefinition[];
}

export interface StatValue {
  readonly statId: StableId;
  readonly value: number;
}

export interface TechnicalDefinition extends VersionedDocument {
  readonly kind: "technical-definition";
  readonly id: StableId;
  readonly tags: readonly StableId[];
  readonly stats: readonly StatValue[];
  readonly assets: readonly StableId[];
  readonly references: readonly StableId[];
}

export type ContentDocument =
  | AssetRegistry
  | ContentProject
  | StatRegistry
  | TagRegistry
  | TechnicalDefinition;

export interface Diagnostic {
  readonly code: string;
  readonly source: string;
  readonly path: string;
  readonly message: string;
}

export interface ValidatedContent {
  readonly project: ContentProject;
  readonly assets: readonly AssetDefinition[];
  readonly stats: readonly StatDefinition[];
  readonly tags: readonly TagDefinition[];
  readonly definitions: readonly TechnicalDefinition[];
  readonly sourceHash: string;
}

export const REQUIRED_KEYS = {
  project: ["schemaVersion", "contentVersion", "kind", "id"],
  statRegistry: ["schemaVersion", "contentVersion", "kind", "entries"],
  tagRegistry: ["schemaVersion", "contentVersion", "kind", "entries"],
  assetRegistry: ["schemaVersion", "contentVersion", "kind", "entries"],
  technicalDefinition: [
    "schemaVersion",
    "contentVersion",
    "kind",
    "id",
    "tags",
    "stats",
    "assets",
    "references",
  ],
} as const satisfies {
  readonly project: readonly (keyof ContentProject)[];
  readonly statRegistry: readonly (keyof StatRegistry)[];
  readonly tagRegistry: readonly (keyof TagRegistry)[];
  readonly assetRegistry: readonly (keyof AssetRegistry)[];
  readonly technicalDefinition: readonly (keyof TechnicalDefinition)[];
};

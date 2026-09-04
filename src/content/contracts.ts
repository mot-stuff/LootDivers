export const STABLE_ID_PATTERN = "^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._/-]*$";

export const ASSET_PATH_PATTERN =
  "^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!/)(?!.*\\\\)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*//)[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?(?:/[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9_-])?)*$";

export const SUPPORTED_SCHEMA_VERSION = "1.0.0";
export const SUPPORTED_COMPILER_VERSION = "1.0.0";

export type StableId = `${string}:${string}`;
export type AssetPath = string;

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

export const ASSET_TYPES = ["audio", "data", "image"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface AssetDefinition {
  readonly id: StableId;
  readonly type: AssetType;
  readonly source: AssetPath;
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

export interface CompiledChunkDescriptor {
  readonly id: StableId;
  readonly path: AssetPath;
  readonly sha256: string;
}

export interface CompiledContentManifest {
  readonly compilerVersion: string;
  readonly schemaVersion: string;
  readonly contentVersion: string;
  readonly projectId: StableId;
  readonly sourceHash: string;
  readonly chunks: readonly CompiledChunkDescriptor[];
}

export interface CompiledRegistriesChunk {
  readonly assets: readonly AssetDefinition[];
  readonly stats: readonly StatDefinition[];
  readonly tags: readonly TagDefinition[];
}

export type CompiledTechnicalDefinitionsChunk = readonly TechnicalDefinition[];

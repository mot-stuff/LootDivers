import type { JSONSchemaType } from "ajv";

import {
  ASSET_PATH_PATTERN,
  ASSET_TYPES,
  STABLE_ID_PATTERN,
  type AssetDefinition,
  type CompiledContentManifest,
  type CompiledRegistriesChunk,
  type CompiledTechnicalDefinitionsChunk,
  type ContentProject,
  type StatDefinition,
  type StatRegistry,
  type StatValue,
  type TagDefinition,
  type TagRegistry,
  type TechnicalDefinition,
  type AssetRegistry,
} from "./contracts.ts";

const META_SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const SCHEMA_ROOT = "https://rarpg.dev/schemas/content/v1";
const VERSION_PATTERN = "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$";
const SHA256_PATTERN = "^[a-f0-9]{64}$";
const SAFE_NUMBER_MINIMUM = -1_000_000_000;
const SAFE_NUMBER_MAXIMUM = 1_000_000_000;

const stableIdSchema = {
  type: "string",
  pattern: STABLE_ID_PATTERN,
} as const;

const versionSchema = {
  type: "string",
  pattern: VERSION_PATTERN,
} as const;

const assetPathSchema = {
  type: "string",
  minLength: 1,
  pattern: ASSET_PATH_PATTERN,
} as const;

const statDefinitionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stableIdSchema,
    minimum: {
      type: "number",
      minimum: SAFE_NUMBER_MINIMUM,
      maximum: SAFE_NUMBER_MAXIMUM,
    },
    maximum: {
      type: "number",
      minimum: SAFE_NUMBER_MINIMUM,
      maximum: SAFE_NUMBER_MAXIMUM,
    },
  },
  required: ["id", "minimum", "maximum"],
} as const satisfies JSONSchemaType<StatDefinition>;

const tagDefinitionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stableIdSchema,
  },
  required: ["id"],
} as const satisfies JSONSchemaType<TagDefinition>;

const assetDefinitionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stableIdSchema,
    type: {
      type: "string",
      enum: ASSET_TYPES,
    },
    source: assetPathSchema,
  },
  required: ["id", "type", "source"],
} as const satisfies JSONSchemaType<AssetDefinition>;

const statValueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    statId: stableIdSchema,
    value: {
      type: "number",
      minimum: SAFE_NUMBER_MINIMUM,
      maximum: SAFE_NUMBER_MAXIMUM,
    },
  },
  required: ["statId", "value"],
} as const satisfies JSONSchemaType<StatValue>;

export const projectSchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/project.schema.json`,
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: versionSchema,
    contentVersion: versionSchema,
    kind: { type: "string", const: "project" },
    id: stableIdSchema,
  },
  required: ["schemaVersion", "contentVersion", "kind", "id"],
} as const satisfies JSONSchemaType<ContentProject>;

export const statRegistrySchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/stat-registry.schema.json`,
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: versionSchema,
    contentVersion: versionSchema,
    kind: { type: "string", const: "stat-registry" },
    entries: {
      type: "array",
      items: statDefinitionSchema,
    },
  },
  required: ["schemaVersion", "contentVersion", "kind", "entries"],
} as const satisfies JSONSchemaType<StatRegistry>;

export const tagRegistrySchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/tag-registry.schema.json`,
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: versionSchema,
    contentVersion: versionSchema,
    kind: { type: "string", const: "tag-registry" },
    entries: {
      type: "array",
      items: tagDefinitionSchema,
    },
  },
  required: ["schemaVersion", "contentVersion", "kind", "entries"],
} as const satisfies JSONSchemaType<TagRegistry>;

export const assetRegistrySchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/asset-registry.schema.json`,
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: versionSchema,
    contentVersion: versionSchema,
    kind: { type: "string", const: "asset-registry" },
    entries: {
      type: "array",
      items: assetDefinitionSchema,
    },
  },
  required: ["schemaVersion", "contentVersion", "kind", "entries"],
} as const satisfies JSONSchemaType<AssetRegistry>;

const technicalDefinitionBody = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: versionSchema,
    contentVersion: versionSchema,
    kind: { type: "string", const: "technical-definition" },
    id: stableIdSchema,
    tags: {
      type: "array",
      uniqueItems: true,
      items: stableIdSchema,
    },
    stats: {
      type: "array",
      items: statValueSchema,
    },
    assets: {
      type: "array",
      uniqueItems: true,
      items: stableIdSchema,
    },
    references: {
      type: "array",
      uniqueItems: true,
      items: stableIdSchema,
    },
  },
  required: [
    "schemaVersion",
    "contentVersion",
    "kind",
    "id",
    "tags",
    "stats",
    "assets",
    "references",
  ],
} as const satisfies JSONSchemaType<TechnicalDefinition>;

export const technicalDefinitionSchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/technical-definition.schema.json`,
  ...technicalDefinitionBody,
} as const;

const compiledChunkDescriptorSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stableIdSchema,
    path: assetPathSchema,
    sha256: { type: "string", pattern: SHA256_PATTERN },
  },
  required: ["id", "path", "sha256"],
} as const;

export const compiledManifestSchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/compiled-manifest.schema.json`,
  type: "object",
  additionalProperties: false,
  properties: {
    compilerVersion: versionSchema,
    schemaVersion: versionSchema,
    contentVersion: versionSchema,
    projectId: stableIdSchema,
    sourceHash: { type: "string", pattern: SHA256_PATTERN },
    chunks: {
      type: "array",
      items: compiledChunkDescriptorSchema,
    },
  },
  required: [
    "compilerVersion",
    "schemaVersion",
    "contentVersion",
    "projectId",
    "sourceHash",
    "chunks",
  ],
} as const satisfies JSONSchemaType<CompiledContentManifest>;

export const compiledRegistriesChunkSchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/compiled-registries-chunk.schema.json`,
  type: "object",
  additionalProperties: false,
  properties: {
    assets: { type: "array", items: assetDefinitionSchema },
    stats: { type: "array", items: statDefinitionSchema },
    tags: { type: "array", items: tagDefinitionSchema },
  },
  required: ["assets", "stats", "tags"],
} as const satisfies JSONSchemaType<CompiledRegistriesChunk>;

export const compiledTechnicalDefinitionsChunkSchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/compiled-technical-definitions-chunk.schema.json`,
  type: "array",
  items: technicalDefinitionBody,
} as const satisfies JSONSchemaType<CompiledTechnicalDefinitionsChunk>;

export const commonSchema = {
  $schema: META_SCHEMA,
  $id: `${SCHEMA_ROOT}/common.schema.json`,
  $defs: {
    stableId: stableIdSchema,
    assetPath: assetPathSchema,
    version: versionSchema,
    sha256: { type: "string", pattern: SHA256_PATTERN },
  },
} as const;

export const CONTENT_SCHEMAS = {
  "asset-registry.schema.json": assetRegistrySchema,
  "common.schema.json": commonSchema,
  "compiled-manifest.schema.json": compiledManifestSchema,
  "compiled-registries-chunk.schema.json": compiledRegistriesChunkSchema,
  "compiled-technical-definitions-chunk.schema.json":
    compiledTechnicalDefinitionsChunkSchema,
  "project.schema.json": projectSchema,
  "stat-registry.schema.json": statRegistrySchema,
  "tag-registry.schema.json": tagRegistrySchema,
  "technical-definition.schema.json": technicalDefinitionSchema,
} as const;

export const SOURCE_SCHEMA_BY_KIND = {
  project: projectSchema,
  "stat-registry": statRegistrySchema,
  "tag-registry": tagRegistrySchema,
  "asset-registry": assetRegistrySchema,
  "technical-definition": technicalDefinitionSchema,
} as const;

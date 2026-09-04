import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import {
  SUPPORTED_COMPILER_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  type AssetDefinition,
  type ContentDocument,
  type ContentProject,
  type Diagnostic,
  type StatDefinition,
  type StableId,
  type TagDefinition,
  type TechnicalDefinition,
  type ValidatedContent,
} from "./contracts.ts";

const SCHEMA_FILES = [
  "common.schema.json",
  "project.schema.json",
  "stat-registry.schema.json",
  "tag-registry.schema.json",
  "asset-registry.schema.json",
  "technical-definition.schema.json",
] as const;

const SCHEMA_BY_KIND = {
  project: "https://rarpg.dev/schemas/content/v1/project.schema.json",
  "stat-registry":
    "https://rarpg.dev/schemas/content/v1/stat-registry.schema.json",
  "tag-registry":
    "https://rarpg.dev/schemas/content/v1/tag-registry.schema.json",
  "asset-registry":
    "https://rarpg.dev/schemas/content/v1/asset-registry.schema.json",
  "technical-definition":
    "https://rarpg.dev/schemas/content/v1/technical-definition.schema.json",
} as const;

interface SourceDocument {
  readonly source: string;
  readonly value: unknown;
}

interface Located<T> {
  readonly source: string;
  readonly value: T;
}

export interface ValidateOptions {
  readonly schemasDirectory?: string;
}

export interface ValidationResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly content?: ValidatedContent;
}

export interface CompileResult {
  readonly files: readonly string[];
  readonly manifestHash: string;
}

function normalizePath(path: string): string {
  return path.split(sep).join("/");
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return listJsonFiles(path);
      }
      return entry.isFile() && entry.name.endsWith(".json") ? [path] : [];
    }),
  );
  return nested.flat().sort((left, right) => left.localeCompare(right));
}

async function loadSchemas(
  schemasDirectory: string,
): Promise<Map<string, ValidateFunction>> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  for (const filename of SCHEMA_FILES) {
    const text = await readFile(join(schemasDirectory, filename), "utf8");
    ajv.addSchema(JSON.parse(text) as object);
  }

  return new Map(
    Object.entries(SCHEMA_BY_KIND).map(([kind, schemaId]) => {
      const validator = ajv.getSchema(schemaId);
      if (validator === undefined) {
        throw new Error(`Schema "${schemaId}" did not compile.`);
      }
      return [kind, validator];
    }),
  );
}

function shapeDiagnostics(
  source: string,
  errors: readonly ErrorObject[] | null | undefined,
): Diagnostic[] {
  return (errors ?? []).map((error) => ({
    code: "SHAPE_INVALID",
    source,
    path: error.instancePath || "/",
    message: error.message ?? "does not match the schema",
  }));
}

function diagnostic(
  code: string,
  source: string,
  path: string,
  message: string,
): Diagnostic {
  return { code, source, path, message };
}

function addUnique<T extends { readonly id: StableId }>(
  located: Located<T>,
  category: string,
  target: T[],
  sources: Map<StableId, string>,
  diagnostics: Diagnostic[],
): void {
  const previous = sources.get(located.value.id);
  if (previous !== undefined) {
    diagnostics.push(
      diagnostic(
        "DUPLICATE_ID",
        located.source,
        "/id",
        `ID "${located.value.id}" duplicates ${category} ID from "${previous}".`,
      ),
    );
    return;
  }
  sources.set(located.value.id, located.source);
  target.push(located.value);
}

function sortById<T extends { readonly id: string }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) => left.id.localeCompare(right.id));
}

export async function validateContentDirectory(
  sourceDirectory: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const absoluteSource = resolve(sourceDirectory);
  const schemasDirectory = resolve(
    options.schemasDirectory ?? "schemas/content/v1",
  );
  const validators = await loadSchemas(schemasDirectory);
  const diagnostics: Diagnostic[] = [];
  const documents: Located<ContentDocument>[] = [];
  const sourceDocuments: SourceDocument[] = [];

  for (const filename of await listJsonFiles(absoluteSource)) {
    const source = normalizePath(relative(absoluteSource, filename));
    let value: unknown;
    try {
      value = JSON.parse(await readFile(filename, "utf8")) as unknown;
    } catch (error: unknown) {
      diagnostics.push(
        diagnostic(
          "JSON_INVALID",
          source,
          "/",
          error instanceof Error ? error.message : String(error),
        ),
      );
      continue;
    }

    sourceDocuments.push({ source, value });
    const kind =
      value !== null && typeof value === "object"
        ? (value as { readonly kind?: unknown }).kind
        : undefined;
    const validator =
      typeof kind === "string" ? validators.get(kind) : undefined;
    if (validator === undefined) {
      diagnostics.push(
        diagnostic(
          "SHAPE_INVALID",
          source,
          "/kind",
          "must name a supported content document kind",
        ),
      );
      continue;
    }
    if (!validator(value)) {
      diagnostics.push(...shapeDiagnostics(source, validator.errors));
      continue;
    }
    documents.push({ source, value: value as ContentDocument });
  }

  const projects = documents.filter(
    (entry): entry is Located<ContentProject> => entry.value.kind === "project",
  );
  if (projects.length !== 1) {
    diagnostics.push(
      diagnostic(
        "PROJECT_COUNT_INVALID",
        "<content-root>",
        "/",
        `Expected exactly one project document, found ${projects.length}.`,
      ),
    );
  }
  const project = projects[0];

  for (const document of documents) {
    if (document.value.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
      diagnostics.push(
        diagnostic(
          "SCHEMA_VERSION_INCOMPATIBLE",
          document.source,
          "/schemaVersion",
          `Schema version "${document.value.schemaVersion}" is incompatible; expected "${SUPPORTED_SCHEMA_VERSION}".`,
        ),
      );
    }
    if (
      project !== undefined &&
      document.value.contentVersion !== project.value.contentVersion
    ) {
      diagnostics.push(
        diagnostic(
          "CONTENT_VERSION_INCOMPATIBLE",
          document.source,
          "/contentVersion",
          `Content version "${document.value.contentVersion}" does not match project version "${project.value.contentVersion}".`,
        ),
      );
    }
  }

  const idSources = new Map<StableId, string>();
  const assets: AssetDefinition[] = [];
  const stats: StatDefinition[] = [];
  const tags: TagDefinition[] = [];
  const definitions: TechnicalDefinition[] = [];
  const definitionSources = new Map<StableId, string>();

  const registryCounts = new Map<string, number>();
  for (const document of documents) {
    const { source, value } = document;
    if (value.kind === "project") {
      addUnique({ source, value }, "project", [], idSources, diagnostics);
      continue;
    }
    if (value.kind.endsWith("-registry")) {
      registryCounts.set(value.kind, (registryCounts.get(value.kind) ?? 0) + 1);
    }
    if (value.kind === "asset-registry") {
      value.entries.forEach((entry) =>
        addUnique(
          { source, value: entry },
          "asset",
          assets,
          idSources,
          diagnostics,
        ),
      );
    } else if (value.kind === "stat-registry") {
      value.entries.forEach((entry) =>
        addUnique(
          { source, value: entry },
          "stat",
          stats,
          idSources,
          diagnostics,
        ),
      );
    } else if (value.kind === "tag-registry") {
      value.entries.forEach((entry) =>
        addUnique(
          { source, value: entry },
          "tag",
          tags,
          idSources,
          diagnostics,
        ),
      );
    } else if (value.kind === "technical-definition") {
      addUnique(
        { source, value },
        "definition",
        definitions,
        idSources,
        diagnostics,
      );
      if (!definitionSources.has(value.id)) {
        definitionSources.set(value.id, source);
      }
    }
  }

  for (const kind of [
    "asset-registry",
    "stat-registry",
    "tag-registry",
  ] as const) {
    const count = registryCounts.get(kind) ?? 0;
    if (count !== 1) {
      diagnostics.push(
        diagnostic(
          "REGISTRY_COUNT_INVALID",
          "<content-root>",
          "/",
          `Expected exactly one ${kind}, found ${count}.`,
        ),
      );
    }
  }

  const assetIds = new Set(assets.map((entry) => entry.id));
  const statById = new Map(stats.map((entry) => [entry.id, entry]));
  const tagIds = new Set(tags.map((entry) => entry.id));
  const definitionIds = new Set(definitions.map((entry) => entry.id));

  for (const stat of stats) {
    if (stat.minimum > stat.maximum) {
      diagnostics.push(
        diagnostic(
          "STAT_RANGE_INVALID",
          idSources.get(stat.id) ?? "<unknown>",
          "/entries",
          `Stat "${stat.id}" minimum ${stat.minimum} exceeds maximum ${stat.maximum}.`,
        ),
      );
    }
  }

  for (const definition of definitions) {
    const source = definitionSources.get(definition.id) ?? "<unknown>";
    definition.tags.forEach((id, index) => {
      if (!tagIds.has(id)) {
        diagnostics.push(
          diagnostic(
            "TAG_UNKNOWN",
            source,
            `/tags/${index}`,
            `Unknown tag ID "${id}".`,
          ),
        );
      }
    });
    definition.assets.forEach((id, index) => {
      if (!assetIds.has(id)) {
        diagnostics.push(
          diagnostic(
            "ASSET_UNKNOWN",
            source,
            `/assets/${index}`,
            `Unknown asset ID "${id}".`,
          ),
        );
      }
    });
    definition.references.forEach((id, index) => {
      if (!definitionIds.has(id)) {
        diagnostics.push(
          diagnostic(
            "REFERENCE_MISSING",
            source,
            `/references/${index}`,
            `Referenced definition ID "${id}" does not exist.`,
          ),
        );
      }
    });
    definition.stats.forEach((statValue, index) => {
      const stat = statById.get(statValue.statId);
      if (stat === undefined) {
        diagnostics.push(
          diagnostic(
            "STAT_UNKNOWN",
            source,
            `/stats/${index}/statId`,
            `Unknown stat ID "${statValue.statId}".`,
          ),
        );
      } else if (
        statValue.value < stat.minimum ||
        statValue.value > stat.maximum
      ) {
        diagnostics.push(
          diagnostic(
            "STAT_VALUE_OUT_OF_RANGE",
            source,
            `/stats/${index}/value`,
            `Value ${statValue.value} is outside "${stat.id}" range [${stat.minimum}, ${stat.maximum}].`,
          ),
        );
      }
    });
  }

  diagnostics.sort((left, right) =>
    `${left.source}\0${left.path}\0${left.code}`.localeCompare(
      `${right.source}\0${right.path}\0${right.code}`,
    ),
  );
  if (diagnostics.length > 0 || project === undefined) {
    return { diagnostics };
  }

  const sourceHash = sha256(
    sourceDocuments
      .sort((left, right) => left.source.localeCompare(right.source))
      .map(({ source, value }) => `${source}\0${stableJson(value)}\n`)
      .join(""),
  );
  return {
    diagnostics,
    content: {
      project: project.value,
      assets: sortById(assets),
      stats: sortById(stats),
      tags: sortById(tags),
      definitions: sortById(definitions).map((definition) => ({
        ...definition,
        assets: [...definition.assets].sort(),
        references: [...definition.references].sort(),
        stats: [...definition.stats].sort((left, right) =>
          left.statId.localeCompare(right.statId),
        ),
        tags: [...definition.tags].sort(),
      })),
      sourceHash,
    },
  };
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableJson(value)}\n`, "utf8");
}

export async function compileContent(
  sourceDirectory: string,
  outputDirectory: string,
  options: ValidateOptions = {},
): Promise<CompileResult> {
  const validation = await validateContentDirectory(sourceDirectory, options);
  if (validation.content === undefined) {
    throw new ContentValidationError(validation.diagnostics);
  }
  const { content } = validation;
  await rm(outputDirectory, { recursive: true, force: true });

  const chunks = [
    [
      "registries",
      {
        assets: content.assets,
        stats: content.stats,
        tags: content.tags,
      },
    ],
    ["technical-definitions", content.definitions],
  ] as const;
  const manifestChunks = [];
  const files: string[] = [];
  for (const [name, data] of chunks) {
    const path = `chunks/${name}.json`;
    const text = `${stableJson(data)}\n`;
    await writeStableJson(join(outputDirectory, path), data);
    files.push(path);
    manifestChunks.push({
      id: `core:${name}`,
      path,
      sha256: sha256(text),
    });
  }

  const manifest = {
    compilerVersion: SUPPORTED_COMPILER_VERSION,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    contentVersion: content.project.contentVersion,
    projectId: content.project.id,
    sourceHash: content.sourceHash,
    chunks: manifestChunks,
  };
  await writeStableJson(join(outputDirectory, "manifest.json"), manifest);
  files.push("manifest.json");
  return {
    files: files.sort(),
    manifestHash: sha256(`${stableJson(manifest)}\n`),
  };
}

export class ContentValidationError extends Error {
  public readonly diagnostics: readonly Diagnostic[];

  public constructor(diagnostics: readonly Diagnostic[]) {
    super("Content validation failed.");
    this.name = "ContentValidationError";
    this.diagnostics = diagnostics;
  }
}

async function snapshotDirectory(
  directory: string,
): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  for (const filename of await listJsonFiles(directory)) {
    snapshot.set(
      normalizePath(relative(directory, filename)),
      await readFile(filename),
    );
  }
  return snapshot;
}

export async function checkContentDeterminism(
  sourceDirectory: string,
  options: ValidateOptions = {},
): Promise<void> {
  const base = join(tmpdir(), `rarpg-content-${process.pid}-${Date.now()}`);
  const first = join(base, "first");
  const second = join(base, "second");
  try {
    await compileContent(sourceDirectory, first, options);
    await compileContent(sourceDirectory, second, options);
    const left = await snapshotDirectory(first);
    const right = await snapshotDirectory(second);
    if (
      left.size !== right.size ||
      [...left].some(
        ([path, bytes]) =>
          !right.has(path) || !bytes.equals(right.get(path) as Buffer),
      )
    ) {
      throw new Error("Content compiler output was not byte-identical.");
    }
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

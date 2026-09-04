import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";
import { tmpdir } from "node:os";

import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";

import {
  ASSET_PATH_PATTERN,
  SUPPORTED_COMPILER_VERSION,
  SUPPORTED_SCHEMA_VERSION,
  type AssetDefinition,
  type CompiledContentManifest,
  type CompiledRegistriesChunk,
  type CompiledTechnicalDefinitionsChunk,
  type ContentDocument,
  type ContentProject,
  type Diagnostic,
  type StatDefinition,
  type StableId,
  type TagDefinition,
  type TechnicalDefinition,
  type ValidatedContent,
} from "./contracts.ts";
import {
  compiledManifestSchema,
  compiledRegistriesChunkSchema,
  compiledTechnicalDefinitionsChunkSchema,
  CONTENT_SCHEMAS,
  SOURCE_SCHEMA_BY_KIND,
} from "./schemas.ts";

const SAFE_ASSET_PATH = new RegExp(ASSET_PATH_PATTERN);
const WINDOWS_RESERVED_ASSET_SEGMENT =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

interface SourceDocument {
  readonly source: string;
  readonly value: unknown;
}

interface Located<T> {
  readonly source: string;
  readonly path: string;
  readonly value: T;
}

interface SourcePointer {
  readonly source: string;
  readonly path: string;
}

export interface ValidateOptions {
  readonly assetRoot?: string;
  readonly schemasDirectory?: string;
}

export interface DeterminismOptions extends ValidateOptions {
  readonly canonicalDirectory?: string;
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

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right));
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
  return nested.flat().sort(compareCodeUnits);
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? listFiles(path)
        : entry.isFile()
          ? [path]
          : [];
    }),
  );
  return nested.flat().sort(compareCodeUnits);
}

function formatSchemaArtifact(schema: unknown): string {
  return `${JSON.stringify(schema, undefined, 2)}\n`;
}

export async function generateSchemaArtifacts(
  schemasDirectory: string,
): Promise<void> {
  await rm(schemasDirectory, { recursive: true, force: true });
  await mkdir(schemasDirectory, { recursive: true });
  for (const [filename, schema] of Object.entries(CONTENT_SCHEMAS).sort(
    ([left], [right]) => compareCodeUnits(left, right),
  )) {
    await writeFile(
      join(schemasDirectory, filename),
      formatSchemaArtifact(schema),
      "utf8",
    );
  }
}

export async function checkSchemaArtifacts(
  schemasDirectory: string,
): Promise<void> {
  const expectedNames = Object.keys(CONTENT_SCHEMAS).sort(compareCodeUnits);
  const actualNames = (await listFiles(schemasDirectory)).map((path) =>
    normalizePath(relative(schemasDirectory, path)),
  );
  if (
    expectedNames.length !== actualNames.length ||
    expectedNames.some((name, index) => name !== actualNames[index])
  ) {
    throw new Error(
      "Versioned JSON Schema artifacts are missing or contain unexpected files.",
    );
  }
  for (const filename of expectedNames) {
    const actual = await readFile(join(schemasDirectory, filename), "utf8");
    const expected = formatSchemaArtifact(
      CONTENT_SCHEMAS[filename as keyof typeof CONTENT_SCHEMAS],
    );
    if (actual !== expected) {
      throw new Error(
        `Versioned JSON Schema artifact "${filename}" is stale; regenerate schemas.`,
      );
    }
  }
}

function loadSchemas(): Map<string, ValidateFunction> {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return new Map(
    Object.entries(SOURCE_SCHEMA_BY_KIND).map(([kind, schema]) => {
      return [kind, ajv.compile(schema)];
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

export function isAssetPathContained(
  assetRoot: string,
  source: string,
): boolean {
  if (
    source.length === 0 ||
    !SAFE_ASSET_PATH.test(source) ||
    source.includes("\\") ||
    posix.isAbsolute(source) ||
    win32.isAbsolute(source) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(source)
  ) {
    return false;
  }
  const segments = source.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        WINDOWS_RESERVED_ASSET_SEGMENT.test(segment),
    ) ||
    posix.normalize(source) !== source
  ) {
    return false;
  }

  const absoluteRoot = resolve(assetRoot);
  const candidate = resolve(absoluteRoot, ...segments);
  const fromRoot = relative(absoluteRoot, candidate);
  return (
    fromRoot === "" ||
    (!isAbsolute(fromRoot) &&
      fromRoot !== ".." &&
      !fromRoot.startsWith(`..${sep}`))
  );
}

function addUnique<T extends { readonly id: StableId }>(
  located: Located<T>,
  category: string,
  target: T[],
  sources: Map<StableId, SourcePointer>,
  diagnostics: Diagnostic[],
): void {
  const previous = sources.get(located.value.id);
  if (previous !== undefined) {
    diagnostics.push(
      diagnostic(
        "DUPLICATE_ID",
        located.source,
        located.path,
        `ID "${located.value.id}" duplicates ${category} ID from "${previous.source}${previous.path}".`,
      ),
    );
    return;
  }
  sources.set(located.value.id, {
    source: located.source,
    path: located.path,
  });
  target.push(located.value);
}

function sortById<T extends { readonly id: string }>(
  entries: readonly T[],
): T[] {
  return [...entries].sort((left, right) =>
    compareCodeUnits(left.id, right.id),
  );
}

export async function validateContentDirectory(
  sourceDirectory: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const absoluteSource = resolve(sourceDirectory);
  const schemasDirectory = resolve(
    options.schemasDirectory ?? "schemas/content/v1",
  );
  await checkSchemaArtifacts(schemasDirectory);
  const validators = loadSchemas();
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
    documents.push({ source, path: "/", value: value as ContentDocument });
  }

  const projects = documents.filter(
    (entry): entry is Located<ContentProject> => entry.value.kind === "project",
  );
  if (projects.length !== 1) {
    if (projects.length === 0) {
      diagnostics.push(
        diagnostic(
          "PROJECT_COUNT_INVALID",
          "project.json",
          "/",
          "Project document is missing; expected exactly one.",
        ),
      );
    } else {
      projects.slice(1).forEach((entry) => {
        diagnostics.push(
          diagnostic(
            "PROJECT_COUNT_INVALID",
            entry.source,
            "/kind",
            `Extra project document; first project is "${projects[0]?.source}".`,
          ),
        );
      });
    }
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

  const idSources = new Map<StableId, SourcePointer>();
  const assets: AssetDefinition[] = [];
  const stats: StatDefinition[] = [];
  const tags: TagDefinition[] = [];
  const definitions: TechnicalDefinition[] = [];
  const definitionSources = new Map<StableId, string>();
  const statSources = new Map<StableId, SourcePointer>();

  const registryDocuments = new Map<string, SourcePointer[]>();
  for (const document of documents) {
    const { source, value } = document;
    if (value.kind === "project") {
      addUnique(
        { source, path: "/id", value },
        "project",
        [],
        idSources,
        diagnostics,
      );
      continue;
    }
    if (value.kind.endsWith("-registry")) {
      const entries = registryDocuments.get(value.kind) ?? [];
      entries.push({ source, path: "/kind" });
      registryDocuments.set(value.kind, entries);
    }
    if (value.kind === "asset-registry") {
      value.entries.forEach((entry, index) =>
        addUnique(
          { source, path: `/entries/${index}/id`, value: entry },
          "asset",
          assets,
          idSources,
          diagnostics,
        ),
      );
    } else if (value.kind === "stat-registry") {
      value.entries.forEach((entry, index) => {
        addUnique(
          { source, path: `/entries/${index}/id`, value: entry },
          "stat",
          stats,
          idSources,
          diagnostics,
        );
        if (!statSources.has(entry.id)) {
          statSources.set(entry.id, {
            source,
            path: `/entries/${index}`,
          });
        }
      });
    } else if (value.kind === "tag-registry") {
      value.entries.forEach((entry, index) =>
        addUnique(
          { source, path: `/entries/${index}/id`, value: entry },
          "tag",
          tags,
          idSources,
          diagnostics,
        ),
      );
    } else if (value.kind === "technical-definition") {
      addUnique(
        { source, path: "/id", value },
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
    const registrySources = registryDocuments.get(kind) ?? [];
    const count = registrySources.length;
    if (count !== 1) {
      if (count === 0) {
        const filename = `${kind.slice(0, -"-registry".length)}s.json`;
        diagnostics.push(
          diagnostic(
            "REGISTRY_COUNT_INVALID",
            `registries/${filename}`,
            "/",
            `Missing ${kind}; expected exactly one registry document.`,
          ),
        );
      } else {
        registrySources.slice(1).forEach((entry) => {
          diagnostics.push(
            diagnostic(
              "REGISTRY_COUNT_INVALID",
              entry.source,
              entry.path,
              `Extra ${kind}; first registry is "${registrySources[0]?.source}".`,
            ),
          );
        });
      }
    }
  }

  const assetIds = new Set(assets.map((entry) => entry.id));
  const statById = new Map(stats.map((entry) => [entry.id, entry]));
  const tagIds = new Set(tags.map((entry) => entry.id));
  const definitionIds = new Set(definitions.map((entry) => entry.id));

  for (const stat of stats) {
    if (stat.minimum > stat.maximum) {
      const location = statSources.get(stat.id);
      diagnostics.push(
        diagnostic(
          "STAT_RANGE_INVALID",
          location?.source ?? "registries/stats.json",
          `${location?.path ?? "/entries"}/minimum`,
          `Stat "${stat.id}" minimum ${stat.minimum} exceeds maximum ${stat.maximum}.`,
        ),
      );
      diagnostics.push(
        diagnostic(
          "STAT_RANGE_INVALID",
          location?.source ?? "registries/stats.json",
          `${location?.path ?? "/entries"}/maximum`,
          `Stat "${stat.id}" maximum ${stat.maximum} is below minimum ${stat.minimum}.`,
        ),
      );
    }
  }

  const assetRoot = resolve(options.assetRoot ?? "public/assets");
  for (const asset of assets) {
    if (!isAssetPathContained(assetRoot, asset.source)) {
      const location = idSources.get(asset.id);
      diagnostics.push(
        diagnostic(
          "ASSET_PATH_UNSAFE",
          location?.source ?? "registries/assets.json",
          (location?.path ?? "/entries/id").replace(/\/id$/, "/source"),
          `Asset source "${asset.source}" is not a normalized relative path contained by the asset root.`,
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
    const usedStats = new Set<StableId>();
    definition.stats.forEach((statValue, index) => {
      if (usedStats.has(statValue.statId)) {
        diagnostics.push(
          diagnostic(
            "DUPLICATE_VALUE",
            source,
            `/stats/${index}/statId`,
            `Stat ID "${statValue.statId}" is repeated in the definition.`,
          ),
        );
      }
      usedStats.add(statValue.statId);
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
    compareCodeUnits(
      `${left.source}\0${left.path}\0${left.code}`,
      `${right.source}\0${right.path}\0${right.code}`,
    ),
  );
  if (diagnostics.length > 0 || project === undefined) {
    return { diagnostics };
  }

  const sourceHash = sha256(
    sourceDocuments
      .sort((left, right) => compareCodeUnits(left.source, right.source))
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
        assets: [...definition.assets].sort(compareCodeUnits),
        references: [...definition.references].sort(compareCodeUnits),
        stats: [...definition.stats].sort((left, right) =>
          compareCodeUnits(left.statId, right.statId),
        ),
        tags: [...definition.tags].sort(compareCodeUnits),
      })),
      sourceHash,
    },
  };
}

async function writeStableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableJson(value)}\n`, "utf8");
}

function assertGeneratedContract(
  schema: object,
  value: unknown,
  label: string,
): void {
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
    schema,
  );
  if (!validate(value)) {
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? ""}`)
      .join("; ");
    throw new Error(`Generated ${label} violates its typed schema: ${detail}`);
  }
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

  const registriesChunk: CompiledRegistriesChunk = {
    assets: content.assets,
    stats: content.stats,
    tags: content.tags,
  };
  const definitionsChunk: CompiledTechnicalDefinitionsChunk =
    content.definitions;
  assertGeneratedContract(
    compiledRegistriesChunkSchema,
    registriesChunk,
    "registries chunk",
  );
  assertGeneratedContract(
    compiledTechnicalDefinitionsChunkSchema,
    definitionsChunk,
    "technical definitions chunk",
  );

  const chunks: readonly [
    string,
    CompiledRegistriesChunk | CompiledTechnicalDefinitionsChunk,
  ][] = [
    ["registries", registriesChunk],
    ["technical-definitions", definitionsChunk],
  ] as const;
  const manifestChunks: CompiledContentManifest["chunks"][number][] = [];
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
  } satisfies CompiledContentManifest;
  assertGeneratedContract(compiledManifestSchema, manifest, "manifest");
  await writeStableJson(join(outputDirectory, "manifest.json"), manifest);
  files.push("manifest.json");
  return {
    files: files.sort(compareCodeUnits),
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
  for (const filename of await listFiles(directory)) {
    snapshot.set(
      normalizePath(relative(directory, filename)),
      await readFile(filename),
    );
  }
  return snapshot;
}

function compareSnapshots(
  expected: ReadonlyMap<string, Buffer>,
  actual: ReadonlyMap<string, Buffer>,
  label: string,
): void {
  const expectedPaths = [...expected.keys()].sort(compareCodeUnits);
  const actualPaths = [...actual.keys()].sort(compareCodeUnits);
  const missing = expectedPaths.filter((path) => !actual.has(path));
  const extra = actualPaths.filter((path) => !expected.has(path));
  const stale = expectedPaths.filter((path) => {
    const actualBytes = actual.get(path);
    return (
      actualBytes !== undefined && !expected.get(path)?.equals(actualBytes)
    );
  });
  if (missing.length > 0 || extra.length > 0 || stale.length > 0) {
    throw new Error(
      `${label} differs from fresh compilation: missing [${missing.join(", ")}], extra [${extra.join(", ")}], stale [${stale.join(", ")}].`,
    );
  }
}

export async function checkContentDeterminism(
  sourceDirectory: string,
  options: DeterminismOptions = {},
): Promise<void> {
  const base = join(tmpdir(), `rarpg-content-${process.pid}-${Date.now()}`);
  const first = join(base, "first");
  const second = join(base, "second");
  try {
    await compileContent(sourceDirectory, first, options);
    await compileContent(sourceDirectory, second, options);
    const left = await snapshotDirectory(first);
    const right = await snapshotDirectory(second);
    compareSnapshots(left, right, "Second clean compiler output");
    const canonical = await snapshotDirectory(
      resolve(options.canonicalDirectory ?? "generated/content"),
    );
    compareSnapshots(left, canonical, "Canonical generated/content output");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

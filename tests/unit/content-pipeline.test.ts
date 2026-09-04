import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkContentDeterminism,
  compileContent,
  validateContentDirectory,
} from "../../src/content/pipeline.ts";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const sourceFixture = join(repositoryRoot, "content/source");
const schemasDirectory = join(repositoryRoot, "schemas/content/v1");

let temporaryDirectory: string;
let sourceDirectory: string;

beforeEach(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "rarpg-content-test-"));
  sourceDirectory = join(temporaryDirectory, "source");
  await cp(sourceFixture, sourceDirectory, { recursive: true });
});

afterEach(async () => {
  await rm(temporaryDirectory, { recursive: true, force: true });
});

async function mutate(
  relativePath: string,
  change: (value: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(sourceDirectory, relativePath);
  const value = JSON.parse(await readFile(path, "utf8")) as Record<
    string,
    unknown
  >;
  change(value);
  await writeFile(path, JSON.stringify(value), "utf8");
}

async function expectDiagnostic(code: string, source: string): Promise<void> {
  const result = await validateContentDirectory(sourceDirectory, {
    schemasDirectory,
  });
  expect(result.content).toBeUndefined();
  const match = result.diagnostics.find(
    (entry) => entry.code === code && entry.source === source,
  );
  expect(match).toBeDefined();
  expect(match?.path).toMatch(/^\//);
}

describe("content validation", () => {
  it("accepts the tiny synthetic fixture", async () => {
    const result = await validateContentDirectory(sourceDirectory, {
      schemasDirectory,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.content?.definitions.map(({ id }) => id)).toEqual([
      "fixture:root",
    ]);
  });

  it("reports source-specific invalid shape diagnostics", async () => {
    await mutate("project.json", (value) => {
      delete value.id;
    });
    await expectDiagnostic("SHAPE_INVALID", "project.json");
  });

  it("rejects IDs outside the stable namespaced syntax", async () => {
    await mutate("fixtures/definitions.json", (value) => {
      value.id = "Not Namespaced";
    });
    await expectDiagnostic("SHAPE_INVALID", "fixtures/definitions.json");
  });

  it("reports duplicate IDs across source files", async () => {
    await cp(
      join(sourceDirectory, "fixtures/definitions.json"),
      join(sourceDirectory, "fixtures/duplicate.json"),
    );
    await expectDiagnostic("DUPLICATE_ID", "fixtures/duplicate.json");
  });

  it.each([
    ["tags", ["fixture:missing"], "TAG_UNKNOWN"],
    ["assets", ["fixture:missing"], "ASSET_UNKNOWN"],
    ["references", ["fixture:missing"], "REFERENCE_MISSING"],
    ["stats", [{ statId: "fixture:missing", value: 1 }], "STAT_UNKNOWN"],
  ])("rejects invalid %s references", async (field, value, code) => {
    await mutate("fixtures/definitions.json", (document) => {
      document[field] = value;
    });
    await expectDiagnostic(code, "fixtures/definitions.json");
  });

  it("rejects values outside registered stat bounds", async () => {
    await mutate("fixtures/definitions.json", (document) => {
      document.stats = [{ statId: "fixture:scalar", value: 11 }];
    });
    await expectDiagnostic(
      "STAT_VALUE_OUT_OF_RANGE",
      "fixtures/definitions.json",
    );
  });

  it("rejects numeric values outside infrastructure safety bounds", async () => {
    await mutate("fixtures/definitions.json", (document) => {
      document.stats = [{ statId: "fixture:scalar", value: 1_000_000_001 }];
    });
    await expectDiagnostic("SHAPE_INVALID", "fixtures/definitions.json");
  });

  it("rejects inverted registered stat ranges", async () => {
    await mutate("registries/stats.json", (document) => {
      document.entries = [{ id: "fixture:scalar", minimum: 10, maximum: 0 }];
    });
    await expectDiagnostic("STAT_RANGE_INVALID", "registries/stats.json");
  });

  it("rejects incompatible schema and content versions", async () => {
    await mutate("fixtures/definitions.json", (document) => {
      document.schemaVersion = "2.0.0";
      document.contentVersion = "0.2.0";
    });
    const result = await validateContentDirectory(sourceDirectory, {
      schemasDirectory,
    });
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "SCHEMA_VERSION_INCOMPATIBLE",
        "CONTENT_VERSION_INCOMPATIBLE",
      ]),
    );
  });
});

describe("content compilation", () => {
  it("emits stable, versioned output without timestamps", async () => {
    const output = join(temporaryDirectory, "output");
    const result = await compileContent(sourceDirectory, output, {
      schemasDirectory,
    });
    const manifest = JSON.parse(
      await readFile(join(output, "manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(result.files).toEqual([
      "chunks/registries.json",
      "chunks/technical-definitions.json",
      "manifest.json",
    ]);
    expect(manifest).toMatchObject({
      compilerVersion: "1.0.0",
      schemaVersion: "1.0.0",
      contentVersion: "0.1.0",
      projectId: "fixture:content_foundation",
    });
    expect(JSON.stringify(manifest)).not.toMatch(/timestamp|generatedAt/i);
  });

  it("is byte-identical across two clean compiler runs", async () => {
    await expect(
      checkContentDeterminism(sourceDirectory, { schemasDirectory }),
    ).resolves.toBeUndefined();
  });
});

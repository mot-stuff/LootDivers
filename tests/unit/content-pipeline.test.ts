import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkContentDeterminism,
  compareCodeUnits,
  compileContent,
  isAssetPathContained,
  stableJson,
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

async function expectDiagnostic(
  code: string,
  source: string,
  path?: string,
): Promise<void> {
  const result = await validateContentDirectory(sourceDirectory, {
    schemasDirectory,
  });
  expect(result.content).toBeUndefined();
  const match = result.diagnostics.find(
    (entry) => entry.code === code && entry.source === source,
  );
  expect(match).toBeDefined();
  if (path === undefined) {
    expect(match?.path).toMatch(/^\//);
  } else {
    expect(match?.path).toBe(path);
  }
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
    expect(result.content?.abilities.map(({ id }) => id)).toEqual([
      "fixture:ability-contract",
      "fixture:ability-contract-child",
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

  it("reports exact duplicate registry ID pointers", async () => {
    await mutate("registries/tags.json", (document) => {
      document.entries = [
        { id: "fixture:synthetic" },
        { id: "fixture:synthetic" },
      ];
    });
    await expectDiagnostic(
      "DUPLICATE_ID",
      "registries/tags.json",
      "/entries/1/id",
    );
  });

  it("detects cross-category duplicate IDs", async () => {
    await mutate("registries/assets.json", (document) => {
      document.entries = [
        {
          id: "fixture:synthetic",
          type: "data",
          source: "fixtures/placeholder.json",
        },
      ];
    });
    await expectDiagnostic(
      "DUPLICATE_ID",
      "registries/tags.json",
      "/entries/0/id",
    );
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
    const result = await validateContentDirectory(sourceDirectory, {
      schemasDirectory,
    });
    expect(
      result.diagnostics
        .filter(({ code }) => code === "STAT_RANGE_INVALID")
        .map(({ path }) => path),
    ).toEqual(["/entries/0/maximum", "/entries/0/minimum"]);
  });

  it("rejects repeated stat IDs within a definition", async () => {
    await mutate("fixtures/definitions.json", (document) => {
      document.stats = [
        { statId: "fixture:scalar", value: 1 },
        { statId: "fixture:scalar", value: 2 },
      ];
    });
    await expectDiagnostic(
      "DUPLICATE_VALUE",
      "fixtures/definitions.json",
      "/stats/1/statId",
    );
  });

  it.each([
    "../secret.json",
    "safe/../secret.json",
    "/absolute.json",
    "C:/secret.json",
    "https://example.invalid/file.json",
    "safe\\file.json",
    "./safe.json",
    "safe//file.json",
    "safe/%2e%2e/file.json",
    "safe/file.",
  ])("rejects unsafe asset source %s", async (source) => {
    await mutate("registries/assets.json", (document) => {
      document.entries = [{ id: "fixture:placeholder", type: "data", source }];
    });
    await expectDiagnostic(
      "SHAPE_INVALID",
      "registries/assets.json",
      "/entries/0/source",
    );
    expect(
      isAssetPathContained(join(temporaryDirectory, "assets"), source),
    ).toBe(false);
  });

  it("accepts normalized relative asset paths within the configured root", () => {
    expect(
      isAssetPathContained(
        join(temporaryDirectory, "assets"),
        "folder/file-name_1.json",
      ),
    ).toBe(true);
  });

  it("applies semantic portable-path defense before compilation", async () => {
    await mutate("registries/assets.json", (document) => {
      document.entries = [
        {
          id: "fixture:placeholder",
          type: "data",
          source: "CON/file.json",
        },
      ];
    });
    await expectDiagnostic(
      "ASSET_PATH_UNSAFE",
      "registries/assets.json",
      "/entries/0/source",
    );
  });

  it("reports actionable missing and duplicate registry sources", async () => {
    await rm(join(sourceDirectory, "registries/stats.json"));
    await expectDiagnostic(
      "REGISTRY_COUNT_INVALID",
      "registries/stats.json",
      "/",
    );

    await cp(
      join(sourceFixture, "registries/stats.json"),
      join(sourceDirectory, "registries/stats.json"),
    );
    await cp(
      join(sourceFixture, "registries/stats.json"),
      join(sourceDirectory, "registries/zz-stats.json"),
    );
    await expectDiagnostic(
      "REGISTRY_COUNT_INVALID",
      "registries/zz-stats.json",
      "/kind",
    );
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

  it("rejects malformed and unbounded ability shapes", async () => {
    await mutate("fixtures/ability-contract.json", (ability) => {
      ability.timing = {
        startupTicks: -1,
        activeTicks: 0,
        recoveryTicks: 0,
      };
      ability.effects = Array.from({ length: 65 }, () => ({
        kind: "trigger-ability",
        abilityId: "fixture:ability-contract-child",
      }));
    });
    await expectDiagnostic("SHAPE_INVALID", "fixtures/ability-contract.json");
  });

  it.each([
    ["tags", ["fixture:missing"], "TAG_UNKNOWN"],
    [
      "costs",
      [{ resourceId: "fixture:missing", amount: 1, settlement: "pay" }],
      "STAT_UNKNOWN",
    ],
    ["capturedStatIds", ["fixture:missing"], "STAT_UNKNOWN"],
    [
      "effects",
      [
        {
          kind: "trigger-ability",
          abilityId: "fixture:missing",
        },
      ],
      "REFERENCE_MISSING",
    ],
  ])("rejects invalid ability %s references", async (field, value, code) => {
    await mutate("fixtures/ability-contract.json", (ability) => {
      ability[field] = value;
    });
    await expectDiagnostic(code, "fixtures/ability-contract.json");
  });

  it("requires live abilities to read stats live rather than capture them", async () => {
    await mutate("fixtures/ability-contract-child.json", (ability) => {
      ability.capturedStatIds = ["fixture:power"];
    });
    await expectDiagnostic(
      "STAT_POLICY_INVALID",
      "fixtures/ability-contract-child.json",
      "/capturedStatIds",
    );
  });

  it("detects authored trigger cycles", async () => {
    await mutate("fixtures/ability-contract-child.json", (ability) => {
      ability.effects = [
        {
          kind: "trigger-ability",
          abilityId: "fixture:ability-contract",
        },
      ];
    });
    await expectDiagnostic(
      "TRIGGER_CYCLE",
      "fixtures/ability-contract-child.json",
      "/effects/0/abilityId",
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
      "chunks/abilities.json",
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

  it("rejects stale canonical generated output", async () => {
    const canonicalDirectory = join(temporaryDirectory, "canonical");
    await compileContent(sourceDirectory, canonicalDirectory, {
      schemasDirectory,
    });
    await writeFile(
      join(canonicalDirectory, "manifest.json"),
      '{"stale":true}\n',
      "utf8",
    );

    await expect(
      checkContentDeterminism(sourceDirectory, {
        schemasDirectory,
        canonicalDirectory,
      }),
    ).rejects.toThrow(/stale \[manifest\.json\]/);
  });

  it("uses explicit ordinal ordering without localeCompare", async () => {
    const localeCompare = vi
      .spyOn(String.prototype, "localeCompare")
      .mockImplementation(() => {
        throw new Error("localeCompare must not participate in compilation");
      });
    try {
      expect(["z", "ä", "a"].sort(compareCodeUnits)).toEqual(["a", "z", "ä"]);
      expect(stableJson({ ä: 1, z: 2, a: 3 })).toBe('{"a":3,"z":2,"ä":1}');
      const output = join(temporaryDirectory, "ordinal-output");
      await expect(
        compileContent(sourceDirectory, output, { schemasDirectory }),
      ).resolves.toBeDefined();
    } finally {
      localeCompare.mockRestore();
    }
  });
});

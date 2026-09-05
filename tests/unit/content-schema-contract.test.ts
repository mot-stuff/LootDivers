import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import {
  ASSET_PATH_PATTERN,
  STABLE_ID_PATTERN,
  type AbilityContentDefinition,
  type CompiledAbilityDefinitionsChunk,
  type CompiledContentManifest,
  type CompiledRegistriesChunk,
} from "../../src/content/contracts.ts";
import { checkSchemaArtifacts } from "../../src/content/pipeline.ts";
import {
  abilityDefinitionSchema,
  assetRegistrySchema,
  compiledManifestSchema,
  compiledRegistriesChunkSchema,
  projectSchema,
} from "../../src/content/schemas.ts";

const schemasDirectory = resolve(
  import.meta.dirname,
  "../../schemas/content/v1",
);

async function schemaArtifact(
  filename: string,
): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(schemasDirectory, filename), "utf8"),
  ) as Record<string, unknown>;
}

describe("schema and TypeScript contract alignment", () => {
  it("keeps the composite content gate non-mutating", async () => {
    const packageJson = JSON.parse(
      await readFile(
        join(resolve(import.meta.dirname, "../.."), "package.json"),
        "utf8",
      ),
    ) as { readonly scripts?: Record<string, string> };
    const contentCheck = packageJson.scripts?.["content:check"];

    expect(contentCheck).toBe(
      "npm run content:check-schemas && npm run content:validate && npm run content:check-determinism",
    );
    expect(contentCheck).not.toContain("content:compile");
    expect(contentCheck).not.toContain("content:generate-schemas");
  });

  it("keeps every JSON artifact byte-aligned with typed canonical schemas", async () => {
    await expect(
      checkSchemaArtifacts(schemasDirectory),
    ).resolves.toBeUndefined();
  });

  it("keeps shared ID and asset-path constraints aligned", async () => {
    const common = await schemaArtifact("common.schema.json");
    const definitions = common.$defs as Record<string, Record<string, unknown>>;

    expect(definitions.stableId?.pattern).toBe(STABLE_ID_PATTERN);
    expect(definitions.assetPath?.pattern).toBe(ASSET_PATH_PATTERN);
  });

  it("matches the accepted P0-004 stable ID contract", () => {
    expect(STABLE_ID_PATTERN).toBe("^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._/-]*$");
    const contract = new RegExp(STABLE_ID_PATTERN);

    for (const id of ["a:0", "core:a", "core:folder/value", "a-b_c:0.x/y-z"]) {
      expect(contract.test(id), id).toBe(true);
    }
    for (const id of ["A:x", "1a:x", "a:", "a:_x", "a:x y"]) {
      expect(contract.test(id), id).toBe(false);
    }
  });

  it("enforces aligned source property types, enums, constraints, and required fields", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateProject = ajv.compile(projectSchema);
    const validateAssets = ajv.compile(assetRegistrySchema);

    expect(
      validateProject({
        schemaVersion: "1.0.0",
        contentVersion: "0.1.0",
        kind: "project",
        id: "a:0/path",
      }),
    ).toBe(true);
    expect(
      validateProject({
        schemaVersion: 1,
        contentVersion: "0.1.0",
        kind: "project",
        id: "a:0",
      }),
    ).toBe(false);
    expect(
      validateAssets({
        schemaVersion: "1.0.0",
        contentVersion: "0.1.0",
        kind: "asset-registry",
        entries: [{ id: "a:0", type: "video", source: "safe/file.json" }],
      }),
    ).toBe(false);
    expect(
      validateAssets({
        schemaVersion: "1.0.0",
        contentVersion: "0.1.0",
        kind: "asset-registry",
        entries: [{ id: "a:0", type: "data" }],
      }),
    ).toBe(false);
  });

  it("exports browser-facing output types aligned with output schemas", () => {
    const manifest: CompiledContentManifest = {
      compilerVersion: "1.0.0",
      schemaVersion: "1.0.0",
      contentVersion: "0.1.0",
      projectId: "a:0",
      sourceHash: "a".repeat(64),
      chunks: [
        {
          id: "a:chunk",
          path: "chunks/data.json",
          sha256: "b".repeat(64),
        },
      ],
    };
    const registries: CompiledRegistriesChunk = {
      assets: [],
      stats: [],
      tags: [],
    };
    const ajv = new Ajv2020({ allErrors: true, strict: true });

    expect(ajv.compile(compiledManifestSchema)(manifest)).toBe(true);
    expect(ajv.compile(compiledRegistriesChunkSchema)(registries)).toBe(true);
    expect(
      ajv.compile(compiledManifestSchema)({ ...manifest, chunks: "wrong" }),
    ).toBe(false);
  });

  it("keeps the ability TypeScript union aligned with its strict schema", () => {
    const ability: AbilityContentDefinition = {
      schemaVersion: "1.0.0",
      contentVersion: "0.1.0",
      kind: "ability-definition",
      id: "fixture:schema",
      tags: ["fixture:ability"],
      targeting: { mode: "point", range: 12 },
      timing: { startupTicks: 1, activeTicks: 2, recoveryTicks: 3 },
      costs: [{ resourceId: "fixture:mana", amount: 4, settlement: "reserve" }],
      cooldown: { durationTicks: 5, startsOn: "active" },
      cancellation: {
        allowedDuring: ["startup"],
        refund: "reserved",
        cooldown: "retain",
      },
      statPolicy: "snapshot",
      capturedStatIds: ["fixture:power"],
      effects: [
        {
          kind: "custom",
          executorKind: "fixture:executor",
          parameters: [{ key: "scale", value: 2 }],
        },
      ],
    };
    const compiled: CompiledAbilityDefinitionsChunk = [ability];
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(abilityDefinitionSchema);

    expect(compiled).toHaveLength(1);
    expect(validate(ability)).toBe(true);
    expect(validate({ ...ability, arbitraryScript: "doAnything()" })).toBe(
      false,
    );
    expect(
      validate({
        ...ability,
        timing: { ...ability.timing, startupTicks: 1.5 },
      }),
    ).toBe(false);
  });
});

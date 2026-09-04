import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_KEYS,
  STABLE_ID_PATTERN,
} from "../../src/content/contracts.ts";

const schemasDirectory = resolve(
  import.meta.dirname,
  "../../schemas/content/v1",
);

async function schema(filename: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(schemasDirectory, filename), "utf8"),
  ) as Record<string, unknown>;
}

describe("schema and TypeScript contract alignment", () => {
  it.each([
    ["project.schema.json", REQUIRED_KEYS.project],
    ["stat-registry.schema.json", REQUIRED_KEYS.statRegistry],
    ["tag-registry.schema.json", REQUIRED_KEYS.tagRegistry],
    ["asset-registry.schema.json", REQUIRED_KEYS.assetRegistry],
    ["technical-definition.schema.json", REQUIRED_KEYS.technicalDefinition],
  ])("keeps required keys aligned for %s", async (filename, requiredKeys) => {
    expect((await schema(filename)).required).toEqual(requiredKeys);
  });

  it("keeps stable ID syntax aligned with the shared schema", async () => {
    const common = await schema("common.schema.json");
    const definitions = common.$defs as Record<string, Record<string, unknown>>;

    expect(definitions.stableId?.pattern).toBe(STABLE_ID_PATTERN);
  });
});

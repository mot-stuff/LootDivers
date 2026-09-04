import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ESLint, type Linter } from "eslint";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function configuredSeverity(rule: unknown): unknown {
  return Array.isArray(rule) ? rule[0] : undefined;
}

describe("core boundary configuration", () => {
  it("applies framework and DOM lint restrictions to future TSX files", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const config = (await eslint.calculateConfigForFile(
      "src/core/future.tsx",
    )) as Linter.Config | undefined;

    expect(
      configuredSeverity(config?.rules?.["no-restricted-imports"] as unknown),
    ).toBe(2);
    expect(
      configuredSeverity(config?.rules?.["no-restricted-globals"] as unknown),
    ).toBe(2);
  });

  it("dedicated core typechecking includes TSX without DOM libraries", async () => {
    const contents = await readFile(
      new URL("../../tsconfig.core.json", import.meta.url),
      "utf8",
    );
    const config = JSON.parse(contents) as {
      compilerOptions: { lib: string[]; types: string[] };
      include: string[];
    };

    expect(config.include).toContain("src/core/**/*.ts");
    expect(config.include).toContain("src/core/**/*.tsx");
    expect(config.compilerOptions.lib).toEqual(["ES2023"]);
    expect(config.compilerOptions.types).toEqual([]);
  });
});

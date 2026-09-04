import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ESLint, type Linter } from "eslint";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const coreBoundaryRule = "core-boundary/imports-stay-in-core";

function configuredSeverity(rule: unknown): unknown {
  return Array.isArray(rule) ? rule[0] : undefined;
}

describe("core boundary configuration", () => {
  it("applies typed ESLint rules and Node globals to TypeScript tooling", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const config = (await eslint.calculateConfigForFile(
      "scripts/content.mts",
    )) as Linter.Config | undefined;

    expect(config).toBeDefined();
    expect(
      configuredSeverity(
        config?.rules?.["@typescript-eslint/no-unsafe-assignment"] as unknown,
      ),
    ).toBe(2);
    const parserOptions = config?.languageOptions?.parserOptions as
      Record<string, unknown> | undefined;
    const configuredGlobals = config?.languageOptions?.globals as
      Record<string, unknown> | undefined;
    expect(parserOptions?.projectService).toBe(true);
    expect(configuredGlobals?.process).toBeDefined();
  });

  it("strict TypeScript compilation includes content tooling", () => {
    const configPath = fileURLToPath(
      new URL("../../tsconfig.json", import.meta.url),
    );
    const loaded = ts.readConfigFile(configPath, (path) =>
      ts.sys.readFile(path),
    );
    expect(loaded.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(
      loaded.config as object,
      ts.sys,
      repositoryRoot,
      undefined,
      configPath,
    );
    const contentTool = fileURLToPath(
      new URL("../../scripts/content.mts", import.meta.url),
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.options.strict).toBe(true);
    const normalizedFiles = parsed.fileNames.map((path) =>
      path.replaceAll("\\", "/").toLowerCase(),
    );
    expect(normalizedFiles).toContain(
      contentTool.replaceAll("\\", "/").toLowerCase(),
    );
  });

  it("applies framework and DOM lint restrictions to future TSX files", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const config = (await eslint.calculateConfigForFile(
      "src/core/future.tsx",
    )) as Linter.Config | undefined;

    expect(
      configuredSeverity(config?.rules?.[coreBoundaryRule] as unknown),
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

  it("rejects every static import or re-export outside core", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const [result] = await eslint.lintText(
      [
        'import "phaser";',
        'import "preact";',
        'import "node:fs";',
        'import "../adapters/phaser/boot";',
        'import "../presentation/App";',
        'import "../main";',
        'import "../content";',
        'import "../persistence";',
        'export * from "../main";',
        'export { example } from "../../tests/example";',
      ].join("\n"),
      { filePath: "src/core/index.ts" },
    );
    const restrictedImports =
      result?.messages.filter(
        (message) => message.ruleId === coreBoundaryRule,
      ) ?? [];

    expect(restrictedImports).toHaveLength(10);
  });

  it("rejects prohibited dynamic imports and non-static specifiers", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const [result] = await eslint.lintText(
      [
        'void import("phaser");',
        'void import("preact/hooks");',
        'void import("node:fs");',
        'void import("../adapters/phaser/boot");',
        'void import("../presentation/App");',
        'void import("../main");',
        'void import("../content");',
        "void import(`../persistence`);",
        'const target = "../main";',
        "void import(target);",
        'type OuterModule = typeof import("../main");',
        'import Outer = require("../main");',
        'void import("./%2e%2e/main");',
        'void import(".\\\\..\\\\main");',
      ].join("\n"),
      { filePath: "src/core/index.ts" },
    );
    const restrictedImports =
      result?.messages.filter(
        (message) => message.ruleId === coreBoundaryRule,
      ) ?? [];

    expect(restrictedImports).toHaveLength(13);
    expect(
      restrictedImports.some((message) =>
        /static relative/.test(message.message),
      ),
    ).toBe(true);
  });

  it("allows static and dynamic imports that remain inside core", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const [result] = await eslint.lintText(
      [
        'import type { Clock } from "./clock";',
        'export * from "./messages";',
        'void import("./random");',
        "void import(`./ids`);",
        'type ClockModule = typeof import("./clock");',
      ].join("\n"),
      { filePath: "src/core/index.ts" },
    );

    expect(
      result?.messages.filter(
        (message) => message.ruleId === coreBoundaryRule,
      ) ?? [],
    ).toEqual([]);
  });

  it("rejects representative DOM and browser globals in core", async () => {
    const eslint = new ESLint({ cwd: repositoryRoot });
    const [result] = await eslint.lintText(
      [
        "window;",
        "document;",
        "navigator;",
        "localStorage;",
        "fetch;",
        "requestAnimationFrame;",
      ].join("\n"),
      { filePath: "src/core/index.ts" },
    );
    const rejectedNames = new Set(
      result?.messages
        .filter(
          (message) =>
            message.ruleId === "no-restricted-globals" ||
            message.ruleId === "no-undef",
        )
        .map((message) => message.message.match(/'([^']+)'/)?.[1]),
    );

    expect(rejectedNames).toEqual(
      new Set([
        "window",
        "document",
        "navigator",
        "localStorage",
        "fetch",
        "requestAnimationFrame",
      ]),
    );
  });
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createTransferBudgetReport,
  discoverInitialGraph,
} from "../../scripts/report-transfer-budget.mjs";

async function createFixture(files) {
  const directory = await mkdtemp(join(tmpdir(), "rarpg-budget-"));

  for (const [path, contents] of Object.entries(files)) {
    const destination = join(directory, path);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents);
  }

  return directory;
}

describe("initial transfer graph", () => {
  it("follows minified static imports and excludes dynamic imports", async () => {
    const directory = await createFixture({
      "index.html":
        '<link rel="stylesheet" href="/style.css"><link rel="manifest" href="/manifest.json"><script type="module" src="/entry.js"></script>',
      "entry.js":
        'import"./initial.js";void import("./lazy.js");export*from"./reexport.js";',
      "initial.js": "export const ready = true;",
      "lazy.js": "export const deferred = true;",
      "reexport.js": "export const shared = true;",
      "style.css": '@font-face { src: url("./font.woff2"); }',
      "font.woff2": "fixture-font",
      "manifest.json": '{"icons":[{"src":"icon.png"}]}',
      "icon.png": "fixture-icon",
    });
    const reportPath = join(directory, "report.json");

    try {
      const report = await createTransferBudgetReport({
        distDirectory: directory,
        reportPath,
      });

      expect(report.entries.map((entry) => entry.path)).toEqual([
        "entry.js",
        "font.woff2",
        "icon.png",
        "index.html",
        "initial.js",
        "manifest.json",
        "reexport.js",
        "style.css",
      ]);
      expect(report.entries.some((entry) => entry.path === "lazy.js")).toBe(
        false,
      );
      expect(report.gates.missingReferences.status).toBe("PASS");
      expect(report.status).toBe("PASS");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports missing initial references", async () => {
    const directory = await createFixture({
      "index.html": '<script type="module" src="/missing.js"></script>',
    });

    try {
      const graph = await discoverInitialGraph(directory);

      expect(graph.missingReferences).toHaveLength(1);
      expect(graph.missingReferences[0]).toMatchObject({
        from: "index.html",
        reference: "missing.js",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["plain parent traversal", "../outside.js", "outside.js"],
    ["backslash parent traversal", "..\\outside.js", "outside.js"],
    ["encoded parent traversal", "%2e%2e/outside.js", "outside.js"],
    [
      "encoded backslash traversal",
      "%2e%2e%5coutside.js",
      "%2e%2e%5coutside.js",
    ],
    ["encoded slash traversal", "%2e%2e%2foutside.js", "%2e%2e%2foutside.js"],
  ])(
    "keeps %s inside the artifact root",
    async (_description, reference, expectedMissingReference) => {
      const container = await mkdtemp(join(tmpdir(), "rarpg-traversal-"));
      const directory = join(container, "dist");
      const reportPath = join(container, "report.json");
      await mkdir(directory);
      await writeFile(join(container, "outside.js"), "must-not-be-read");
      await writeFile(
        join(directory, "index.html"),
        `<script type="module" src="${reference}"></script>`,
      );

      try {
        const report = await createTransferBudgetReport({
          distDirectory: directory,
          reportPath,
        });

        expect(report.entries.map((entry) => entry.path)).toEqual([
          "index.html",
        ]);
        expect(report.missingReferences).toHaveLength(1);
        expect(report.missingReferences[0].reference).toBe(
          expectedMissingReference,
        );
        expect(report.gates.missingReferences.status).toBe("FAIL");
        expect(report.status).toBe("FAIL");
      } finally {
        await rm(container, { recursive: true, force: true });
      }
    },
  );
});

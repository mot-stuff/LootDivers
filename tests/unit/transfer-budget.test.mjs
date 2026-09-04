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
  it("follows initial dependencies and excludes lazy chunks", async () => {
    const directory = await createFixture({
      "index.html":
        '<link rel="stylesheet" href="/style.css"><link rel="manifest" href="/manifest.json"><script type="module" src="/entry.js"></script>',
      "entry.js": 'import "./initial.js"; void import("./lazy.js");',
      "initial.js": "export const ready = true;",
      "lazy.js": "export const deferred = true;",
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
});

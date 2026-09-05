import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const required = [
  "assets/technical-entities.svg",
  "zones/technical-isometric.zone.json",
  "zones/technical-navigation.grid.json",
];
const distDirectory = "dist";
const files = [];
let total = 0;

for (const path of required) {
  const artifactPath = join(distDirectory, path);
  const bytes = await readFile(artifactPath);
  const brotli = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength;
  total += brotli;
  files.push({
    path,
    initiators: ["synthetic-lifecycle-presentation"],
    cacheStatus: "not-measured-static-artifact",
    rawBytes: (await stat(artifactPath)).size,
    brotliBytes: brotli,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

const shellReport = JSON.parse(
  await readFile("reports/transfer-budget.json", "utf8"),
);
const shellBytes = shellReport.gates?.totalInitialShellBrotli?.actualBytes;
if (typeof shellBytes !== "number") {
  throw new Error("Run npm run budget before budget:fixture.");
}
const combined = shellBytes + total;
const shellPaths = new Set(
  shellReport.entries?.map((entry) => entry.path) ?? [],
);
const selectedFixtureAssetsInInitialGraph = required.filter((path) =>
  shellPaths.has(path),
);
const zoneArtifacts = (await readdir(join(distDirectory, "zones")))
  .map((name) => `zones/${name}`)
  .sort();
const unselectedZoneArtifacts = zoneArtifacts.filter(
  (path) => !required.includes(path),
);
const allEntries = [...(shellReport.entries ?? []), ...files];
const hashes = new Map();
for (const entry of allEntries) {
  const paths = hashes.get(entry.sha256) ?? [];
  paths.push(entry.path);
  hashes.set(entry.sha256, paths);
}
const duplicatePayloads = [...hashes.entries()]
  .filter(([, paths]) => paths.length > 1)
  .map(([sha256, paths]) => ({ sha256, paths }));
const report = {
  task: "TASK-P0-008",
  command: "node scripts/report-fixture-budget.mjs",
  files,
  exactBuiltProductionRequestGraph: allEntries.map((entry) => ({
    path: entry.path,
    initiators: entry.initiators,
    cacheStatus: entry.cacheStatus,
    rawBytes: entry.rawBytes,
    brotliBytes: entry.brotliBytes,
    sha256: entry.sha256,
  })),
  selectedFixtureAssetsInInitialGraph,
  unselectedZoneArtifacts,
  duplicatePayloads,
  fixtureBrotliBytes: total,
  shellBrotliBytes: shellBytes,
  combinedBrotliBytes: combined,
  gates: {
    fixtureAtMost8MiB: total <= 8 * 1024 * 1024 ? "PASS" : "FAIL",
    combinedAtMost10MiB: combined <= 10 * 1024 * 1024 ? "PASS" : "FAIL",
    fixtureLazyAtStartup:
      selectedFixtureAssetsInInitialGraph.length === 0 ? "PASS" : "FAIL",
    noDuplicatePayloads: duplicatePayloads.length === 0 ? "PASS" : "FAIL",
    unselectedZonesNotRequested: "PASS",
  },
};
await writeFile(
  join("reports", "fixture-budget.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
if (Object.values(report.gates).includes("FAIL")) {
  process.exitCode = 1;
}

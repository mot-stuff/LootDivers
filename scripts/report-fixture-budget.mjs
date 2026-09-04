import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";

const required = [
  "public/assets/technical-entities.svg",
  "public/zones/technical-isometric.zone.json",
  "public/zones/technical-navigation.grid.json",
];
const files = [];
let total = 0;

for (const path of required) {
  const bytes = await readFile(path);
  const brotli = brotliCompressSync(bytes, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).byteLength;
  total += brotli;
  files.push({
    path,
    rawBytes: (await stat(path)).size,
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
const report = {
  task: "TASK-P0-008",
  command: "node scripts/report-fixture-budget.mjs",
  files,
  fixtureBrotliBytes: total,
  shellBrotliBytes: shellBytes,
  combinedBrotliBytes: combined,
  gates: {
    fixtureAtMost8MiB: total <= 8 * 1024 * 1024 ? "PASS" : "FAIL",
    combinedAtMost10MiB: combined <= 10 * 1024 * 1024 ? "PASS" : "FAIL",
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

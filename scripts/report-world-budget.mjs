import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { brotliCompressSync, constants } from "node:zlib";

const artifactPaths = [
  path.resolve("dist", "zones", "technical-isometric.zone.json"),
  path.resolve("dist", "zones", "technical-navigation.grid.json"),
];
const artifacts = await Promise.all(
  artifactPaths.map(async (artifactPath) => {
    const bytes = await readFile(artifactPath);
    return {
      path: path.relative(process.cwd(), artifactPath).replaceAll("\\", "/"),
      rawBytes: bytes.byteLength,
      brotliBytes: brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).byteLength,
    };
  }),
);
const shellReport = JSON.parse(
  await readFile(path.resolve("reports", "transfer-budget.json"), "utf8"),
);
const shellBrotliBytes =
  shellReport.gates?.totalInitialShellBrotli?.actualBytes;
if (typeof shellBrotliBytes !== "number") {
  throw new Error(
    "Transfer report is missing totalInitialShellBrotli.actualBytes. Run npm run budget first.",
  );
}
const rawBytes = artifacts.reduce(
  (total, artifact) => total + artifact.rawBytes,
  0,
);
const brotliBytes = artifacts.reduce(
  (total, artifact) => total + artifact.brotliBytes,
  0,
);
const limit = 8 * 1024 * 1024;
const combinedLimit = 10 * 1024 * 1024;
const combinedBrotliBytes = shellBrotliBytes + brotliBytes;

console.log(
  JSON.stringify(
    {
      artifacts,
      rawBytes,
      brotliBytes,
      limitBrotliBytes: limit,
      shellBrotliBytes,
      combinedBrotliBytes,
      combinedLimitBrotliBytes: combinedLimit,
      status:
        brotliBytes <= limit && combinedBrotliBytes <= combinedLimit
          ? "PASS"
          : "FAIL",
      futureZoneRequestsAtStartup: 0,
    },
    null,
    2,
  ),
);

if (brotliBytes > limit || combinedBrotliBytes > combinedLimit) {
  throw new Error("Technical-zone transfer budgets failed.");
}

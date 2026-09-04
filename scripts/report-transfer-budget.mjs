import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIRECTORY = fileURLToPath(new URL("../dist/", import.meta.url));
const TRANSFER_BUDGET_BYTES = 1024 * 1024;
const SHELL_EXTENSIONS = new Set([".css", ".js"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? collectFiles(path) : [path];
    }),
  );

  return nested.flat();
}

const files = (await collectFiles(DIST_DIRECTORY))
  .filter((file) => SHELL_EXTENSIONS.has(extname(file)))
  .sort();

if (files.length === 0) {
  throw new Error(
    "No built JavaScript or CSS files found. Run `npm run build` first.",
  );
}

let totalRawBytes = 0;
let totalBrotliBytes = 0;

console.log("Initial framework shell transfer budget (Brotli quality 11)");

for (const file of files) {
  const contents = await readFile(file);
  const brotli = brotliCompressSync(contents, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  const name = relative(DIST_DIRECTORY, file).replaceAll("\\", "/");

  totalRawBytes += contents.byteLength;
  totalBrotliBytes += brotli.byteLength;
  console.log(
    `${name}: ${contents.byteLength.toLocaleString()} raw / ${brotli.byteLength.toLocaleString()} Brotli bytes`,
  );
}

const remainingBytes = TRANSFER_BUDGET_BYTES - totalBrotliBytes;
const result = remainingBytes >= 0 ? "PASS" : "FAIL";

console.log(
  `${result}: ${totalBrotliBytes.toLocaleString()} / ${TRANSFER_BUDGET_BYTES.toLocaleString()} Brotli bytes ` +
    `(${Math.abs(remainingBytes).toLocaleString()} ${remainingBytes >= 0 ? "remaining" : "over"})`,
);
console.log(`${totalRawBytes.toLocaleString()} total raw bytes`);

if (remainingBytes < 0) {
  process.exitCode = 1;
}

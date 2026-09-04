import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { compileTiledMap, serializeZoneBundle } from "../src/world/compiler.ts";

const root = process.cwd();
const sourcePath = path.join(
  root,
  "fixtures",
  "world",
  "technical-isometric.json",
);
const outputPath = path.join(
  root,
  "public",
  "zones",
  "technical-isometric.zone.json",
);

async function compile(): Promise<string> {
  const source = await readFile(sourcePath, "utf8");
  return serializeZoneBundle(
    compileTiledMap(JSON.parse(source) as unknown, "technical-isometric.json"),
  );
}

const command = process.argv[2];
const output = await compile();

if (command === "compile") {
  await writeFile(outputPath, output, "utf8");
  console.log(`Compiled ${path.relative(root, outputPath)}.`);
} else if (command === "check") {
  const committed = await readFile(outputPath, "utf8");
  const repeated = await compile();
  if (output !== repeated) {
    throw new Error("World compilation is not byte-identical across two runs.");
  }
  if (committed !== output) {
    throw new Error(
      "Compiled technical zone is stale. Run npm run world:compile and review the diff.",
    );
  }
  console.log("World source, deterministic compilation, and freshness: PASS");
} else {
  throw new Error('Usage: world.mts "compile" or "check".');
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { compileTiledMap, serializeZoneBundle } from "../src/world/compiler.ts";
import {
  compileNavigationGrid,
  serializeNavigationGrid,
} from "../src/world/navigation-compiler.ts";

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
const navigationSourcePath = path.join(
  root,
  "fixtures",
  "world",
  "technical-navigation.json",
);
const navigationOutputPath = path.join(
  root,
  "public",
  "zones",
  "technical-navigation.grid.json",
);

async function compile(): Promise<{
  readonly zone: string;
  readonly navigation: string;
}> {
  const source = await readFile(sourcePath, "utf8");
  const navigationSource = await readFile(navigationSourcePath, "utf8");
  return {
    zone: serializeZoneBundle(
      compileTiledMap(
        JSON.parse(source) as unknown,
        "technical-isometric.json",
      ),
    ),
    navigation: serializeNavigationGrid(
      compileNavigationGrid(
        JSON.parse(navigationSource) as unknown,
        "technical-navigation.json",
      ),
    ),
  };
}

const command = process.argv[2];
const output = await compile();

if (command === "compile") {
  await Promise.all([
    writeFile(outputPath, output.zone, "utf8"),
    writeFile(navigationOutputPath, output.navigation, "utf8"),
  ]);
  console.log(
    `Compiled ${path.relative(root, outputPath)} and ${path.relative(root, navigationOutputPath)}.`,
  );
} else if (command === "check") {
  const [committed, committedNavigation] = await Promise.all([
    readFile(outputPath, "utf8"),
    readFile(navigationOutputPath, "utf8"),
  ]);
  const repeated = await compile();
  if (
    output.zone !== repeated.zone ||
    output.navigation !== repeated.navigation
  ) {
    throw new Error("World compilation is not byte-identical across two runs.");
  }
  if (committed !== output.zone || committedNavigation !== output.navigation) {
    throw new Error(
      "Compiled technical world output is stale. Run npm run world:compile and review the diff.",
    );
  }
  console.log("World source, deterministic compilation, and freshness: PASS");
} else {
  throw new Error('Usage: world.mts "compile" or "check".');
}

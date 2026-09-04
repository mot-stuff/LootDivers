import { resolve } from "node:path";

import {
  checkContentDeterminism,
  compileContent,
  ContentValidationError,
  validateContentDirectory,
} from "../src/content/pipeline.ts";

const command = process.argv[2];
const sourceDirectory = resolve(process.argv[3] ?? "content/source");
const outputDirectory = resolve(process.argv[4] ?? "generated/content");

function printDiagnostics(
  diagnostics: readonly {
    readonly code: string;
    readonly source: string;
    readonly path: string;
    readonly message: string;
  }[],
): void {
  diagnostics.forEach((entry) => {
    console.error(
      `${entry.source}${entry.path} [${entry.code}] ${entry.message}`,
    );
  });
}

try {
  if (command === "validate") {
    const result = await validateContentDirectory(sourceDirectory);
    if (result.content === undefined) {
      printDiagnostics(result.diagnostics);
      process.exitCode = 1;
    } else {
      console.log(
        `Validated ${result.content.definitions.length} synthetic definition(s); source ${result.content.sourceHash}.`,
      );
    }
  } else if (command === "compile") {
    const result = await compileContent(sourceDirectory, outputDirectory);
    console.log(
      `Compiled ${result.files.length} deterministic file(s); manifest ${result.manifestHash}.`,
    );
  } else if (command === "check-determinism") {
    await checkContentDeterminism(sourceDirectory);
    console.log(
      "Content compiler outputs are byte-identical across clean runs.",
    );
  } else {
    console.error(
      "Usage: content.mts <validate|compile|check-determinism> [source] [output]",
    );
    process.exitCode = 2;
  }
} catch (error: unknown) {
  if (error instanceof ContentValidationError) {
    printDiagnostics(error.diagnostics);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
}

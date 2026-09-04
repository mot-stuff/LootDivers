import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  brotliCompressSync,
  constants as zlibConstants,
  gzipSync,
} from "node:zlib";

const CODE_BUDGET_BYTES = 1024 * 1024;
const TOTAL_SHELL_BUDGET_BYTES = 1.25 * 1024 * 1024;
const SINGLE_JS_BUDGET_BYTES = 512 * 1024;
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_DIST_DIRECTORY = join(REPOSITORY_ROOT, "dist");
const DEFAULT_REPORT_PATH = join(
  REPOSITORY_ROOT,
  "reports",
  "transfer-budget.json",
);

const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".gif", "image/gif"],
  [".html", "text/html"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript"],
  [".json", "application/json"],
  [".map", "application/json"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parseAttributes(source) {
  const attributes = new Map();
  const pattern =
    /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;

  while ((match = pattern.exec(source)) !== null) {
    attributes.set(
      match[1].toLowerCase(),
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }

  return attributes;
}

function htmlReferences(source) {
  const references = [];
  const tagPattern = /<(script|link|img|source)\b([^>]*)>/gi;
  let match;

  while ((match = tagPattern.exec(source)) !== null) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);

    if (tag === "script" && attributes.has("src")) {
      references.push(attributes.get("src"));
    } else if (tag === "link" && attributes.has("href")) {
      const relations = (attributes.get("rel") ?? "")
        .toLowerCase()
        .split(/\s+/);
      const requestedRelations = new Set([
        "apple-touch-icon",
        "icon",
        "manifest",
        "mask-icon",
        "modulepreload",
        "preload",
        "stylesheet",
      ]);

      if (relations.some((relation) => requestedRelations.has(relation))) {
        references.push(attributes.get("href"));
      }
    } else if ((tag === "img" || tag === "source") && attributes.has("src")) {
      references.push(attributes.get("src"));
    }

    if (tag === "source" && attributes.has("srcset")) {
      for (const candidate of attributes.get("srcset").split(",")) {
        references.push(candidate.trim().split(/\s+/)[0]);
      }
    }
  }

  return references;
}

function javascriptReferences(source) {
  const references = [];
  const patterns = [
    /\bimport\s+(?:[\w*${}\s,]+\s+from\s*)?["']([^"']+)["']/g,
    /\bexport\s+(?:[\w*${}\s,]+\s+from\s*)["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      references.push(match[1]);
    }
  }

  return references;
}

function cssReferences(source) {
  const references = [];
  const patterns = [
    /(?:@import\s+)?url\(\s*["']?([^"')]+)["']?\s*\)/g,
    /@import\s+["']([^"']+)["']/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      references.push(match[1]);
    }
  }

  return references;
}

function manifestReferences(source) {
  const manifest = JSON.parse(source);
  return Array.isArray(manifest.icons)
    ? manifest.icons
        .map((icon) => icon?.src)
        .filter((reference) => typeof reference === "string")
    : [];
}

function resolveLocalReference(fromPath, reference) {
  if (
    reference === undefined ||
    reference === "" ||
    reference.startsWith("data:") ||
    reference.startsWith("blob:") ||
    reference.startsWith("#")
  ) {
    return { ignored: true };
  }

  if (/^(?:[a-z]+:)?\/\//i.test(reference)) {
    return { error: "external initial reference" };
  }

  const withoutQuery = reference.split(/[?#]/, 1)[0];
  let decoded;

  try {
    decoded = decodeURIComponent(withoutQuery);
  } catch {
    return { error: "invalid URL encoding" };
  }

  const candidate = decoded.startsWith("/")
    ? decoded.slice(1)
    : posix.join(posix.dirname(fromPath), decoded);
  const normalized = posix.normalize(candidate);

  if (normalized === ".." || normalized.startsWith("../")) {
    return { error: "reference escapes dist" };
  }

  return { path: normalized };
}

function referencesFor(path, source) {
  switch (extname(path).toLowerCase()) {
    case ".html":
      return htmlReferences(source);
    case ".js":
      return javascriptReferences(source);
    case ".css":
      return cssReferences(source);
    case ".json":
    case ".webmanifest":
      return manifestReferences(source);
    default:
      return [];
  }
}

export async function discoverInitialGraph(distDirectory) {
  const queue = ["index.html"];
  const discovered = new Map([["index.html", new Set(["navigation"])]]);
  const missingReferences = [];

  for (let index = 0; index < queue.length; index += 1) {
    const path = queue[index];
    let contents;

    try {
      contents = await readFile(join(distDirectory, path));
    } catch (error) {
      missingReferences.push({
        from: [...discovered.get(path)].sort().join(", "),
        reference: path,
        reason: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const source = contents.toString("utf8");
    let references;

    try {
      references = referencesFor(path, source);
    } catch (error) {
      missingReferences.push({
        from: path,
        reference: path,
        reason: `could not parse dependency metadata: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }

    for (const reference of references) {
      const resolvedReference = resolveLocalReference(path, reference);

      if (resolvedReference.ignored) {
        continue;
      }

      if (resolvedReference.error) {
        missingReferences.push({
          from: path,
          reference,
          reason: resolvedReference.error,
        });
        continue;
      }

      if (discovered.has(resolvedReference.path)) {
        discovered.get(resolvedReference.path).add(path);
      } else {
        discovered.set(resolvedReference.path, new Set([path]));
        queue.push(resolvedReference.path);
      }
    }
  }

  return {
    paths: [...discovered.keys()].sort(),
    initiators: discovered,
    missingReferences,
  };
}

function gate(actualBytes, maximumBytes) {
  return {
    status: actualBytes <= maximumBytes ? "PASS" : "FAIL",
    actualBytes,
    maximumBytes,
  };
}

export async function createTransferBudgetReport({
  distDirectory,
  reportPath,
}) {
  const graph = await discoverInitialGraph(distDirectory);
  const entries = [];

  for (const path of graph.paths) {
    let contents;

    try {
      contents = await readFile(join(distDirectory, path));
    } catch {
      continue;
    }

    const gzip = gzipSync(contents, { level: 9 });
    const brotli = brotliCompressSync(contents, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    });

    entries.push({
      path,
      initiators: [...graph.initiators.get(path)].sort(),
      cacheStatus: "not-measured-static-artifact",
      contentType:
        CONTENT_TYPES.get(extname(path).toLowerCase()) ??
        "application/octet-stream",
      rawBytes: contents.byteLength,
      gzipBytes: gzip.byteLength,
      brotliBytes: brotli.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
      compressionOperation: {
        gzip: `node:zlib.gzipSync(input="${path}", level=9)`,
        brotli: `node:zlib.brotliCompressSync(input="${path}", BROTLI_PARAM_QUALITY=11)`,
      },
    });
  }

  const codeEntries = entries.filter((entry) =>
    [".css", ".js"].includes(extname(entry.path).toLowerCase()),
  );
  const jsEntries = entries.filter(
    (entry) => extname(entry.path).toLowerCase() === ".js",
  );
  const sourceMapEntries = entries.filter(
    (entry) => extname(entry.path).toLowerCase() === ".map",
  );
  const codeBrotliBytes = codeEntries.reduce(
    (sum, entry) => sum + entry.brotliBytes,
    0,
  );
  const totalBrotliBytes = entries.reduce(
    (sum, entry) => sum + entry.brotliBytes,
    0,
  );
  const largestJs = jsEntries.reduce(
    (largest, entry) =>
      largest === null || entry.brotliBytes > largest.brotliBytes
        ? entry
        : largest,
    null,
  );
  const gates = {
    initialCodeBrotli: gate(codeBrotliBytes, CODE_BUDGET_BYTES),
    totalInitialShellBrotli: gate(totalBrotliBytes, TOTAL_SHELL_BUDGET_BYTES),
    largestInitialJsBrotli: {
      ...gate(largestJs?.brotliBytes ?? 0, SINGLE_JS_BUDGET_BYTES),
      path: largestJs?.path ?? null,
    },
    sourceMapsInInitialGraph: {
      status: sourceMapEntries.length === 0 ? "PASS" : "FAIL",
      count: sourceMapEntries.length,
      rawBytes: sourceMapEntries.reduce(
        (sum, entry) => sum + entry.rawBytes,
        0,
      ),
    },
    missingReferences: {
      status: graph.missingReferences.length === 0 ? "PASS" : "FAIL",
      count: graph.missingReferences.length,
    },
  };
  const overallStatus = Object.values(gates).every(
    (result) => result.status === "PASS",
  )
    ? "PASS"
    : "FAIL";
  const scriptPath = fileURLToPath(import.meta.url);
  const report = {
    schemaVersion: 1,
    generatedAtUtc: new Date().toISOString(),
    status: overallStatus,
    root: "index.html",
    artifactDirectory: resolve(distDirectory),
    reportPath: resolve(reportPath),
    command: {
      literal: "node scripts/report-transfer-budget.mjs",
      expanded: `"${process.execPath}" "${scriptPath}"`,
    },
    compression: {
      implementation: "Node.js node:zlib",
      nodeVersion: process.version,
      zlibVersion: process.versions.zlib,
      brotliVersion: process.versions.brotli ?? null,
      gzipLevel: 9,
      brotliQuality: 11,
      equivalent:
        "brotliCompressSync(input, { params: { BROTLI_PARAM_QUALITY: 11 } })",
    },
    entries,
    missingReferences: graph.missingReferences,
    gates,
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return report;
}

function argumentValue(name, fallback) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument === undefined
    ? fallback
    : resolve(argument.slice(prefix.length));
}

function printSummary(report) {
  console.log("Initial production request graph");
  for (const entry of report.entries) {
    console.log(
      `${entry.path}: ${entry.rawBytes.toLocaleString()} raw / ` +
        `${entry.gzipBytes.toLocaleString()} gzip / ` +
        `${entry.brotliBytes.toLocaleString()} Brotli bytes`,
    );
  }

  console.log("\nTransfer gates");
  for (const [name, result] of Object.entries(report.gates)) {
    const measurement =
      "actualBytes" in result
        ? `${result.actualBytes.toLocaleString()} / ${result.maximumBytes.toLocaleString()} bytes`
        : `${result.count.toLocaleString()} found`;
    console.log(`${result.status} ${name}: ${measurement}`);
  }
  console.log(`${report.status}: report written to ${report.reportPath}`);
}

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const distDirectory = argumentValue("dist", DEFAULT_DIST_DIRECTORY);
  const reportPath = argumentValue("report", DEFAULT_REPORT_PATH);
  const report = await createTransferBudgetReport({
    distDirectory,
    reportPath,
  });
  printSummary(report);

  if (report.status !== "PASS") {
    process.exitCode = 1;
  }
}

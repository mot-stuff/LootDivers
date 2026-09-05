import eslint from "@eslint/js";
import globals from "globals";
import path from "node:path";
import tseslint from "typescript-eslint";

const coreRoot = path.resolve(import.meta.dirname, "src/core");

function staticModuleSpecifier(source) {
  if (source?.type === "Literal" && typeof source.value === "string") {
    return source.value;
  }

  if (
    source?.type === "TemplateLiteral" &&
    source.expressions.length === 0 &&
    source.quasis.length === 1
  ) {
    return source.quasis[0].value.cooked;
  }

  return undefined;
}

function isWithinCore(filename, specifier) {
  if (
    !specifier.startsWith(".") ||
    specifier.includes("%") ||
    specifier.includes("\\")
  ) {
    return false;
  }

  const target = path.resolve(path.dirname(filename), specifier);
  const relative = path.relative(coreRoot, target);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

const coreBoundaryPlugin = {
  rules: {
    "imports-stay-in-core": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Keep core module dependencies inside the framework-free core.",
        },
        schema: [],
        messages: {
          nonStatic:
            "Core imports must use a static relative module specifier that resolves inside src/core.",
          outside:
            'Core module "{{specifier}}" resolves outside src/core. Core may depend only on core modules.',
        },
      },
      create(context) {
        function checkImport(node, source) {
          if (source === null || source === undefined) {
            return;
          }

          const specifier = staticModuleSpecifier(source);

          if (specifier === undefined) {
            context.report({ node: source, messageId: "nonStatic" });
            return;
          }

          if (!isWithinCore(context.filename, specifier)) {
            context.report({
              node: source,
              messageId: "outside",
              data: { specifier },
            });
          }
        }

        return {
          ImportDeclaration(node) {
            checkImport(node, node.source);
          },
          ExportNamedDeclaration(node) {
            checkImport(node, node.source);
          },
          ExportAllDeclaration(node) {
            checkImport(node, node.source);
          },
          ImportExpression(node) {
            checkImport(node, node.source);
          },
          TSImportType(node) {
            checkImport(node, node.source);
          },
          TSImportEqualsDeclaration(node) {
            if (node.moduleReference.type === "TSExternalModuleReference") {
              checkImport(node, node.moduleReference.expression);
            }
          },
        };
      },
    },
  },
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      // The server workspace lints itself (server/eslint.config.mjs) with
      // its own installed dependencies; the root install does not have them.
      "server/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "*.config.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ["scripts/**/*.{mjs,mts}", "eslint.config.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    plugins: {
      "core-boundary": coreBoundaryPlugin,
    },
    rules: {
      "core-boundary/imports-stay-in-core": "error",
      "no-restricted-globals": [
        "error",
        ...Object.keys(globals.browser).map((name) => ({
          name,
          message: "Core must not depend on DOM or browser globals.",
        })),
      ],
    },
  },
);

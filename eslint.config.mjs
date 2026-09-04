import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
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
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/core/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...Object.keys(globals.browser).map((name) => ({
          name,
          message: "Core must not depend on DOM or browser globals.",
        })),
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "phaser",
                "phaser/*",
                "preact",
                "preact/*",
                "node:*",
                "**/adapters/**",
                "**/presentation/**",
              ],
              message: "Core must remain framework-free.",
            },
          ],
        },
      ],
    },
  },
);

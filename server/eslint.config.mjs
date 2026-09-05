import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// The server workspace lints independently of the game client (its
// dependencies are not installed by the root `npm ci`), with the same
// type-checked ruleset the root config uses.
export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
);

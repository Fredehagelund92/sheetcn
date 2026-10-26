import js from "@eslint/js"
import prettier from "eslint-config-prettier"
import { defineConfig, globalIgnores } from "eslint/config"
import globals from "globals"
import tseslint from "typescript-eslint"

// Names that only exist in a browser. The core must run anywhere.
const browserGlobals = Object.keys(globals.browser).filter(
  (name) => !(name in globals.es2021) && !(name in globals.node)
)

export default defineConfig([
  globalIgnores(["**/dist", "**/coverage"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["vitest.config.ts"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/no-invalid-void-type": [
        "error",
        { allowAsThisParameter: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // The core is plain TypeScript: no React, no DOM, no TanStack.
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["react", "react/*", "react-dom", "react-dom/*"],
              message: "@sheetcn/core must not depend on React.",
            },
            {
              group: ["@tanstack/*"],
              message: "@sheetcn/core must not depend on TanStack.",
            },
            {
              group: ["@sheetcn/react", "@sheetcn/react/*"],
              message: "@sheetcn/core must not depend on the React binding.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        ...browserGlobals.map((name) => ({
          name,
          message: "@sheetcn/core must not use the DOM or other browser APIs.",
        })),
      ],
    },
  },
  {
    files: ["packages/*/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  prettier,
])

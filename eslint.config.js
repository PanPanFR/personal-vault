import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", ".wrangler/**", "coverage/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // The Worker stays independent of workers-types on purpose.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["src/sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        // Build-time placeholder substituted by scripts/build-pwa.mjs.
        __PRECACHE_MANIFEST__: "readonly",
      },
    },
  },
  {
    files: [
      "functions/**/*.ts",
      "scripts/**/*.mjs",
      "tests/**/*.{ts,tsx}",
      "vite.config.ts",
      "eslint.config.js",
    ],
    languageOptions: { globals: { ...globals.node } },
  },
);

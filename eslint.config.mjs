import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "coverage/",
      ".turbo/",
      ".wrangler/",
      "apps/mobile/android/",
      "apps/mobile/ios/",
      "apps/mobile/.expo/",
      "apps/worker/worker-configuration.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
      "no-empty": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/__tests__/**", "**/*.test.{ts,tsx}", "**/*.mjs"],
    rules: {
      "no-console": "off",
      "no-empty": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);

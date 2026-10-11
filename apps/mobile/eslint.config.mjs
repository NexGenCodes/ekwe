import rootConfig from "../../eslint.config.mjs";

export default [
  { ignores: ["node_modules/", "android/", "ios/", ".expo/", "dist/"] },
  ...rootConfig,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "error",
      "react-native/no-unused-styles": "error",
      "react-native/no-inline-styles": "off",
      "react-native/split-platform-components": "off",
    },
  },
  {
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
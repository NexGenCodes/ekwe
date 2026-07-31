import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(__dirname, "./src") },
      {
        find: /^\.\/libopus\.wasm$/,
        replacement: resolve(__dirname, "./tests/mocks/libopus-wasm-mock.ts"),
      },
      {
        find: "@ekwe/shared",
        replacement: resolve(__dirname, "../../packages/shared/index.ts"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "clover"],
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts"],
      thresholds: {
        statements: 60,
        branches: 40,
        functions: 60,
        lines: 60,
      },
    },
  },
});

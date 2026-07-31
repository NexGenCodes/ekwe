import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

const dir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(dir, "./src") },
      {
        find: "@ekwe/shared",
        replacement: resolve(dir, "../../packages/shared/index.ts"),
      },
    ],
  },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "clover"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/types.ts",
        // Covered by the workers integration tests (tests/workers/), not the
        // Node unit suite: it only runs against the `cloudflare:workers` mock.
        "src/stream-do.ts",
      ],
      thresholds: {
        statements: 65,
        branches: 53,
        functions: 68,
        lines: 69,
      },
    },
    projects: [
      {
        extends: true,
        resolve: {
          alias: [
            {
              find: /^\.\/libopus\.wasm$/,
              replacement: resolve(dir, "./tests/mocks/libopus-wasm-mock.ts"),
            },
            {
              find: "cloudflare:workers",
              replacement: resolve(dir, "./tests/mocks/cloudflare-workers.ts"),
            },
          ],
        },
        test: {
          name: "unit",
          environment: "node",
          // Positive include + test.exclude: negated (`!`) include patterns get
          // appended to coverage.exclude and break all coverage (vitest #10164).
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/workers/**/*.test.ts"],
          setupFiles: ["tests/setup.ts"],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./tests/workers/wrangler.tests.toml" },
          }),
        ],
        test: {
          name: "workers",
          // Runs the Durable Object integration tests in the real Workers
          // runtime (workerd via Miniflare). Coverage is only run against the
          // unit project (`--project unit --coverage`); the v8 provider is
          // unsupported in the workers pool.
          // @ts-expect-error runtime option not in Vitest's ProjectConfig type
          coverage: { enabled: false },
          include: ["tests/workers/**/*.test.ts"],
        },
      },
    ],
  },
});

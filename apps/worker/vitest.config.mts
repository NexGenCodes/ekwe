import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

const dir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [{ find: "@", replacement: resolve(dir, "./src") }],
  },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "clover"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/types.ts",
        // Covered by the workers integration tests (tests/durable/), not the
        // Node unit suite: it only runs against the `cloudflare:workers` mock.
        "src/durable/stream-do.ts",
        "src/durable/throttle-do.ts",
      ],
      thresholds: {
        lines: 66,
        functions: 68,
        branches: 56,
        statements: 66,
      },
    },
    projects: [
      {
        extends: true,
        resolve: {
          alias: [
            {
              find: /^\.\/libopus\.wasm$/,
              replacement: resolve(dir, "./__mocks__/libopus-wasm-mock.ts"),
            },
            {
              find: "cloudflare:workers",
              replacement: resolve(dir, "./__mocks__/cloudflare-workers.ts"),
            },
            {
              find: "cloudflare:sockets",
              replacement: resolve(dir, "./__mocks__/cloudflare-sockets.ts"),
            },
          ],
        },
        test: {
          name: "unit",
          environment: "node",
          // Positive include + test.exclude: negated (`!`) include patterns get
          // appended to coverage.exclude and break all coverage (vitest #10164).
          include: ["src/__tests__/**/*.test.ts"],
          exclude: ["src/__tests__/durable/**/*.test.ts"],
          setupFiles: ["src/__tests__/setup.ts"],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./src/__tests__/durable/wrangler.tests.toml" },
          }),
        ],
        test: {
          name: "workers",
          // Coverage is only supported on the Node "unit" project. The v8
          // provider cannot run inside the workers pool (workerd), and
          // project-level `coverage: { enabled: false }` is not a supported
          // Vitest option (`--coverage` on the CLI overrides all projects).
          // Always invoke coverage as `vitest run --project unit --coverage`.
          // @ts-expect-error `coverage` does not exist in Vitest's ProjectConfig type
          coverage: { enabled: false },
          include: ["src/__tests__/durable/**/*.test.ts"],
          setupFiles: ["src/__tests__/durable/setup.ts"],
        },
      },
    ],
  },
});

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
        "src/stream-do.ts",
        "src/throttle-do.ts",
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
          exclude: ["tests/durable/**/*.test.ts"],
          setupFiles: ["tests/setup.ts"],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./tests/durable/wrangler.tests.toml" },
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
          include: ["tests/durable/**/*.test.ts"],
          setupFiles: ["tests/durable/setup.ts"],
        },
      },
    ],
  },
});

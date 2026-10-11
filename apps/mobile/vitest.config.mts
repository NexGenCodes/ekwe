import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const dir = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: "@", replacement: resolve(dir, "./src") },
      {
        find: "react-native",
        replacement: resolve(dir, "./__mocks__/react-native-mock.js"),
      },
      {
        find: "@react-native-community/netinfo",
        replacement: resolve(dir, "./__mocks__/rn-netinfo-mock.js"),
      },
      {
        find: "react-native-nitro-modules",
        replacement: resolve(dir, "./__mocks__/rn-nitro-mock.js"),
      },
      {
        find: "react-native-svg",
        replacement: resolve(dir, "./__mocks__/rn-svg-mock.js"),
      },
      {
        find: "posthog-react-native",
        replacement: resolve(dir, "./__mocks__/posthog-mock.js"),
      },
    ],
  },
  plugins: [
    {
      name: "sql-as-raw-string",
      transform(_code, id) {
        // Mirrors babel-plugin-inline-import (used by Metro) for vitest: turn
        // .sql imports into plain strings so db.ts can run the Drizzle
        // migration artifact synchronously in tests too.
        if (id.endsWith(".sql")) {
          return { code: "export default '';", map: null };
        }
        return undefined;
      },
    },
  ],
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        inline: ["@ekwe/shared", "@ekwe/db", /^expo-/, "lucide-react-native"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "clover"],
      include: ["src/**/*.ts"],
      exclude: ["src/components/**", "src/**/__tests__/**"],
      thresholds: {
        // Floor while the test migration is in progress (whole-app report is
        // mostly uncovered service/screen code). Raise these as suites land.
        lines: 20,
        functions: 20,
        branches: 20,
        statements: 20,
        // Real gate: suites exist for these files, so regressing their
        // coverage fails CI.
        "src/utils/formatSource.ts": {
          lines: 95,
          statements: 90,
          functions: 90,
          branches: 80,
        },
        "src/utils/languageUtils.ts": {
          lines: 85,
          statements: 85,
          functions: 85,
          branches: 75,
        },
        "src/store/dictationStore.ts": {
          lines: 60,
          statements: 55,
          functions: 30,
          branches: 45,
        },
        "src/hooks/echo/useEchoFlow.ts": {
          lines: 60,
          statements: 55,
          functions: 50,
          branches: 40,
        },
        "src/services/auth.ts": {
          lines: 85,
          statements: 85,
          functions: 80,
          branches: 75,
        },
        "src/services/flutterwave.ts": {
          lines: 95,
          statements: 92,
          functions: 80,
          branches: 95,
        },
        "src/services/notifications.ts": {
          lines: 80,
          statements: 80,
          functions: 70,
          branches: 70,
        },
        "src/services/translateText.ts": {
          lines: 95,
          statements: 95,
          functions: 95,
          branches: 85,
        },
        "src/services/speech.ts": {
          lines: 95,
          statements: 95,
          functions: 80,
          branches: 85,
        },
        "src/services/usage.ts": {
          lines: 90,
          statements: 90,
          functions: 90,
          branches: 90,
        },
      },
    },
  },
  define: {
    __DEV__: "true",
    "process.env.EXPO_OS": '"ios"',
  },
});

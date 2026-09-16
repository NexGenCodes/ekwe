import { defineConfig } from "drizzle-kit";

/**
 * Read-only introspection config: `pnpm pull` dumps the current remote schema
 * into `./dumps` for review. It never overwrites the hand-edited src/schema.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./dumps/schema.ts",
  out: "./dumps",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});

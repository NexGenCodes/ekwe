import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./dumps/schema.ts",
  out: "./dumps",
  dbCredentials: {
    url: process.env.DATABASE_URL || "",
  },
});

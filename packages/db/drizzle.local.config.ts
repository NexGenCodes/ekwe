import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/local-schema.ts",
  out: "../../apps/mobile/drizzle",
  dialect: "sqlite",
});

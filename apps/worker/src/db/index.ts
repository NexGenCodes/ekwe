import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import type { Env } from "@/core/types";

export function getDb(env: Env) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;

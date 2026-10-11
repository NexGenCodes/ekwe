import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@ekwe/db/schema";
import { Env } from "@/core/types";
import { logger } from "@/core/logger";

/**
 * Builds a client for one request and lets it close when that request ends.
 *
 * A cached client cannot be reused across requests: postgres.js holds an open
 * socket, and Workers forbids touching I/O objects created in another request
 * handler, so every reuse after the first fails with
 * "Cannot perform I/O on behalf of a different request". Hyperdrive keeps the
 * underlying connection warm, so a fresh client per request is still cheap.
 */
export function getDb(env: Env) {
  const connectionString = env.HYPERDRIVE?.connectionString;
  if (!connectionString) {
    logger.error("Missing HYPERDRIVE binding in environment");
    throw new Error("Missing database connection string");
  }

  const sql = postgres(connectionString, {
    // Supavisor multiplexes one server connection across clients, so
    // protocol-level prepared statements are not portable across it.
    prepare: false,
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 240,
  });
  return drizzle(sql, { schema });
}

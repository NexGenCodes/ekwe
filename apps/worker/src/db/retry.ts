import { logger } from "@/core/logger";
import { getDb } from "@/db";
import type { Env } from "@/core/types";

type Db = ReturnType<typeof getDb>;

const CONNECTION_LOST_CODES = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNREFUSED",
  "CONNECTION_CLOSED_ERROR",
  "CONNECTION_ENDED",
  "57P01", // admin_shutdown
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08006", // connection_failure
]);

/**
 * Joins the message chain. Cloudflare raises a dropped socket as
 * `Network connection lost.` off `cause`, so reading only `error.message`
 * logs the SQL text and nothing about what actually failed.
 */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && !parts.includes(message)) {
      parts.push(message);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ");
}

export function isConnectionLost(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && CONNECTION_LOST_CODES.has(code)) return true;
  const text = describeError(error).toLowerCase();
  return (
    text.includes("network connection lost") ||
    text.includes("connection terminated") ||
    text.includes("socket hang up") ||
    text.includes("connection closed") ||
    text.includes("open slot in the pool")
  );
}

/**
 * Runs a read or idempotent write, retrying once on a new connection when the
 * socket dies.
 *
 * Never wrap an incrementing counter: replaying it after a lost response would
 * charge twice (see `consume_usage`, left unwrapped at its call site).
 */
export async function retryOnConnectionLoss<T>(
  query: (db: Db) => Promise<T>,
  env: Env,
): Promise<T> {
  try {
    return await query(getDb(env));
  } catch (error) {
    if (!isConnectionLost(error)) throw error;
    logger.warn("[db] connection lost, retrying on a new connection");
    return await query(getDb(env));
  }
}

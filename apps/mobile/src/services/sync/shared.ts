/**
 * Shared helpers and constants used across the sync subsystem.
 */

/** Coerces thrown objects into an Error instance. */
export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === "object" && err !== null) {
    const record = err as {
      message?: unknown;
      code?: unknown;
      details?: unknown;
    };
    if (typeof record.message === "string" && record.message) {
      const code = typeof record.code === "string" ? ` (${record.code})` : "";
      const error = new Error(`${record.message}${code}`);
      if (typeof record.code === "string") {
        (error as Error & { code?: string }).code = record.code;
      }
      return error;
    }
  }
  if (typeof err === "string") return new Error(err);
  return new Error(JSON.stringify(err));
}

export const INITIAL_HISTORY_SIZE = 20;
export const MAX_HISTORY_CACHE = 1000;
export const LOCAL_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DRAIN_TIMEOUT_MS = 15_000;
export const DRAIN_BASE_DELAY_MS = 500;
export const DRAIN_MAX_BACKOFF_MS = 60_000;
/** Gap between push chunks, comfortably past the server's 250 ms window. */
export const PUSH_CHUNK_GAP_MS = 350;
/** Whole-second Retry-After the worker returns when a push lands too early. */
export const PUSH_RATE_LIMIT_BACKOFF_MS = 1_100;
export const PUSH_RATE_LIMIT_RETRIES = 3;
/** Headroom kept under the worker's body limit for the JSON envelope. */
export const PUSH_BODY_HEADROOM_BYTES = 2 * 1024;

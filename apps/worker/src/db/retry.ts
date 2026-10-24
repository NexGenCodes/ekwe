import { logger } from "@/core/logger";

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

export function isTransient(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_LOCKED") return true;

  const text = describeError(error).toLowerCase();
  return (
    text.includes("sqlite_busy") ||
    text.includes("sqlite_locked") ||
    text.includes("database is locked") ||
    text.includes("network connection lost")
  );
}

/**
 * D1 has one writer, so concurrent requests collide on SQLITE_BUSY rather than
 * on a dropped socket. Only wrap idempotent statements: the retry replays.
 */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let last: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isTransient(error) || attempt === attempts - 1) break;
      logger.warn("[db] transient error, retrying", {
        attempt: attempt + 1,
        error: describeError(error),
      });
      const base = 25 * 2 ** attempt;
      const jitter = (Math.random() - 0.5) * base; // ±50% jitter to spread retries
      await new Promise((resolve) => setTimeout(resolve, base + jitter));
    }
  }

  throw last;
}

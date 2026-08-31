import { logger } from "../core/logger";

/**
 * Atomic webhook idempotency claim backed by D1.
 *
 * The previous KV get-then-put was not atomic: two concurrent duplicate
 * deliveries could both miss the key and both run the event handler. D1
 * `INSERT ... ON CONFLICT DO NOTHING` is atomic — exactly one request inserts
 * the key and replaces zero rows; every concurrent duplicate replaces zero
 * rows (a `meta.changes` of 0) and is dropped.
 *
 * The `expirationTtlSeconds` bound makes keys self-expiring so the table can
 * be swept by the cron cleanup instead of growing forever. Returns true when
 * this request won the claim (should process), false when it is a duplicate.
 */
export async function claimIdempotency(
  db: D1Database | undefined,
  key: string,
  expirationTtlSeconds = 86_400,
): Promise<boolean> {
  if (!db) {
    // No D1 binding (dev/local) — default to "process" rather than dropping a
    // legitimate webhook. This is a best-effort dedupe, not a security gate.
    return true;
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    const { meta } = await db
      .prepare(
        `INSERT INTO webhook_idempotency (idempotency_key, created_at, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(key, now, now + expirationTtlSeconds)
      .run();
    return (meta.changes ?? 0) > 0;
  } catch (e) {
    logger.error("[idempotency] claim failed, allowing (best-effort)", {
      error: String(e),
    });
    return true;
  }
}

/**
 * Releases a previously-claimed idempotency key. Used when an event was
 * claimed but could not be fully applied: releasing lets the provider's
 * re-delivery reclaim the key and retry, instead of being permanently deduped
 * as a duplicate. Deleting an unclaimed key is a no-op.
 */
export async function releaseIdempotency(
  db: D1Database | undefined,
  key: string,
): Promise<void> {
  if (!db) return;
  try {
    await db
      .prepare(`DELETE FROM webhook_idempotency WHERE idempotency_key = ?`)
      .bind(key)
      .run();
  } catch (e) {
    logger.error("[idempotency] release failed (best-effort)", {
      error: String(e),
    });
  }
}

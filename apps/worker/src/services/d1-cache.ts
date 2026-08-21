import { logger } from "../core/logger";

/**
 * D1 cache utility — replaces KV for translation/transcription caching.
 *
 * KV free tier: 1K writes/day (per-user cache burns this fast)
 * D1 free tier: 100K writes/day (100x more headroom)
 *
 * Same code works on paid tier with higher limits — zero code changes.
 */

/**
 * Read a cached value from D1.
 * Returns the parsed result string, or null if expired/missing.
 */
export async function d1Get(
  db: D1Database,
  table: "cache_translation" | "cache_transcription",
  cacheKey: string,
): Promise<string | null> {
  try {
    const row = await db
      .prepare(`SELECT result, expires_at FROM ${table} WHERE cache_key = ?`)
      .bind(cacheKey)
      .first<{ result: string; expires_at: number }>();

    if (!row) return null;
    if (row.expires_at < Date.now() / 1000) {
      // Expired — delete lazily
      db.prepare(`DELETE FROM ${table} WHERE cache_key = ?`)
        .bind(cacheKey)
        .run()
        .catch(() => {});
      return null;
    }
    return row.result;
  } catch (e) {
    logger.error("[d1-cache] get failed", { error: String(e) });
    return null;
  }
}

/**
 * Write a value to D1 cache.
 * TTL is in seconds. Upserts on conflict.
 */
export async function d1Put(
  db: D1Database,
  table: "cache_translation" | "cache_transcription",
  cacheKey: string,
  userId: string,
  tier: string,
  result: string,
  ttlSeconds: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  try {
    await db
      .prepare(
        `INSERT INTO ${table} (cache_key, user_id, tier, result, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           result = excluded.result,
           expires_at = excluded.expires_at`,
      )
      .bind(cacheKey, userId, tier, result, now, expiresAt)
      .run();
  } catch (e) {
    logger.error("[d1-cache] put failed", { error: String(e) });
  }
}

/**
 * Cleanup expired cache entries.
 * Call this from the cron job — D1 doesn't auto-expire like KV.
 * A single DELETE statement reclaims every expired row in one operation,
 * so the cleanup can always keep up with the free-tier write rate without
 * counting per-row write ops.
 */
export async function d1Cleanup(
  db: D1Database,
  table: "cache_translation" | "cache_transcription" | "cache_lang",
): Promise<number> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const { meta } = await db
      .prepare(`DELETE FROM ${table} WHERE expires_at < ?`)
      .bind(now)
      .run();
    return meta.changes ?? 0;
  } catch (e) {
    logger.error("[d1-cache] cleanup failed", { error: String(e) });
    return 0;
  }
}

// ─── Language detection cache ─────────────────────────────────────
// Shared across users (same text → same detection), no user_id/tier columns.

export async function d1GetLang(
  db: D1Database,
  cacheKey: string,
): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT detected_lang, expires_at FROM cache_lang WHERE cache_key = ?`,
      )
      .bind(cacheKey)
      .first<{ detected_lang: string; expires_at: number }>();

    if (!row) return null;
    if (row.expires_at < Date.now() / 1000) {
      db.prepare(`DELETE FROM cache_lang WHERE cache_key = ?`)
        .bind(cacheKey)
        .run()
        .catch(() => {});
      return null;
    }
    return row.detected_lang;
  } catch (e) {
    logger.error("[d1-cache] lang get failed", { error: String(e) });
    return null;
  }
}

export async function d1PutLang(
  db: D1Database,
  cacheKey: string,
  detectedLang: string,
  ttlSeconds: number,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + ttlSeconds;
  try {
    await db
      .prepare(
        `INSERT INTO cache_lang (cache_key, detected_lang, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           detected_lang = excluded.detected_lang,
           expires_at = excluded.expires_at`,
      )
      .bind(cacheKey, detectedLang, expiresAt)
      .run();
  } catch (e) {
    logger.error("[d1-cache] lang put failed", { error: String(e) });
  }
}

import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { eq, and, desc, sql, or } from "drizzle-orm";
import { history, outbox } from "@ekwe/db/local-schema";

import logger from "@/utils/logger";

/** Minimum gap between outbox push attempts to avoid burning all retries on a flaky network. */
const OUTBOX_RETRY_BACKOFF_MS = 60_000;

const expoDb = openDatabaseSync("ekwe.db");
const db = drizzle(expoDb);

// ─── SQLite performance PRAGMAs ─────────────────────────────────
// WAL mode allows concurrent reads during writes and improves write
// throughput 2-5×. NORMAL synchronous is safe in WAL mode (data is
// durable on process crash; only an OS crash can lose a transaction).
// These are session-level; they run once at DB open.
try {
  expoDb.execSync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA cache_size = -16000;
    PRAGMA busy_timeout = 5000;
    PRAGMA mmap_size = 268435456;
    PRAGMA temp_store = MEMORY;
    PRAGMA foreign_keys = ON;
  `);
} catch (err) {
  logger.error("Failed to set SQLite PRAGMAs", err);
}

// We need to run migrations. Since we are moving from op-sqlite, the ekwe.db file
// already exists. We can use Drizzle's migration, but for now we'll just ensure the tables
// exist if they don't, to preserve compatibility with existing databases.
// The raw SQL schema is identical, so existing data works fine.
function ensureTables(): void {
  try {
    expoDb.execSync(`
      CREATE TABLE IF NOT EXISTS history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_lang TEXT NOT NULL,
        target_lang TEXT NOT NULL,
        transcript TEXT NOT NULL,
        translation_text TEXT,
        transliteration_text TEXT,
        duration REAL NOT NULL DEFAULT 0,
        source_app TEXT NOT NULL DEFAULT '',
        provider TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        entry_type TEXT NOT NULL DEFAULT 'transcription'
      );
      CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
      CREATE INDEX IF NOT EXISTS idx_history_user_created ON history(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        user_id TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0,
        last_attempt INTEGER,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'in_flight', 'dead'))
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status);

      CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
        id UNINDEXED,
        transcript,
        translation_text
      );
    `);

    repairFtsTriggers();
  } catch (err) {
    logger.error("Error migrating local database", err);
  }
}

/**
 * Keep the FTS index in sync with the `history` table.
 *
 * The FTS5 special write command
 *   INSERT INTO history_fts(history_fts, ...) VALUES('delete', ...)
 * is ONLY valid for contentless (`content=''`) or external-content
 * (`content='tablename'`) tables. On a plain contentful table it raises
 * `SQL logic error`, which surfaced as the intermittent
 * `Pull from cloud failed` (ERR_INTERNAL_SQLITE_ERROR) once a history row
 * existed and the cloud sync switched to the ON CONFLICT UPDATE path.
 *
 * New databases get a contentful table, so maintain it with a plain
 * DELETE-by-id. Any legacy op-sqlite install may still carry the older
 * external-content (`content='history'` + rowid) table, where the `'delete'`
 * command IS valid — detect the shape and install matching triggers. The
 * triggers are dropped and recreated unconditionally so databases created by
 * earlier buggy builds are repaired in place.
 */
function repairFtsTriggers(): void {
  const ftsRow = expoDb.getFirstSync<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'history_fts'",
  );
  const isExternalContent =
    ftsRow?.sql != null && /content\s*=\s*['"]/.test(ftsRow.sql);

  const ai = isExternalContent
    ? `INSERT INTO history_fts(rowid, transcript, translation_text)
        VALUES (new.rowid, new.transcript, new.translation_text);`
    : `INSERT INTO history_fts(id, transcript, translation_text)
        VALUES (new.id, new.transcript, new.translation_text);`;
  const ad = isExternalContent
    ? `INSERT INTO history_fts(history_fts, rowid, transcript, translation_text)
        VALUES('delete', old.rowid, old.transcript, old.translation_text);`
    : `DELETE FROM history_fts WHERE id = old.id;`;

  expoDb.execSync(`
    DROP TRIGGER IF EXISTS history_ai;
    DROP TRIGGER IF EXISTS history_ad;
    DROP TRIGGER IF EXISTS history_au;
    CREATE TRIGGER history_ai AFTER INSERT ON history BEGIN
      ${ai}
    END;
    CREATE TRIGGER history_ad AFTER DELETE ON history BEGIN
      ${ad}
    END;
    CREATE TRIGGER history_au AFTER UPDATE ON history BEGIN
      ${ad}
      ${ai}
    END;
  `);
}

ensureTables();

export type HistoryRow = typeof history.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;

export const Db = {
  transaction: (fn: () => void): void => {
    expoDb.execSync("BEGIN EXCLUSIVE TRANSACTION");
    try {
      fn();
      expoDb.execSync("COMMIT");
    } catch (e) {
      expoDb.execSync("ROLLBACK");
      throw e;
    }
  },

  insertHistory: (row: typeof history.$inferInsert): void => {
    db.insert(history)
      .values(row)
      .onConflictDoUpdate({
        target: history.id,
        set: row,
      })
      .run();
  },

  deleteHistory: (id: string): void => {
    db.delete(history).where(eq(history.id, id)).run();
  },

  findTranslationByDedupKey: (
    userId: string,
    sourceLang: string,
    targetLang: string,
    transcript: string,
  ): HistoryRow | null => {
    if (!userId) return null;
    const results = db
      .select()
      .from(history)
      .where(
        and(
          eq(history.userId, userId),
          eq(history.entryType, "translation"),
          eq(history.sourceLang, sourceLang),
          eq(history.targetLang, targetLang),
          eq(history.transcript, transcript),
        ),
      )
      .orderBy(desc(history.createdAt))
      .limit(1)
      .all();
    return results[0] ?? null;
  },

  updateTranslationRow: (
    id: string,
    row: {
      translation_text: string | null;
      transliteration_text: string | null;
      duration: number;
      source_app: string;
      provider: string;
    },
  ): void => {
    db.update(history)
      .set({
        translationText: row.translation_text,
        transliterationText: row.transliteration_text,
        duration: row.duration,
        sourceApp: row.source_app,
        provider: row.provider,
      })
      .where(eq(history.id, id))
      .run();
  },

  getRecentHistory: (userId: string, limit: number = 200): HistoryRow[] => {
    if (!userId) return [];
    return db
      .select()
      .from(history)
      .where(eq(history.userId, userId))
      .orderBy(desc(history.createdAt))
      .limit(limit)
      .all();
  },

  getHistoryPage: (
    userId: string,
    limit: number,
    before: { created_at: string; id: string } | null,
  ): HistoryRow[] => {
    if (!userId) return [];

    let condition = eq(history.userId, userId);
    if (before) {
      condition = and(
        eq(history.userId, userId),
        or(
          sql`${history.createdAt} < ${before.created_at}`,
          and(
            eq(history.createdAt, before.created_at),
            sql`${history.id} < ${before.id}`,
          ),
        ),
      ) as typeof condition;
    }

    return (
      db
        .select()
        .from(history)
        .where(condition)
        // Keyset order must use BOTH cursor keys (id breaks ties on identical
        // created_at) or shared-timestamp rows straddle page boundaries.
        .orderBy(desc(history.createdAt), desc(history.id))
        .limit(limit)
        .all()
    );
  },

  searchHistory: (
    userId: string,
    query: string,
    limit: number = 100,
  ): HistoryRow[] => {
    if (!userId || !query) return [];

    // Basic sanitization for FTS5 syntax
    const sanitized = query.replace(/['"]/g, "").trim();
    if (!sanitized) return [];

    // For substring matching in FTS5 without trigram, we append wildcard
    const ftsQuery = `"${sanitized}"*`;

    return db
      .select()
      .from(history)
      .where(
        and(
          eq(history.userId, userId),
          sql`${history.id} IN (SELECT id FROM history_fts WHERE history_fts MATCH ${ftsQuery})`,
        ),
      )
      .orderBy(desc(history.createdAt))
      .limit(limit)
      .all();
  },

  cleanupExpiredHistory: (ttlDays: number, userId?: string): number => {
    const cutoff = new Date(
      Date.now() - ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    // Scope the purge to the active user (shared-device safety) and skip rows
    // whose outbox entry hasn't synced yet — those unsynced rows are the
    // user's only copy until a drain succeeds. Once the outbox row is cleared,
    // the history row becomes eligible on the next cleanup pass.
    const conditions = [sql`${history.createdAt} < ${cutoff}`];
    if (userId) conditions.push(eq(history.userId, userId));
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${outbox} WHERE ${outbox.id} = ${history.id})`,
    );
    const deleted = db
      .delete(history)
      .where(and(...conditions))
      .run();
    return deleted.changes ?? 0;
  },

  insertOutbox: (row: typeof outbox.$inferInsert): void => {
    db.insert(outbox)
      .values({
        id: row.id,
        payload: row.payload,
        userId: row.userId,
        retries: 0,
        lastAttempt: null,
        createdAt: row.createdAt,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: outbox.id,
        set: {
          payload: row.payload,
          userId: row.userId,
          createdAt: row.createdAt,
        },
      })
      .run();
  },

  deleteOutbox: (id: string): void => {
    db.delete(outbox).where(eq(outbox.id, id)).run();
  },

  deleteOutboxForHistory: (id: string): void => {
    db.delete(outbox)
      .where(
        or(
          eq(outbox.id, id),
          sql`${outbox.payload} LIKE '%"id":"' || ${id} || '"%'`,
        ),
      )
      .run();
  },

  getPendingOutbox: (userId: string): OutboxRow[] => {
    if (!userId) return [];
    return db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.userId, userId),
          eq(outbox.status, "pending"),
          sql`${outbox.retries} < 5`,
          or(
            sql`${outbox.lastAttempt} IS NULL`,
            sql`${outbox.lastAttempt} <= ${Date.now() - OUTBOX_RETRY_BACKOFF_MS}`,
          ),
        ),
      )
      .orderBy(outbox.createdAt)
      .all();
  },

  countDeadOutbox: (userId: string): number => {
    if (!userId) return 0;
    const result = db
      .select({ count: sql<number>`COUNT(*)` })
      .from(outbox)
      .where(and(eq(outbox.userId, userId), eq(outbox.status, "dead")))
      .all();
    return result[0]?.count ?? 0;
  },

  incrementOutboxRetry: (id: string): void => {
    const MAX_RETRIES = 5;
    db.update(outbox)
      .set({
        retries: sql`${outbox.retries} + 1`,
        lastAttempt: Date.now(),
        status: sql`CASE WHEN ${outbox.retries} + 1 >= ${MAX_RETRIES} THEN 'dead' ELSE 'pending' END`,
      })
      .where(eq(outbox.id, id))
      .run();
  },

  markOutboxInFlight: (id: string): void => {
    db.update(outbox)
      .set({ status: "in_flight" })
      .where(eq(outbox.id, id))
      .run();
  },

  /**
   * Crash recovery: reset rows stuck in `in_flight` back to `pending`.
   * Called at startup — if the app crashed mid-push, these rows need a retry.
   * Does NOT touch `dead` rows (those exhausted their retries deliberately).
   */
  reviveInFlight: (): number => {
    const res = db
      .update(outbox)
      .set({ status: "pending" })
      .where(eq(outbox.status, "in_flight"))
      .run();
    return res.changes ?? 0;
  },

  /**
   * Explicitly resurrect `dead` rows for a user-triggered retry.
   * Resets retries to 0 so they get a fresh 5-attempt budget.
   */
  reviveDeadOutbox: (): number => {
    const res = db
      .update(outbox)
      .set({ status: "pending", retries: 0 })
      .where(eq(outbox.status, "dead"))
      .run();
    return res.changes ?? 0;
  },

  purgeUserHistory: (userId: string): void => {
    db.delete(history).where(eq(history.userId, userId)).run();
  },

  purgeUserOutbox: (userId: string): void => {
    db.delete(outbox).where(eq(outbox.userId, userId)).run();
  },

  vacuum: (): void => {
    expoDb.execSync("PRAGMA incremental_vacuum");
  },
};

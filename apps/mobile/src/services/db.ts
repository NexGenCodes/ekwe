import type { SQLiteBindParams } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { eq, and, desc, sql, or, isNull, placeholder } from "drizzle-orm";
import { history } from "@/db/schema";

import migrations from "../../drizzle/migrations";

import logger from "@/utils/logger";

const expoDb = openDatabaseSync("ekwe.db");
const db = drizzle(expoDb);

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

function isAlreadyAppliedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /already exists/i.test(message);
}

function ensureTables(): void {
  try {
    expoDb.execSync(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );
    `);

    const applied = new Set<string>(
      expoDb
        .getAllSync<{ tag: string }>("SELECT tag FROM __drizzle_migrations")
        .map((row) => row.tag),
    );

    for (const entry of migrations.journal.entries) {
      if (applied.has(entry.tag)) continue;

      const key = `m${String(entry.idx).padStart(4, "0")}`;
      const sql = migrations.migrations[key];
      if (!sql) {
        logger.warn(`Local migration ${entry.tag} produced no SQL`);
        continue;
      }

      expoDb.execSync("BEGIN EXCLUSIVE TRANSACTION");
      try {
        expoDb.execSync(sql);
        expoDb.runSync(
          "INSERT INTO __drizzle_migrations (tag, created_at) VALUES (?, ?)",
          entry.tag,
          Date.now(),
        );
        expoDb.execSync("COMMIT");
      } catch (err) {
        expoDb.execSync("ROLLBACK");
        if (isAlreadyAppliedError(err)) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            `Migration ${entry.tag} reported "${msg}"; treating as already applied`,
          );
          expoDb.execSync("BEGIN EXCLUSIVE TRANSACTION");
          try {
            expoDb.runSync(
              "INSERT OR IGNORE INTO __drizzle_migrations (tag, created_at) VALUES (?, ?)",
              entry.tag,
              Date.now(),
            );
            expoDb.execSync("COMMIT");
          } catch (recordErr) {
            expoDb.execSync("ROLLBACK");
            throw recordErr;
          }
          continue;
        }
        throw err;
      }
    }

    repairFtsTriggers();
  } catch (err) {
    logger.error("Error migrating local database", err);
  }
}

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

// ---------------------------------------------------------------------------
// Prepared statements — parse SQL once, bind params on each call.
// Use `.run()` / `.all()` / `.get()`, never `.execute()` (sync driver no-op).
// ---------------------------------------------------------------------------

/** Live rows only — tombstones are filtered out of every user-facing read. */
const liveRow = isNull(history.deletedAt);

const _recentHistoryStmt = db
  .select()
  .from(history)
  .where(and(eq(history.userId, placeholder("userId")), liveRow))
  .orderBy(desc(history.createdAt))
  .limit(placeholder("limit"))
  .prepare();

const _historyPageFirstStmt = db
  .select()
  .from(history)
  .where(and(eq(history.userId, placeholder("userId")), liveRow))
  .orderBy(desc(history.createdAt), desc(history.id))
  .limit(placeholder("limit"))
  .prepare();

/** Finds a row by capture ID for upsert deduplication. */
const _captureStmt = db
  .select()
  .from(history)
  .where(
    and(
      eq(history.userId, placeholder("userId")),
      eq(history.captureId, placeholder("captureId")),
      liveRow,
    ),
  )
  .orderBy(desc(history.createdAt))
  .limit(1)
  .prepare();

const _markDeletedStmt = db
  .update(history)
  .set({
    deletedAt: sql`${placeholder("deletedAt")}`,
    dirty: 1,
    restore: 0,
  })
  .where(eq(history.id, placeholder("id")))
  .prepare();

const _clearDeletedStmt = db
  .update(history)
  .set({ deletedAt: null, dirty: 1, restore: 1 })
  .where(eq(history.id, placeholder("id")))
  .prepare();

/** Includes tombstones — used by delete/restore to read the row's revision. */
const _historyByIdStmt = db
  .select()
  .from(history)
  .where(eq(history.id, placeholder("id")))
  .limit(1)
  .prepare();

const _allHistoryStmt = db
  .select()
  .from(history)
  .where(eq(history.userId, placeholder("userId")))
  .prepare();

const _dirtyHistoryStmt = db
  .select()
  .from(history)
  .where(and(eq(history.userId, placeholder("userId")), eq(history.dirty, 1)))
  .orderBy(history.createdAt)
  .prepare();

const _countDirtyStmt = db
  .select({ count: sql<number>`COUNT(*)` })
  .from(history)
  .where(and(eq(history.userId, placeholder("userId")), eq(history.dirty, 1)))
  .prepare();

const _isDirtyStmt = db
  .select({ id: history.id })
  .from(history)
  .where(and(eq(history.id, placeholder("id")), eq(history.dirty, 1)))
  .limit(1)
  .prepare();

const _purgeHistoryStmt = db
  .delete(history)
  .where(eq(history.userId, placeholder("userId")))
  .prepare();

// ---------------------------------------------------------------------------

export type HistoryRow = typeof history.$inferSelect;

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

  /**
   * Writes the full row state, including `deletedAt`. Local writes default to
   * dirty; server-mirrored rows pass `dirty: 0` explicitly.
   */
  insertHistory: (row: typeof history.$inferInsert): void => {
    const values = {
      ...row,
      deletedAt: row.deletedAt ?? null,
      dirty: row.dirty ?? 1,
      restore: row.restore ?? 0,
    };
    db.insert(history)
      .values(values)
      .onConflictDoUpdate({
        target: history.id,
        set: values,
      })
      .run();
  },

  /** Soft-deletes and queues the tombstone for push. */
  markHistoryDeleted: (id: string, deletedAt: number = Date.now()): void => {
    _markDeletedStmt.run({ id, deletedAt });
  },

  /** Clears a tombstone and queues a restore against its revision. */
  clearHistoryDeleted: (id: string): void => {
    _clearDeletedStmt.run({ id });
  },

  /** Applies the server's tombstone; it is already acknowledged. */
  applyRemoteDeletion: (
    id: string,
    revision: number,
    deletedAt: number = Date.now(),
  ): void => {
    db.update(history)
      .set({ deletedAt, revision, dirty: 0, restore: 0 })
      .where(eq(history.id, id))
      .run();
  },

  /** Records the server-confirmed revision for conflict resolution. */
  setHistoryRevision: (id: string, revision: number): void => {
    db.update(history).set({ revision }).where(eq(history.id, id)).run();
  },

  /** Clears the dirty flag after the server accepts a push. */
  markHistoryClean: (id: string, revision: number): void => {
    db.update(history)
      .set({ revision, dirty: 0, restore: 0 })
      .where(eq(history.id, id))
      .run();
  },

  getDirtyHistory: (userId: string): HistoryRow[] => {
    if (!userId) return [];
    return _dirtyHistoryStmt.all({ userId });
  },

  countDirtyHistory: (userId: string): number => {
    if (!userId) return 0;
    return _countDirtyStmt.all({ userId })[0]?.count ?? 0;
  },

  isHistoryDirty: (id: string): boolean => {
    return _isDirtyStmt.all({ id }).length > 0;
  },

  /** Returns the last server-confirmed revision, or null if unknown. */
  getHistoryRevision: (id: string): number | null => {
    const rows = db
      .select({ revision: history.revision })
      .from(history)
      .where(eq(history.id, id))
      .limit(1)
      .all();
    return rows[0]?.revision ?? null;
  },

  /** Reads a row including its tombstone, when one exists. */
  getHistoryById: (id: string): HistoryRow | null => {
    return _historyByIdStmt.all({ id })[0] ?? null;
  },

  /** Every row for a user, including tombstones. */
  getAllHistory: (userId: string): HistoryRow[] => {
    if (!userId) return [];
    return _allHistoryStmt.all({ userId });
  },

  /** Finds the row for a capture ID. Returns null for empty IDs to prevent legacy row collisions. */
  findByCaptureId: (
    userId: string,
    captureId: string | null,
  ): HistoryRow | null => {
    if (!userId || !captureId) return null;
    const results = _captureStmt.all({ userId, captureId });
    return results[0] ?? null;
  },

  updateCaptureRow: (
    id: string,
    row: {
      /** The transcript field, included on updates to keep local storage in sync. */
      transcript: string;
      translation_text: string | null;
      transliteration_text: string | null;
      duration: number;
      /** Nullable in the model; stored as "" because the column is NOT NULL. */
      source_app: string | null;
      voice_id: string | null;
      stt_provider: string;
      mt_provider: string | null;
      origin: string;
      input: string;
    },
  ): void => {
    db.update(history)
      .set({
        transcript: row.transcript,
        translationText: row.translation_text,
        transliterationText: row.transliteration_text,
        duration: row.duration,
        sourceApp: row.source_app ?? "",
        voiceId: row.voice_id,
        sttProvider: row.stt_provider,
        mtProvider: row.mt_provider,
        origin: row.origin,
        input: row.input,
        // Keep entryType in sync with translation state for backward compatibility.
        entryType: row.translation_text ? "translation" : "transcription",
        dirty: 1,
        restore: 0,
      })
      .where(eq(history.id, id))
      .run();
  },

  getRecentHistory: (userId: string, limit: number = 200): HistoryRow[] => {
    if (!userId) return [];
    return _recentHistoryStmt.all({ userId, limit });
  },

  getHistoryPage: (
    userId: string,
    limit: number,
    before: { created_at: string; id: string } | null,
  ): HistoryRow[] => {
    if (!userId) return [];

    if (!before) {
      return _historyPageFirstStmt.all({ userId, limit });
    }

    // Keyset pagination with cursor — requires inline SQL for the OR condition.
    return db
      .select()
      .from(history)
      .where(
        and(
          eq(history.userId, userId),
          liveRow,
          or(
            sql`${history.createdAt} < ${before.created_at}`,
            and(
              eq(history.createdAt, before.created_at),
              sql`${history.id} < ${before.id}`,
            ),
          ),
        ),
      )
      .orderBy(desc(history.createdAt), desc(history.id))
      .limit(limit)
      .all();
  },

  searchHistory: (
    userId: string,
    query: string,
    limit: number = 100,
  ): HistoryRow[] => {
    if (!userId || !query) return [];

    const sanitized = query.replace(/['"]/g, "").trim();
    if (!sanitized) return [];

    const ftsQuery = `"${sanitized}"*`;

    return db
      .select()
      .from(history)
      .where(
        and(
          eq(history.userId, userId),
          liveRow,
          sql`${history.id} IN (SELECT id FROM history_fts WHERE history_fts MATCH ${ftsQuery})`,
        ),
      )
      .orderBy(desc(history.createdAt))
      .limit(limit)
      .all();
  },

  /**
   * Async counterpart to searchHistory. The drizzle Expo driver is sync-only,
   * so the statement is built with the query builder and handed to the native
   * async API — that keeps FTS off the JS thread instead of blocking render.
   */
  searchHistoryAsync: async (
    userId: string,
    query: string,
    limit: number = 100,
  ): Promise<HistoryRow[]> => {
    if (!userId || !query) return [];

    const sanitized = query.replace(/['"]/g, "").trim();
    if (!sanitized) return [];

    const statement = db
      .select()
      .from(history)
      .where(
        and(
          eq(history.userId, userId),
          liveRow,
          sql`${history.id} IN (SELECT id FROM history_fts WHERE history_fts MATCH ${`"${sanitized}"*`})`,
        ),
      )
      .orderBy(desc(history.createdAt))
      .limit(limit)
      .toSQL();

    return (await expoDb.getAllAsync(
      statement.sql,
      statement.params as SQLiteBindParams,
    )) as HistoryRow[];
  },

  cleanupExpiredHistory: (ttlDays: number, userId?: string): number => {
    const cutoff = new Date(
      Date.now() - ttlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const conditions = [
      liveRow,
      eq(history.dirty, 0),
      sql`${history.createdAt} < ${cutoff}`,
    ];
    if (userId) conditions.push(eq(history.userId, userId));
    const deleted = db
      .delete(history)
      .where(and(...conditions))
      .run();
    return deleted.changes ?? 0;
  },

  /** Hard-deletes acknowledged tombstones past the retention window. */
  purgeExpiredTombstones: (ttlDays: number): number => {
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const purged = db
      .delete(history)
      .where(
        and(
          sql`${history.deletedAt} IS NOT NULL`,
          eq(history.dirty, 0),
          sql`${history.deletedAt} < ${cutoff}`,
        ),
      )
      .run();
    return purged.changes ?? 0;
  },

  purgeUserHistory: (userId: string): void => {
    _purgeHistoryStmt.run({ userId });
  },

  vacuum: (): void => {
    expoDb.execSync("PRAGMA incremental_vacuum");
  },
};

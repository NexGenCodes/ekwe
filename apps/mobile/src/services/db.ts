import type { SQLiteBindParams } from "expo-sqlite";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import {
  eq,
  and,
  desc,
  sql,
  or,
  isNull,
  inArray,
  placeholder,
} from "drizzle-orm";
import { history, outbox } from "@/db/schema";

import migrations from "../../drizzle/migrations";

import logger from "@/utils/logger";

const OUTBOX_RETRY_BACKOFF_MS = 60_000;

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
  .set({ deletedAt: sql`${placeholder("deletedAt")}` })
  .where(eq(history.id, placeholder("id")))
  .prepare();

const _clearDeletedStmt = db
  .update(history)
  .set({ deletedAt: null })
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

const _deleteOutboxStmt = db
  .delete(outbox)
  .where(eq(outbox.id, placeholder("id")))
  .prepare();

const _countDeadStmt = db
  .select({ count: sql<number>`COUNT(*)` })
  .from(outbox)
  .where(
    and(eq(outbox.userId, placeholder("userId")), eq(outbox.status, "dead")),
  )
  .prepare();

const _countUnsyncedStmt = db
  .select({ count: sql<number>`COUNT(*)` })
  .from(outbox)
  .where(eq(outbox.userId, placeholder("userId")))
  .prepare();

const _markInFlightStmt = db
  .update(outbox)
  .set({ status: "in_flight" })
  .where(eq(outbox.id, placeholder("id")))
  .prepare();

const _reviveInFlightStmt = db
  .update(outbox)
  .set({ status: "pending" })
  .where(eq(outbox.status, "in_flight"))
  .prepare();

const _reviveDeadStmt = db
  .update(outbox)
  .set({ status: "pending", retries: 0 })
  .where(eq(outbox.status, "dead"))
  .prepare();

const _purgeHistoryStmt = db
  .delete(history)
  .where(eq(history.userId, placeholder("userId")))
  .prepare();

const _purgeOutboxStmt = db
  .delete(outbox)
  .where(eq(outbox.userId, placeholder("userId")))
  .prepare();

// ---------------------------------------------------------------------------

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

  /**
   * Writes the full row state, including `deletedAt`. Pass null to clear a
   * tombstone (restore) and a timestamp to write one.
   */
  insertHistory: (row: typeof history.$inferInsert): void => {
    const values = { ...row, deletedAt: row.deletedAt ?? null };
    db.insert(history)
      .values(values)
      .onConflictDoUpdate({
        target: history.id,
        set: values,
      })
      .run();
  },

  /** Soft-deletes: keeps the row (and its revision) as a local tombstone. */
  markHistoryDeleted: (id: string, deletedAt: number = Date.now()): void => {
    _markDeletedStmt.run({ id, deletedAt });
  },

  /** Clears a tombstone so an Undo can push a restore against its revision. */
  clearHistoryDeleted: (id: string): void => {
    _clearDeletedStmt.run({ id });
  },

  /** Marks a row the server reports as deleted, keeping its revision. */
  applyRemoteDeletion: (
    id: string,
    revision: number,
    deletedAt: number = Date.now(),
  ): void => {
    db.update(history)
      .set({ deletedAt, revision })
      .where(eq(history.id, id))
      .run();
  },

  /** Records the server-confirmed revision for conflict resolution. */
  setHistoryRevision: (id: string, revision: number): void => {
    db.update(history).set({ revision }).where(eq(history.id, id)).run();
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
      sql`${history.createdAt} < ${cutoff}`,
      // Never drop a row that still has an unacknowledged write queued.
      sql`NOT EXISTS (SELECT 1 FROM ${outbox} WHERE json_extract(${outbox.payload}, '$.id') = ${history.id})`,
    ];
    if (userId) conditions.push(eq(history.userId, userId));
    const deleted = db
      .delete(history)
      .where(and(...conditions))
      .run();
    return deleted.changes ?? 0;
  },

  /** Hard-deletes tombstones past the retention window. */
  purgeExpiredTombstones: (ttlDays: number): number => {
    const cutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000;
    const purged = db
      .delete(history)
      .where(
        and(
          sql`${history.deletedAt} IS NOT NULL`,
          sql`${history.deletedAt} < ${cutoff}`,
        ),
      )
      .run();
    return purged.changes ?? 0;
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
          status: "pending",
          retries: 0,
          lastAttempt: null,
        },
      })
      .run();
  },

  deleteOutbox: (id: string): void => {
    _deleteOutboxStmt.run({ id });
  },

  deleteOutboxForHistory: (id: string): void => {
    db.delete(outbox)
      .where(
        or(
          eq(outbox.id, id),
          sql`json_extract(${outbox.payload}, '$.id') = ${id}`,
        ),
      )
      .run();
  },

  /** Returns all unacknowledged outbox rows regardless of status (pending, in_flight, or dead). */
  getUnacknowledgedOutbox: (userId: string): OutboxRow[] => {
    if (!userId) return [];
    return db
      .select()
      .from(outbox)
      .where(
        and(
          eq(outbox.userId, userId),
          inArray(outbox.status, ["pending", "in_flight", "dead"]),
        ),
      )
      .all();
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

  /** Fast point lookup for the realtime echo guard. Checks both outbox ID and payload target ID. */
  hasPendingOutboxRow: (userId: string, id: string): boolean => {
    if (!userId) return false;
    const row = db
      .select({ id: outbox.id })
      .from(outbox)
      .where(
        and(
          eq(outbox.userId, userId),
          eq(outbox.status, "pending"),
          or(
            eq(outbox.id, id),
            sql`json_extract(${outbox.payload}, '$.id') = ${id}`,
          ),
        ),
      )
      .limit(1)
      .all();
    return row.length > 0;
  },

  countDeadOutbox: (userId: string): number => {
    if (!userId) return 0;
    const result = _countDeadStmt.all({ userId });
    return result[0]?.count ?? 0;
  },

  countUnsyncedOutbox: (userId: string): number => {
    if (!userId) return 0;
    const result = _countUnsyncedStmt.all({ userId });
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
    _markInFlightStmt.run({ id });
  },

  reviveInFlight: (): number => {
    return _reviveInFlightStmt.run().changes;
  },

  reviveDeadOutbox: (): number => {
    return _reviveDeadStmt.run().changes;
  },

  purgeUserHistory: (userId: string): void => {
    _purgeHistoryStmt.run({ userId });
  },

  purgeUserOutbox: (userId: string): void => {
    _purgeOutboxStmt.run({ userId });
  },

  vacuum: (): void => {
    expoDb.execSync("PRAGMA incremental_vacuum");
  },
};

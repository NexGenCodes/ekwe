import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { eq, and, desc, sql, or, placeholder } from "drizzle-orm";
import { history, outbox } from "@ekwe/db/local-schema";

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
// This saves ~0.2–0.5ms per call on the JS thread.
// ---------------------------------------------------------------------------

const _recentHistoryStmt = db
  .select()
  .from(history)
  .where(eq(history.userId, placeholder("userId")))
  .orderBy(desc(history.createdAt))
  .limit(placeholder("limit"))
  .prepare();

const _historyPageFirstStmt = db
  .select()
  .from(history)
  .where(eq(history.userId, placeholder("userId")))
  .orderBy(desc(history.createdAt), desc(history.id))
  .limit(placeholder("limit"))
  .prepare();

const _dedupStmt = db
  .select()
  .from(history)
  .where(
    and(
      eq(history.userId, placeholder("userId")),
      eq(history.entryType, "translation"),
      eq(history.sourceLang, placeholder("sourceLang")),
      eq(history.targetLang, placeholder("targetLang")),
      eq(history.transcript, placeholder("transcript")),
    ),
  )
  .orderBy(desc(history.createdAt))
  .limit(1)
  .prepare();

const _deleteHistoryStmt = db
  .delete(history)
  .where(eq(history.id, placeholder("id")))
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
    _deleteHistoryStmt.execute({ id });
  },

  findTranslationByDedupKey: (
    userId: string,
    sourceLang: string,
    targetLang: string,
    transcript: string,
  ): HistoryRow | null => {
    if (!userId) return null;
    const results = _dedupStmt.all({
      userId,
      sourceLang,
      targetLang,
      transcript,
    });
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

    // Keyset pagination with cursor — can't easily use a single prepared
    // statement for the OR condition with dynamic params, so we build inline.
    return db
      .select()
      .from(history)
      .where(
        and(
          eq(history.userId, userId),
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
    _deleteOutboxStmt.execute({ id });
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
    const result = _countDeadStmt.all({ userId });
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
    _markInFlightStmt.execute({ id });
  },

  reviveInFlight: (): number => {
    const res = _reviveInFlightStmt.execute();
    return (res as { changes?: number }).changes ?? 0;
  },

  reviveDeadOutbox: (): number => {
    const res = _reviveDeadStmt.execute();
    return (res as { changes?: number }).changes ?? 0;
  },

  purgeUserHistory: (userId: string): void => {
    _purgeHistoryStmt.execute({ userId });
  },

  purgeUserOutbox: (userId: string): void => {
    _purgeOutboxStmt.execute({ userId });
  },

  vacuum: (): void => {
    expoDb.execSync("PRAGMA incremental_vacuum");
  },
};

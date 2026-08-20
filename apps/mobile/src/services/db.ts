import { open } from "@op-engineering/op-sqlite";
import type { DB, QueryResult } from "@op-engineering/op-sqlite";

import logger from "@/utils/logger";

/** Minimum gap between outbox push attempts to avoid burning all retries on a flaky network. */
const OUTBOX_RETRY_BACKOFF_MS = 60_000;

let db: DB;

export interface HistoryRow {
  id: string;
  user_id: string;
  source_lang: string;
  target_lang: string;
  transcript: string;
  translation_text: string | null;
  transliteration_text: string | null;
  duration: number;
  source_app: string;
  provider: string;
  created_at: string;
  /** Producing operation: "transcription" | "translation". */
  entry_type: "transcription" | "translation";
}

export interface OutboxRow {
  id: string;
  payload: string;
  user_id: string;
  retries: number;
  last_attempt: number | null;
  created_at: string;
  status: "pending" | "in_flight" | "dead";
}

function migrate(): void {
  const res = db.executeSync("PRAGMA user_version") as QueryResult;
  const currentVersion = (res.rows?.[0]?.user_version as number) ?? 0;

  if (currentVersion < 1) {
    db.executeSync("PRAGMA journal_mode=WAL");
    db.executeSync("PRAGMA auto_vacuum=INCREMENTAL");

    db.executeSync(`
      CREATE TABLE IF NOT EXISTS store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    db.executeSync(`
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
        created_at TEXT NOT NULL
      )
    `);
    db.executeSync(
      "CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC)",
    );
    db.executeSync(
      "CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id)",
    );

    try {
      db.executeSync(`
        CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
          transcript, translation_text,
          content='history',
          content_rowid='rowid',
          tokenize='unicode61'
        )
      `);

      db.executeSync(`
        CREATE TRIGGER IF NOT EXISTS history_ai AFTER INSERT ON history BEGIN
          INSERT INTO history_fts(rowid, transcript, translation_text)
          VALUES (new.rowid, new.transcript, new.translation_text);
        END
      `);
      db.executeSync(`
        CREATE TRIGGER IF NOT EXISTS history_ad AFTER DELETE ON history BEGIN
          INSERT INTO history_fts(history_fts, rowid, transcript, translation_text)
          VALUES ('delete', old.rowid, old.transcript, old.translation_text);
        END
      `);
      db.executeSync(`
        CREATE TRIGGER IF NOT EXISTS history_au AFTER UPDATE ON history BEGIN
          INSERT INTO history_fts(history_fts, rowid, transcript, translation_text)
          VALUES ('delete', old.rowid, old.transcript, old.translation_text);
          INSERT INTO history_fts(rowid, transcript, translation_text)
          VALUES (new.rowid, new.transcript, new.translation_text);
        END
      `);
    } catch {
      logger.warn("[db] FTS5 not available, full-text search disabled");
    }

    db.executeSync(`
      CREATE TABLE IF NOT EXISTS outbox (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        user_id TEXT NOT NULL,
        retries INTEGER NOT NULL DEFAULT 0,
        last_attempt INTEGER,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'in_flight', 'dead'))
      )
    `);
    db.executeSync(
      "CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status)",
    );

    db.executeSync("PRAGMA user_version = 1");
  }

  if (currentVersion < 2) {
    db.executeSync("DROP TABLE IF EXISTS store");
    db.executeSync("PRAGMA user_version = 2");
  }

  if (currentVersion < 3) {
    const cols = db.executeSync("PRAGMA table_info(history)") as QueryResult;
    const hasDeleted = (cols.rows ?? []).some((c) => c.name === "deleted");
    if (hasDeleted) {
      db.executeSync("DROP INDEX IF EXISTS idx_history_deleted");
      db.executeSync("ALTER TABLE history DROP COLUMN deleted");
    }
    db.executeSync("PRAGMA user_version = 3");
  }

  if (currentVersion < 4) {
    const cols = db.executeSync("PRAGMA table_info(history)") as QueryResult;
    if (!(cols.rows ?? []).some((c) => c.name === "entry_type")) {
      db.executeSync(
        "ALTER TABLE history ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'transcription'",
      );
      // Backfill: existing rows with a distinct translation and no audio were
      // pure text translations; everything else originated from audio.
      db.executeSync(
        `UPDATE history
         SET entry_type = 'translation'
         WHERE translation_text IS NOT NULL
           AND translation_text != ''
           AND translation_text != transcript
           AND duration = 0`,
      );
    }
    db.executeSync("PRAGMA user_version = 4");
  }
}

function getDb(): DB {
  if (!db) {
    db = open({ name: "ekwe.db" });
    migrate();
  }
  return db;
}

export const Db = {
  transaction: (fn: () => void): void => {
    getDb().executeSync("BEGIN TRANSACTION");
    try {
      fn();
      getDb().executeSync("COMMIT");
    } catch (e) {
      getDb().executeSync("ROLLBACK");
      throw e;
    }
  },

  insertHistory: (row: HistoryRow): void => {
    getDb().executeSync(
      `INSERT OR REPLACE INTO history (id, user_id, source_lang, target_lang, transcript, translation_text,
        transliteration_text, duration, source_app, provider, created_at, entry_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.user_id,
        row.source_lang,
        row.target_lang,
        row.transcript,
        row.translation_text,
        row.transliteration_text,
        row.duration,
        row.source_app,
        row.provider,
        row.created_at,
        row.entry_type ?? "transcription",
      ],
    );
  },

  deleteHistory: (id: string): void => {
    getDb().executeSync("DELETE FROM history WHERE id = ?", [id]);
  },

  /**
   * Finds the existing translation row for the same user, language pair and
   * source text. Used by SyncService.writeHistory to de-duplicate repeated
   * translations of the same text into the same target language: instead of
   * inserting a fresh row, the existing one is updated in place (reusing its
   * id keeps the row's position in history and makes the cloud upsert
   * idempotent). Only text translations (`entry_type = 'translation'`) are
   * considered; re-recording the same audio phrase still creates a new
   * transcription row each time.
   */
  findTranslationByDedupKey: (
    userId: string,
    sourceLang: string,
    targetLang: string,
    transcript: string,
  ): HistoryRow | null => {
    if (!userId) return null;
    const res = getDb().executeSync(
      `SELECT * FROM history
       WHERE user_id = ?
         AND entry_type = 'translation'
         AND source_lang = ?
         AND target_lang = ?
         AND transcript = ?
       ORDER BY created_at DESC LIMIT 1`,
      [userId, sourceLang, targetLang, transcript],
    ) as QueryResult;
    return (res.rows?.[0] as unknown as HistoryRow) ?? null;
  },

  /**
   * Updates a translation row in place, keeping its original id and created_at
   * (so the entry doesn't jump to the top of history when it's re-translated).
   */
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
    getDb().executeSync(
      `UPDATE history
       SET translation_text = ?, transliteration_text = ?, duration = ?,
           source_app = ?, provider = ?
       WHERE id = ?`,
      [
        row.translation_text,
        row.transliteration_text,
        row.duration,
        row.source_app,
        row.provider,
        id,
      ],
    );
  },

  getRecentHistory: (userId: string, limit: number = 200): HistoryRow[] => {
    if (!userId) return [];
    const res = getDb().executeSync(
      "SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
      [userId, limit],
    ) as QueryResult;
    return (res.rows ?? []) as unknown as HistoryRow[];
  },

  getHistoryPage: (
    userId: string,
    limit: number,
    before: { created_at: string; id: string } | null,
  ): HistoryRow[] => {
    if (!userId) return [];
    // Cursor-based (created_at, id) paging instead of OFFSET. Cloud pulls
    // insert rows into SQLite, which would shift offsets and cause
    // skipped/duplicated rows in the caller's list.
    const res = before
      ? getDb().executeSync(
          `SELECT * FROM history WHERE user_id = ?
             AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC LIMIT ?`,
          [userId, before.created_at, before.created_at, before.id, limit],
        )
      : getDb().executeSync(
          "SELECT * FROM history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
          [userId, limit],
        );
    return (res.rows ?? []) as unknown as HistoryRow[];
  },

  searchHistory: (
    userId: string,
    query: string,
    limit: number = 100,
  ): HistoryRow[] => {
    if (!userId) return [];
    const ftsQuery = query
      .replace(/['"]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w}"`)
      .join(" AND ");
    if (!ftsQuery) return [];
    try {
      const res = getDb().executeSync(
        `SELECT h.* FROM history h
         INNER JOIN history_fts fts ON h.rowid = fts.rowid
         WHERE h.user_id = ? AND history_fts MATCH ?
         ORDER BY h.created_at DESC
         LIMIT ?`,
        [userId, ftsQuery, limit],
      ) as QueryResult;
      return (res.rows ?? []) as unknown as HistoryRow[];
    } catch {
      const likeQuery = `%${query.replace(/['"]/g, "")}%`;
      const res = getDb().executeSync(
        `SELECT * FROM history WHERE user_id = ? AND (transcript LIKE ? OR translation_text LIKE ?)
         ORDER BY created_at DESC LIMIT ?`,
        [userId, likeQuery, likeQuery, limit],
      ) as QueryResult;
      return (res.rows ?? []) as unknown as HistoryRow[];
    }
  },

  cleanupExpiredHistory: (ttlDays: number): number => {
    // julianday() parses both ISO-8601 ('T' separator, as stored) and
    // SQLite space-separated timestamps, so the comparison is format-agnostic
    // — a lexicographic compare against datetime("now", ...) would skew rows
    // created on the boundary day.
    const res = getDb().executeSync(
      "DELETE FROM history WHERE julianday(created_at) < julianday('now', ?)",
      [`-${ttlDays} days`],
    ) as QueryResult;
    return res.rowsAffected ?? 0;
  },

  insertOutbox: (
    row: Omit<OutboxRow, "retries" | "last_attempt" | "status">,
  ): void => {
    getDb().executeSync(
      `INSERT OR REPLACE INTO outbox (id, payload, user_id, retries, last_attempt, created_at, status)
       VALUES (?, ?, ?, 0, NULL, ?, 'pending')`,
      [row.id, row.payload, row.user_id, row.created_at],
    );
  },

  deleteOutbox: (id: string): void => {
    getDb().executeSync("DELETE FROM outbox WHERE id = ?", [id]);
  },

  /** Removes all outbox rows that reference a history entry (by outbox id or payload id). */
  deleteOutboxForHistory: (id: string): void => {
    getDb().executeSync(
      `DELETE FROM outbox WHERE id = ? OR payload LIKE '%"id":"' || ? || '"%'`,
      [id, id],
    );
  },

  /**
   * Pending outbox rows for a single user that are due for a retry. Scoping by
   * user_id prevents one account's session from draining another account's
   * unsynced rows (which RLS blocks server-side anyway, stranding them until
   * they go dead). Rows whose last attempt was < OUTBOX_RETRY_BACKOFF_MS ago
   * are skipped so a flaky network can't burn all 5 retries in seconds.
   */
  getPendingOutbox: (userId: string): OutboxRow[] => {
    if (!userId) return [];
    const res = getDb().executeSync(
      "SELECT * FROM outbox WHERE user_id = ? AND status = 'pending' AND retries < 5 AND (last_attempt IS NULL OR last_attempt <= ?) ORDER BY created_at ASC",
      [userId, Date.now() - OUTBOX_RETRY_BACKOFF_MS],
    ) as QueryResult;
    return (res.rows ?? []) as unknown as OutboxRow[];
  },

  /** Number of outbox rows that exhausted their retries for a user. */
  countDeadOutbox: (userId: string): number => {
    if (!userId) return 0;
    const res = getDb().executeSync(
      "SELECT COUNT(*) AS count FROM outbox WHERE user_id = ? AND status = 'dead'",
      [userId],
    ) as QueryResult;
    return (res.rows?.[0]?.count as number) ?? 0;
  },

  incrementOutboxRetry: (id: string): void => {
    getDb().executeSync(
      "UPDATE outbox SET retries = retries + 1, last_attempt = ?, status = CASE WHEN retries + 1 >= 5 THEN ? ELSE ? END WHERE id = ?",
      [Date.now(), "dead", "pending", id],
    );
  },

  markOutboxInFlight: (id: string): void => {
    getDb().executeSync("UPDATE outbox SET status = 'in_flight' WHERE id = ?", [
      id,
    ]);
  },

  /**
   * Resurrects outbox rows stuck in a terminal-ish state so they get retried
   * instead of being lost forever:
   *   * `dead`     — hit 5 failed pushes; previously purged after 7 days, which
   *                 silently deleted the user's unsynced history row.
   *   * `in_flight`— the app died between marking the row in-flight and the
   *                 push completing; without revival it would never retry.
   * Upserts are idempotent, so retrying a stale row is always safe.
   */
  reviveOutbox: (): number => {
    const res = getDb().executeSync(
      "UPDATE outbox SET status = 'pending', retries = 0 WHERE status IN ('dead', 'in_flight')",
    ) as QueryResult;
    return res.rowsAffected ?? 0;
  },

  /** Removes every history row (used when the account is deleted or cleared). */
  purgeAllHistory: (): void => {
    getDb().executeSync("DELETE FROM history");
  },

  /** Removes every outbox row (used when the account is deleted or cleared). */
  purgeAllOutbox: (): void => {
    getDb().executeSync("DELETE FROM outbox");
  },

  vacuum: (): void => {
    getDb().executeSync("PRAGMA incremental_vacuum");
  },
};

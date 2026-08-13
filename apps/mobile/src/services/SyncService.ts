import { observable } from "@legendapp/state";
import * as Crypto from "expo-crypto";

import { Db } from "./db";
import { mmkv as storage } from "./mmkv";

import { supabase } from "@/services/supabase";
import { EntryType, HistoryEntry, history$, auth$ } from "@/store";
import { logger } from "@/utils";
import { checkIsOnline, subscribeToNetwork } from "@/utils/netInfo";
import { HISTORY_LOCAL_TTL_DAYS } from "@/constants/retention";

const INITIAL_HISTORY_SIZE = 20;
const MAX_HISTORY_CACHE = 1000;

class SyncServiceClass {
  private unsubscribeNetInfo: (() => void) | null = null;
  private isDraining = false;

  pendingCount = observable(0);
  /** Set when the last cloud pull failed; cleared on the next successful one. */
  pullError = observable<string | null>(null);

  async writeHistory(
    payload: {
      sourceLang: string;
      targetLang: string;
      transcript: string;
      translation: string | null;
      transliteration: string | null;
      duration: number;
      sourceApp: string;
      provider: string;
      type: EntryType;
    },
    userId: string,
  ): Promise<string> {
    const id = Crypto.randomUUID();
    const created_at = new Date().toISOString();

    Db.transaction(() => {
      Db.insertHistory({
        id,
        user_id: userId,
        source_lang: payload.sourceLang,
        target_lang: payload.targetLang,
        transcript: payload.transcript,
        translation_text: payload.translation || null,
        transliteration_text: payload.transliteration || null,
        duration: payload.duration,
        source_app: payload.sourceApp,
        provider: payload.provider,
        created_at,
        entry_type: payload.type,
      });

      Db.insertOutbox({
        id,
        payload: JSON.stringify({
          action: "upsert",
          type: payload.type,
          source_lang: payload.sourceLang,
          target_lang: payload.targetLang,
          transcript: payload.transcript,
          translation_text: payload.translation || null,
          transliteration_text: payload.transliteration || null,
          duration: payload.duration,
          source_app: payload.sourceApp,
          provider: payload.provider,
          created_at,
        }),
        user_id: userId,
        created_at,
      });
    });

    const entry: HistoryEntry = {
      id,
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang,
      transcript: payload.transcript,
      translation: payload.translation || null,
      transliteration: payload.transliteration || null,
      duration: payload.duration,
      sourceApp: payload.sourceApp,
      provider: payload.provider,
      timestamp: Date.now(),
      type: payload.type,
    };
    history$[id].set(entry);
    this.trimHistoryWindow();
    this.refreshPendingCount();

    this.pushToCloud(id).catch((err) =>
      logger.error("[Sync] pushToCloud failed", id, err),
    );

    return id;
  }

  async deleteHistory(id: string, userId: string): Promise<void> {
    const created_at = new Date().toISOString();
    Db.transaction(() => {
      Db.deleteHistory(id);
      Db.insertOutbox({
        id: Crypto.randomUUID(),
        payload: JSON.stringify({
          action: "delete",
          id,
        }),
        user_id: userId,
        created_at,
      });
    });

    history$[id].delete();
    this.refreshPendingCount();

    this.drain().catch((err) =>
      logger.error("[Sync] drain after delete failed", err),
    );
  }

  async restoreHistory(entry: HistoryEntry, userId: string): Promise<void> {
    const created_at = new Date(entry.timestamp).toISOString();
    const payload = {
      type: entry.type ?? "transcription",
      source_lang: entry.sourceLang,
      target_lang: entry.targetLang,
      transcript: entry.transcript,
      translation_text: entry.translation ?? null,
      transliteration_text: entry.transliteration ?? null,
      duration: entry.duration,
      source_app: entry.sourceApp ?? "",
      provider: entry.provider ?? "",
      created_at,
    };

    Db.transaction(() => {
      Db.deleteOutboxForHistory(entry.id);
      Db.insertHistory({
        id: entry.id,
        user_id: userId,
        ...payload,
        entry_type: payload.type,
      });
      Db.insertOutbox({
        id: entry.id,
        payload: JSON.stringify({ action: "upsert", ...payload }),
        user_id: userId,
        created_at,
      });
    });

    history$[entry.id].set(entry);
    this.refreshPendingCount();

    this.pushToCloud(entry.id).catch((err) =>
      logger.error("[Sync] pushToCloud for restore failed", entry.id, err),
    );
  }

  /**
   * Purges every local history + outbox row and clears the in-memory cache.
   * Does not touch the cloud — used by account deletion, where the cloud is
   * already wiped via the delete_user cascade.
   */
  purgeLocalHistory(): void {
    try {
      Db.transaction(() => {
        Db.purgeAllHistory();
        Db.purgeAllOutbox();
      });
      history$.set({});
      this.refreshPendingCount();
      logger.info("[Sync] Purged local history + outbox");
    } catch (err) {
      logger.error("[Sync] purgeLocalHistory failed", err);
    }
  }

  /**
   * Clears ALL of the user's history — local SQLite, in-memory cache, and
   * cloud (via a queued "delete_all" outbox row, so it also works offline).
   */
  async clearAllHistory(userId: string): Promise<void> {
    try {
      Db.transaction(() => {
        Db.purgeAllHistory();
        Db.purgeAllOutbox();
        Db.insertOutbox({
          id: Crypto.randomUUID(),
          payload: JSON.stringify({ action: "delete_all" }),
          user_id: userId,
          created_at: new Date().toISOString(),
        });
      });
      history$.set({});
      this.refreshPendingCount();
      this.drain().catch((err) =>
        logger.error("[Sync] drain after clear all failed", err),
      );
    } catch (err) {
      logger.error("[Sync] clearAllHistory failed", err);
      throw err;
    }
  }

  private async pushToCloud(id: string): Promise<void> {
    try {
      const rows = Db.getPendingOutbox();
      const row = rows.find((r) => r.id === id);
      if (!row) return;

      Db.markOutboxInFlight(id);

      const payload = JSON.parse(row.payload);

      if (payload.action === "delete") {
        const targetId = payload.id || row.id;
        const { error } = await supabase
          .from("history")
          .delete()
          .eq("id", targetId);
        if (error) throw error;
      } else if (payload.action === "delete_all") {
        const { error } = await supabase
          .from("history")
          .delete()
          .eq("user_id", row.user_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("history").upsert({
          id: row.id,
          user_id: row.user_id,
          type: payload.type ?? "transcription",
          source_lang: payload.source_lang,
          target_lang: payload.target_lang,
          transcript: payload.transcript,
          translation_text: payload.translation_text,
          transliteration_text: payload.transliteration_text,
          duration: payload.duration,
          source_app: payload.source_app,
          provider: payload.provider,
          created_at: payload.created_at,
        });
        if (error) throw error;
      }

      Db.deleteOutbox(id);
      logger.info("[Sync] Pushed entry/delete to cloud", id);
    } catch (err) {
      Db.incrementOutboxRetry(id);
      logger.error("[Sync] Push failed for entry", id, err);
    }
    this.refreshPendingCount();
  }

  async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      const online = await checkIsOnline();
      if (!online) return;

      const entries = Db.getPendingOutbox();
      if (entries.length === 0) return;

      logger.info("[Sync] Draining", entries.length, "pending entries");

      for (const entry of entries) {
        await this.pushToCloud(entry.id);
      }
    } finally {
      this.isDraining = false;
      this.refreshPendingCount();
    }
  }

  async pullFromCloud(userId: string): Promise<void> {
    try {
      this.pullError.set(null);
      const lastSyncKey = `last-sync-${userId}`;
      const stored = storage.getString(lastSyncKey);

      // Composite (created_at, id) cursor. created_at is ISO-8601 and ids are
      // UUIDs, so lexicographic ordering is consistent. A composite cursor
      // means rows that share a created_at value are never skipped at a page
      // boundary (a bare created_at cursor could drop a same-millisecond row).
      let cursor: { created_at: string; id: string } | null = null;
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as {
            created_at: string;
            id: string;
          };
          if (parsed?.created_at && parsed?.id) cursor = parsed;
        } catch {
          // Legacy value was a bare ISO string (or corrupt): force a full pull.
          cursor = null;
        }
      }

      const COLUMNS =
        "id, user_id, source_lang, target_lang, transcript, translation_text, transliteration_text, duration, source_app, provider, created_at, type";

      type CloudRow = {
        id: string;
        user_id: string;
        created_at: string;
        source_lang: string;
        target_lang: string;
        transcript: string;
        translation_text: string | null;
        transliteration_text: string | null;
        duration: number;
        source_app: string | null;
        provider: string | null;
        type: EntryType | null;
      };

      // Pull in ascending (created_at, id) order, bounded by the cursor, one
      // page at a time. Without pagination a user with >200 cloud rows would
      // only ever sync the 200 newest: the old code set the cursor to the
      // newest row and later pulls asked for rows newer than that, so older
      // rows were silently never fetched on a fresh device.
      const rows: CloudRow[] = [];

      for (;;) {
        let query = supabase
          .from("history")
          .select(COLUMNS)
          .eq("user_id", userId)
          .order("created_at", { ascending: true })
          .limit(200);

        if (cursor) {
          query = query.or(
            `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
          );
        }

        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;

        rows.push(...(data as CloudRow[]));

        const newest = data[data.length - 1];
        cursor = { created_at: newest.created_at, id: newest.id };

        if (data.length < 200) break;
      }

      if (rows.length === 0) return;

      for (const row of rows) {
        Db.insertHistory({
          id: row.id,
          user_id: row.user_id,
          source_lang: row.source_lang,
          target_lang: row.target_lang,
          transcript: row.transcript,
          translation_text: row.translation_text,
          transliteration_text: row.transliteration_text,
          duration: row.duration || 0,
          source_app: row.source_app || "",
          provider: row.provider || "",
          created_at: row.created_at,
          entry_type: row.type || "transcription",
        });

        if (!history$[row.id].get()) {
          history$[row.id].set({
            id: row.id,
            sourceLang: row.source_lang,
            targetLang: row.target_lang,
            transcript: row.transcript,
            translation: row.translation_text,
            transliteration: row.transliteration_text,
            duration: row.duration || 0,
            sourceApp: row.source_app || "",
            provider: row.provider || "",
            timestamp: new Date(row.created_at).getTime(),
            type: row.type || "transcription",
          });
        }
      }

      // Persist the newest synced row as the incremental cursor for next time.
      const newest = rows[rows.length - 1];
      storage.set(
        lastSyncKey,
        JSON.stringify({ created_at: newest.created_at, id: newest.id }),
      );

      this.trimHistoryWindow();
      logger.info("[Sync] Pulled", rows.length, "entries from cloud");
    } catch (err) {
      // Surface the failure so the history screen can show a sync banner
      // instead of silently degrading (e.g. a missing remote column).
      this.pullError.set(err instanceof Error ? err.message : String(err));
      logger.error("[Sync] Pull from cloud failed", err);
    }
  }

  /** Removes observable entries that are older than `days` (mirrors the SQLite TTL). */
  private pruneObservableExpired(days: number): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const record = history$.get() || {};
    for (const key of Object.keys(record)) {
      if (record[key].timestamp < cutoff) {
        history$[key].delete();
      }
    }
  }

  private trimHistoryWindow(): void {
    const allKeys = Object.keys(history$.get() || {});
    if (allKeys.length > MAX_HISTORY_CACHE) {
      const sorted = allKeys
        .map((k) => ({ key: k, ts: history$[k].timestamp.get() || 0 }))
        .sort((a, b) => b.ts - a.ts);
      const toRemove = sorted.slice(MAX_HISTORY_CACHE);
      for (const { key } of toRemove) {
        history$[key].delete();
      }
    }
  }

  private refreshPendingCount(): void {
    const count = Db.getPendingOutbox().length;
    this.pendingCount.set(count);
  }

  loadInitialHistory(userId?: string): void {
    history$.set({});
    if (!userId) return;
    const rows = Db.getRecentHistory(userId, INITIAL_HISTORY_SIZE);
    for (const row of rows) {
      history$[row.id].set({
        id: row.id,
        sourceLang: row.source_lang,
        targetLang: row.target_lang,
        transcript: row.transcript,
        translation: row.translation_text,
        transliteration: row.transliteration_text,
        duration: row.duration,
        sourceApp: row.source_app,
        provider: row.provider,
        timestamp: new Date(row.created_at).getTime(),
        type: row.entry_type ?? "transcription",
      });
    }
    this.refreshPendingCount();
  }

  async start(): Promise<void> {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;

    // Clean up BEFORE seeding the observable so the UI never shows rows that
    // no longer exist on disk.
    const expired = Db.cleanupExpiredHistory(HISTORY_LOCAL_TTL_DAYS);
    if (expired > 0) {
      logger.info("[Sync] Cleaned up", expired, "expired local history rows");
      this.pruneObservableExpired(HISTORY_LOCAL_TTL_DAYS);
    }
    const currentUserId = auth$.user.get()?.id;
    this.loadInitialHistory(currentUserId);

    const dead = Db.cleanupDeadOutbox();
    if (dead > 0) logger.info("[Sync] Cleaned up", dead, "dead outbox rows");

    this.unsubscribeNetInfo = subscribeToNetwork((isOnline) => {
      if (isOnline) {
        this.drain().catch((err) =>
          logger.error("[Sync] drain on network change failed", err),
        );
      }
    });

    // initAuth() already recovers the session from SecureStore and notifies
    // SyncService via onUserSignedIn on SIGNED_IN — no duplicate subscription needed
  }

  onUserSignedIn(userId: string): void {
    this.loadInitialHistory(userId);
    this.pullFromCloud(userId).catch((err) =>
      logger.error("[Sync] onUserSignedIn pullFromCloud failed", err),
    );
    this.drain().catch((err) =>
      logger.error("[Sync] onUserSignedIn drain failed", err),
    );
  }

  stop(): void {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }
}

export const SyncService = new SyncServiceClass();

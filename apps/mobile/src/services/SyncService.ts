import { observable } from "@legendapp/state";
import * as Crypto from "expo-crypto";

import { Db } from "./db";
import { mmkv as storage } from "./mmkv";
import {
  buildDeleteAllOutboxPayload,
  buildDeleteOutboxPayload,
  buildUpsertOutboxPayload,
  parseSyncCursor,
} from "./outboxPayload";

import { supabase } from "@/services/supabase";
import { EntryType, HistoryEntry, history$, auth$ } from "@/store";
import { logger } from "@/utils";
import { checkIsOnline, subscribeToNetwork } from "@/utils/netInfo";
import { HISTORY_LOCAL_TTL_DAYS } from "@/constants/retention";

const INITIAL_HISTORY_SIZE = 20;
const MAX_HISTORY_CACHE = 1000;
/** How often to re-run local TTL cleanup while the app session stays alive. */
const LOCAL_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const CLOUD_COLUMNS =
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

class SyncServiceClass {
  private unsubscribeNetInfo: (() => void) | null = null;
  private isDraining = false;
  private drainTimeout: NodeJS.Timeout | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Set when the last cloud pull failed; cleared on the next successful one. */
  pullError = observable<string | null>(null);

  /** Outbox rows that exhausted their retries and haven't synced. */
  deadCount = observable(0);

  private refreshDeadCount(): void {
    this.deadCount.set(Db.countDeadOutbox(auth$.user.get()?.id ?? ""));
  }

  /**
   * Resurrect rows stuck in `dead` (exhausted retries) and retry them now.
   * Upserts are idempotent, so retrying is always safe.
   */
  retryDeadOutbox(): Promise<void> {
    const revived = Db.reviveDeadOutbox();
    if (revived > 0) {
      logger.info("[Sync] Retrying", revived, "dead outbox rows");
    }
    return this.drain().finally(() => this.refreshDeadCount());
  }

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
    if (payload.type === "translation") {
      const existing = Db.findTranslationByDedupKey(
        userId,
        payload.sourceLang,
        payload.targetLang,
        payload.transcript,
      );
      if (existing) {
        Db.transaction(() => {
          Db.updateTranslationRow(existing.id, {
            translation_text: payload.translation || null,
            transliteration_text: payload.transliteration || null,
            duration: payload.duration,
            source_app: payload.sourceApp,
            provider: payload.provider,
          });
          Db.insertOutbox({
            id: existing.id,
            payload: buildUpsertOutboxPayload(
              payload.type,
              {
                sourceLang: payload.sourceLang,
                targetLang: payload.targetLang,
                transcript: payload.transcript,
                translation: payload.translation,
                transliteration: payload.transliteration,
                duration: payload.duration,
                sourceApp: payload.sourceApp,
                provider: payload.provider,
              },
              existing.createdAt,
            ),
            userId: userId,
            createdAt: existing.createdAt,
          });
        });

        history$[existing.id].set({
          id: existing.id,
          sourceLang: payload.sourceLang,
          targetLang: payload.targetLang,
          transcript: payload.transcript,
          translation: payload.translation || null,
          transliteration: payload.transliteration || null,
          duration: payload.duration,
          sourceApp: payload.sourceApp,
          provider: payload.provider,
          timestamp: Date.parse(existing.createdAt),
          type: "translation",
        });

        this.pushToCloud(existing.id, userId).catch((err) =>
          logger.error(
            "[Sync] pushToCloud (dedup update) failed",
            existing.id,
            err,
          ),
        );

        return existing.id;
      }
    }

    const id = Crypto.randomUUID();
    const created_at = new Date().toISOString();

    Db.transaction(() => {
      Db.insertHistory({
        id,
        userId: userId,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        transcript: payload.transcript,
        translationText: payload.translation || null,
        transliterationText: payload.transliteration || null,
        duration: payload.duration,
        sourceApp: payload.sourceApp,
        provider: payload.provider,
        createdAt: created_at,
        entryType: payload.type,
      });

      Db.insertOutbox({
        id,
        payload: buildUpsertOutboxPayload(
          payload.type,
          {
            sourceLang: payload.sourceLang,
            targetLang: payload.targetLang,
            transcript: payload.transcript,
            translation: payload.translation,
            transliteration: payload.transliteration,
            duration: payload.duration,
            sourceApp: payload.sourceApp,
            provider: payload.provider,
          },
          created_at,
        ),
        userId: userId,
        createdAt: created_at,
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

    this.scheduleDrain();

    return id;
  }

  async deleteHistory(id: string, userId: string): Promise<void> {
    const created_at = new Date().toISOString();
    Db.transaction(() => {
      Db.deleteHistory(id);
      Db.insertOutbox({
        id: Crypto.randomUUID(),
        payload: buildDeleteOutboxPayload(id),
        userId: userId,
        createdAt: created_at,
      });
    });

    history$[id].delete();

    this.scheduleDrain();
  }

  async restoreHistory(entry: HistoryEntry, userId: string): Promise<void> {
    const created_at = new Date(entry.timestamp).toISOString();
    const type = entry.type ?? "transcription";

    Db.transaction(() => {
      Db.deleteOutboxForHistory(entry.id);
      Db.insertHistory({
        id: entry.id,
        userId: userId,
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
        transcript: entry.transcript,
        translationText: entry.translation ?? null,
        transliterationText: entry.transliteration ?? null,
        duration: entry.duration,
        sourceApp: entry.sourceApp ?? "",
        provider: entry.provider ?? "",
        createdAt: created_at,
        entryType: type,
      });
      Db.insertOutbox({
        id: entry.id,
        payload: buildUpsertOutboxPayload(
          type,
          {
            sourceLang: entry.sourceLang,
            targetLang: entry.targetLang,
            transcript: entry.transcript,
            translation: entry.translation ?? null,
            transliteration: entry.transliteration ?? null,
            duration: entry.duration,
            sourceApp: entry.sourceApp ?? "",
            provider: entry.provider ?? "",
          },
          created_at,
        ),
        userId: userId,
        createdAt: created_at,
      });
    });

    history$[entry.id].set(entry);

    this.pushToCloud(entry.id, userId).catch((err) =>
      logger.error("[Sync] pushToCloud for restore failed", entry.id, err),
    );
  }

  purgeLocalHistory(userId: string): void {
    try {
      Db.transaction(() => {
        Db.purgeUserHistory(userId);
        Db.purgeUserOutbox(userId);
      });
      history$.set({});
      logger.info("[Sync] Purged local history + outbox for user", userId);
    } catch (err) {
      logger.error("[Sync] purgeLocalHistory failed", err);
    }
  }

  clearSyncCursor(userId: string): void {
    storage.remove(`last-sync-${userId}`);
  }

  async clearAllHistory(userId: string): Promise<void> {
    try {
      Db.transaction(() => {
        Db.purgeUserHistory(userId);
        Db.purgeUserOutbox(userId);
        Db.insertOutbox({
          id: Crypto.randomUUID(),
          payload: buildDeleteAllOutboxPayload(),
          userId: userId,
          createdAt: new Date().toISOString(),
        });
      });
      history$.set({});
      this.scheduleDrain();
    } catch (err) {
      logger.error("[Sync] clearAllHistory failed", err);
      throw err;
    }
  }

  scheduleDrain(): void {
    if (this.drainTimeout) clearTimeout(this.drainTimeout);
    this.drainTimeout = setTimeout(() => {
      this.drainTimeout = null;
      this.drain().catch((err) =>
        logger.error("[Sync] Scheduled drain failed", err),
      );
    }, 500);
  }

  private async pushToCloud(id: string, userId: string): Promise<void> {
    // Legacy single-row push method. Kept for dedup updates and restore.
    try {
      const online = await checkIsOnline();
      if (!online) return;

      const rows = Db.getPendingOutbox(userId);
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
          .eq("user_id", row.userId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("history").upsert({
          id: row.id,
          user_id: row.userId,
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
      this.refreshDeadCount();
      logger.error("[Sync] Push failed for entry", id, err);
    }
  }

  async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;

    try {
      const userId = auth$.user.get()?.id;
      if (!userId) return;

      const online = await checkIsOnline();
      if (!online) return;

      const entries = Db.getPendingOutbox(userId);
      if (entries.length === 0) return;

      logger.info(
        "[Sync] Draining",
        entries.length,
        "pending entries (batching)",
      );

      const toUpsert = [];
      const toDelete = [];
      let deleteAll = false;

      for (const entry of entries) {
        Db.markOutboxInFlight(entry.id);
        try {
          const payload = JSON.parse(entry.payload);
          if (payload.action === "delete_all") {
            deleteAll = true;
          } else if (payload.action === "delete") {
            toDelete.push(payload.id || entry.id);
          } else {
            toUpsert.push({
              id: entry.id,
              user_id: entry.userId,
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
          }
        } catch (e) {
          logger.error("[Sync] Invalid payload in outbox", entry.id, e);
          Db.incrementOutboxRetry(entry.id);
        }
      }

      // Execute batch operations
      if (deleteAll) {
        const { error } = await supabase
          .from("history")
          .delete()
          .eq("user_id", userId);
        if (error) throw error;
      }

      if (toDelete.length > 0) {
        const { error } = await supabase
          .from("history")
          .delete()
          .in("id", toDelete);
        if (error) throw error;
      }

      if (toUpsert.length > 0) {
        const { error } = await supabase.from("history").upsert(toUpsert);
        if (error) throw error;
      }

      // Clean up successfully synced entries
      for (const entry of entries) {
        Db.deleteOutbox(entry.id);
      }
      logger.info(
        "[Sync] Batch pushed",
        toUpsert.length,
        "upserts,",
        toDelete.length,
        "deletes.",
      );
    } catch (err) {
      logger.error("[Sync] Batch drain failed", err);
      const entries = Db.getPendingOutbox(auth$.user.get()?.id ?? "");
      for (const entry of entries) {
        if (entry.status === "in_flight") {
          Db.incrementOutboxRetry(entry.id);
        }
      }
    } finally {
      this.isDraining = false;
      this.refreshDeadCount();
    }
  }

  async pullFromCloud(userId: string): Promise<void> {
    try {
      this.pullError.set(null);
      const lastSyncKey = `last-sync-${userId}`;
      const stored = storage.getString(lastSyncKey);

      let cursor = parseSyncCursor(stored);
      const rows: CloudRow[] = [];

      for (;;) {
        let query = supabase
          .from("history")
          .select(CLOUD_COLUMNS)
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

      // Only cache the local retention window to SQLite/observables. Older
      // rows remain cloud-only and are paged in on demand via
      // fetchOlderHistory, so a fresh install doesn't bulk-load years of
      // history into the device DB.
      const ttlCutoff =
        Date.now() - HISTORY_LOCAL_TTL_DAYS * 24 * 60 * 60 * 1000;

      for (const row of rows) {
        if (new Date(row.created_at).getTime() < ttlCutoff) {
          continue;
        }

        Db.insertHistory({
          id: row.id,
          userId: row.user_id,
          sourceLang: row.source_lang,
          targetLang: row.target_lang,
          transcript: row.transcript,
          translationText: row.translation_text,
          transliterationText: row.transliteration_text,
          duration: row.duration || 0,
          sourceApp: row.source_app || "",
          provider: row.provider || "",
          createdAt: row.created_at,
          entryType: row.type || "transcription",
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
        } else {
          // Conflict detection: only overwrite if local has no un-synced edits
          const pending = Db.getPendingOutbox(userId).find(
            (r) => r.id === row.id,
          );
          if (!pending) {
            history$[row.id].set({
              ...history$[row.id].get(),
              translation: row.translation_text,
              transliteration: row.transliteration_text,
            });
            Db.updateTranslationRow(row.id, {
              translation_text: row.translation_text,
              transliteration_text: row.transliteration_text,
              duration: row.duration || 0,
              source_app: row.source_app || "",
              provider: row.provider || "",
            });
          }
        }
      }

      const newest = rows[rows.length - 1];
      storage.set(
        lastSyncKey,
        JSON.stringify({ created_at: newest.created_at, id: newest.id }),
      );

      this.trimHistoryWindow();
      logger.info("[Sync] Pulled", rows.length, "entries from cloud");
    } catch (err) {
      this.pullError.set(err instanceof Error ? err.message : String(err));
      logger.error(
        "[Sync] Pull from cloud failed",
        err instanceof Error ? err : JSON.stringify(err),
      );
    }
  }

  async fetchOlderHistory(
    userId: string,
    before: { created_at: string; id: string } | null,
    limit: number,
  ): Promise<HistoryEntry[]> {
    try {
      let query = supabase
        .from("history")
        .select(CLOUD_COLUMNS)
        .eq("user_id", userId);

      // A null cursor means "newest page" (fresh-install cold start with an
      // empty local window) — only keyset-filter when we're paging older.
      if (before) {
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      }

      const { data, error } = await query
        // Keyset order must use BOTH cursor keys (id breaks ties on identical
        // created_at) so the composite cursor matches the cloud row order.
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data ?? []).map((row: CloudRow) => ({
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
      }));
    } catch (err) {
      logger.error("[Sync] fetchOlderHistory failed", err);
      return [];
    }
  }

  private pruneObservableExpired(days: number): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const record = history$.get() || {};
    for (const key of Object.keys(record)) {
      if (record[key].timestamp < cutoff) {
        history$[key].delete();
      }
    }
  }

  /**
   * Purge rows that aged past the local TTL (scoped to the active user so a
   * shared device never deletes another user's rows). Skips rows that still
   * have an un-synced outbox entry — those are the user's only local copy
   * until a drain succeeds. Keeps SQLite + observable in sync.
   */
  private runLocalCleanup(): void {
    const userId = auth$.user.get()?.id;
    const expired = Db.cleanupExpiredHistory(HISTORY_LOCAL_TTL_DAYS, userId);
    if (expired > 0) {
      logger.info("[Sync] Cleaned up", expired, "expired local history rows");
      this.pruneObservableExpired(HISTORY_LOCAL_TTL_DAYS);
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

  loadInitialHistory(userId?: string): void {
    history$.set({});
    if (!userId) return;
    const rows = Db.getRecentHistory(userId, INITIAL_HISTORY_SIZE);
    for (const row of rows) {
      history$[row.id].set({
        id: row.id,
        sourceLang: row.sourceLang,
        targetLang: row.targetLang,
        transcript: row.transcript,
        translation: row.translationText,
        transliteration: row.transliterationText,
        duration: row.duration,
        sourceApp: row.sourceApp,
        provider: row.provider,
        timestamp: new Date(row.createdAt).getTime(),
        type: (row.entryType as EntryType) ?? "transcription",
      });
    }
  }

  async start(): Promise<void> {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    this.clearCleanupTimer();

    this.runLocalCleanup();

    const currentUserId = auth$.user.get()?.id;
    this.loadInitialHistory(currentUserId);

    const revived = Db.reviveInFlight();
    this.refreshDeadCount();
    if (revived > 0) {
      logger.info(
        "[Sync] Revived",
        revived,
        "in-flight outbox rows (crash recovery)",
      );
      this.scheduleDrain();
    }

    this.unsubscribeNetInfo = subscribeToNetwork((isOnline) => {
      if (isOnline) {
        this.scheduleDrain();
      }
    });

    // Local retention is TTL-based; enforce it periodically so rows that age
    // past 7 days get purged in long-running sessions too (not just at launch).
    this.cleanupTimer = setInterval(() => {
      this.runLocalCleanup();
    }, LOCAL_CLEANUP_INTERVAL_MS);
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
    this.clearCleanupTimer();
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

export const SyncService = new SyncServiceClass();

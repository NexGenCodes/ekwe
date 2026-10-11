/**
 * CloudSync — handles pulling data from the cloud and paginating older history.
 */

import { batch, observable } from "@legendapp/state";
import { mmkv as storage } from "@/services/mmkv";
import { supabase } from "@/services/supabase";
import { history$ } from "@/store";
import { Db } from "@/services/db";
import { cloudRowToEntry } from "@/services/historyMapper";
import { logger } from "@/utils";
import { HISTORY_LOCAL_TTL_DAYS } from "@/constants/retention";
import { parseSyncCursor } from "@/services/outboxPayload";

import {
  type CloudRow,
  CLOUD_COLUMNS,
  toError,
  readOutboxActionId,
  MAX_HISTORY_CACHE,
} from "./shared";
import type { HistoryEntry } from "@/store";

export class CloudSync {
  pullError = observable<string | null>(null);

  async pullFromCloud(userId: string): Promise<void> {
    try {
      this.pullError.set(null);
      const lastSyncKey = `last-sync-${userId}`;
      const stored = storage.getString(lastSyncKey);

      let cursor = parseSyncCursor(stored);
      let totalPulled = 0;

      for (;;) {
        let query = supabase
          .from("history")
          .select(CLOUD_COLUMNS)
          .eq("user_id", userId)
          // Exclude tombstones to prevent resurrecting deleted rows locally.
          .is("deleted_at", null)
          .order("created_at", { ascending: true })
          .limit(200);

        if (cursor) {
          query = query.or(
            `created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id})`,
          );
        }

        const { data, error } = await query;
        if (error) throw toError(error);
        if (!data || data.length === 0) break;

        const ttlCutoff =
          Date.now() - HISTORY_LOCAL_TTL_DAYS * 24 * 60 * 60 * 1000;

        // Track unacknowledged history IDs to prevent overwriting pending local edits.
        const pendingIds = new Set<string>();
        for (const r of Db.getUnacknowledgedOutbox(userId)) {
          pendingIds.add(r.id);
          const target = readOutboxActionId(r.payload);
          if (target.action === "delete" && target.id)
            pendingIds.add(target.id);
        }

        batch(() => {
          for (const row of data as CloudRow[]) {
            if (new Date(row.created_at).getTime() < ttlCutoff) {
              continue;
            }

            const entry = cloudRowToEntry(row);
            const pending = pendingIds.has(row.id);

            if (pending) continue;

            Db.insertHistory({
              id: entry.id,
              userId: row.user_id,
              captureId: entry.captureId,
              origin: entry.origin,
              input: entry.input,
              sourceLang: entry.sourceLang,
              targetLang: entry.targetLang,
              transcript: entry.transcript,
              translationText: entry.translation,
              transliterationText: entry.transliteration,
              duration: entry.duration,
              sourceApp: entry.sourceApp ?? "",
              voiceId: entry.voiceId,
              sttProvider: entry.sttProvider,
              mtProvider: entry.mtProvider,
              createdAt: row.created_at,
              entryType: entry.type ?? "transcription",
              revision: row.revision ?? 0,
            });

            if (!history$[row.id].get()) {
              history$[row.id].set(entry);
            } else {
              history$[row.id].set({
                ...history$[row.id].get(),
                transcript: entry.transcript,
                translation: entry.translation,
                transliteration: entry.transliteration,
                mtProvider: entry.mtProvider,
              });
              Db.updateCaptureRow(row.id, {
                transcript: entry.transcript,
                translation_text: entry.translation,
                transliteration_text: entry.transliteration ?? null,
                duration: entry.duration,
                source_app: entry.sourceApp,
                voice_id: entry.voiceId,
                stt_provider: entry.sttProvider,
                mt_provider: entry.mtProvider,
                origin: entry.origin,
                input: entry.input,
              });
            }
          }
        });

        const newest = data[data.length - 1];
        cursor = { created_at: newest.created_at, id: newest.id };
        storage.set(lastSyncKey, JSON.stringify(cursor));

        totalPulled += data.length;
        if (data.length < 200) break;
      }

      if (totalPulled > 0) {
        this.trimHistoryWindow();
        logger.info("[Sync] Pulled", totalPulled, "entries from cloud");
      }
    } catch (rawErr) {
      const err = toError(rawErr);
      this.pullError.set(err.message);
      logger.error("[Sync] Pull from cloud failed", err);
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
        .eq("user_id", userId)
        .is("deleted_at", null);

      if (before) {
        query = query.or(
          `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
        );
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);

      if (error) throw toError(error);

      return (data ?? []).map((row: CloudRow) => cloudRowToEntry(row));
    } catch (err) {
      logger.error("[Sync] fetchOlderHistory failed", err);
      return [];
    }
  }

  clearSyncCursor(userId: string): void {
    storage.remove(`last-sync-${userId}`);
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
}

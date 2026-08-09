import { SyncService } from "./SyncService";
import { Db } from "./db";
import { mmkv as storage } from "./mmkv";

import { File, Paths } from "expo-file-system";

import { EntryType } from "@/store";
import { isIOS } from "@/utils";
import { logger } from "@/utils";

export interface HistoryEntryPayload {
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string;
  provider: string;
  sessionKey?: string;
  type: EntryType;
}

// App Group container the native iOS share extension writes into (mirrors
// targets/share/EchoHistoryStore.swift + sharedContainer's APP_GROUP_ID).
const APP_GROUP_ID = "group.com.ekwe.app";
const SHARED_HISTORY_FILE = "shared-history.json";

interface SharedHistoryRecord {
  sessionKey: string;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string;
  provider: string;
  createdAt: string;
}

export const HistoryService = {
  recordTranslation: async (
    payload: HistoryEntryPayload,
    session: { user?: { id: string } } | null,
  ): Promise<string | undefined> => {
    if (!session?.user) return undefined;

    // Every call writes its own entry. Transcribing an audio and later
    // translating it produces TWO separate history rows — a transcription
    // (text + audio metadata) and a translation — never a combined row.
    const id = await SyncService.writeHistory(payload, session.user.id);
    return id;
  },

  cleanupLocalHistory: (): void => {
    try {
      const now = Date.now();
      const CLEANUP_KEY = "ekwe-history-last-cleanup";

      const lastCleanup = Number(storage.getString(CLEANUP_KEY) ?? 0);
      if (now - lastCleanup < 86_400_000) return;
      storage.set(CLEANUP_KEY, String(now));

      const ttlDays = 7;
      const deletedCount = Db.cleanupExpiredHistory(ttlDays);

      if (deletedCount > 0) {
        logger.info(
          `[HistoryService] Pruned ${deletedCount} expired local history records.`,
        );
      }
    } catch (e) {
      logger.error("[HistoryService] Failed to cleanup local history", e);
    }
  },

  /**
   * Drains records the native iOS share extension wrote into the shared App
   * Group container (`shared-history.json`) and imports them into local +
   * cloud history via the same path as in-app shares. The extension runs
   * without a JS runtime, so it can't call `recordTranslation` directly.
   *
   * The extension writes one record after transcribing (translation nil) and a
   * second record after translating the same audio (same sessionKey). Each
   * record becomes its OWN history entry: a transcription, or a translation —
   * never combined in place.
   */
  importSharedEchoHistory: async (
    session: { user?: { id: string } } | null,
  ): Promise<void> => {
    if (!isIOS || !session?.user) return;
    try {
      const dir = Paths.appleSharedContainers?.[APP_GROUP_ID];
      if (!dir) return;
      const file = new File(dir, SHARED_HISTORY_FILE);
      if (!file.exists) return;

      const records = JSON.parse(file.textSync()) as SharedHistoryRecord[];
      if (!Array.isArray(records) || records.length === 0) {
        file.delete();
        return;
      }

      for (const record of records) {
        try {
          const hasTranslation =
            !!record.translation?.trim() &&
            record.translation.trim() !== record.transcript?.trim();
          await HistoryService.recordTranslation(
            {
              sourceLang: record.sourceLang,
              targetLang: record.targetLang,
              transcript: record.transcript,
              translation: record.translation,
              transliteration: record.transliteration,
              duration: record.duration ?? 0,
              sourceApp: record.sourceApp || "ios",
              provider: record.provider || "unknown",
              sessionKey: record.sessionKey,
              type: hasTranslation ? "translation" : "transcription",
            },
            session,
          );
        } catch (e) {
          logger.error("[HistoryService] shared echo record import failed", e);
        }
      }

      file.delete();
      logger.info(
        `[HistoryService] Imported ${records.length} shared echo record(s) into history.`,
      );
    } catch (e) {
      logger.error("[HistoryService] Failed to import shared echo history", e);
    }
  },
};

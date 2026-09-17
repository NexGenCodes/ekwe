import { SyncService } from "./SyncService";
import { mapSharedRecordToEntry } from "./sharedHistory";

import {
  sharedHistoryRecordSchema,
  type SharedHistoryRecord,
} from "@ekwe/shared";

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

      const raw: unknown = JSON.parse(file.textSync());
      if (!Array.isArray(raw) || raw.length === 0) {
        file.delete();
        return;
      }

      // The file is tool-provided input, so validate every record with the
      // shared schema rather than trusting the cast. Malformed records are
      // skipped (fail-loud, logged) while valid ones still import.
      const records: SharedHistoryRecord[] = [];
      let invalid = 0;
      for (const item of raw) {
        const parsed = sharedHistoryRecordSchema.safeParse(item);
        if (parsed.success) {
          records.push(parsed.data);
        } else {
          invalid++;
        }
      }
      if (invalid > 0) {
        logger.warn(
          `[HistoryService] Skipped ${invalid} malformed shared echo record(s).`,
        );
      }
      if (records.length === 0) {
        file.delete();
        return;
      }

      for (const record of records) {
        try {
          const draft = mapSharedRecordToEntry(record);
          await HistoryService.recordTranslation(draft, session);
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

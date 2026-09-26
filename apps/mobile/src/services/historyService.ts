import { SyncService } from "@/services/syncService";
import { mapSharedRecordToEntry } from "@/services/sharedHistory";

import {
  sharedHistoryRecordSchema,
  type HistoryInput,
  type HistoryOrigin,
  type SharedHistoryRecord,
} from "@ekwe/shared";

import { File, Paths } from "expo-file-system";

import { EntryType } from "@/store";
import { isIOS } from "@/utils";
import { logger } from "@/utils";

export interface HistoryEntryPayload {
  /**
   * Stable id for the capture session. Reuse it across a capture's lifetime so
   * that transcribing and then translating produce one row, not two.
   */
  captureId: string;
  origin: HistoryOrigin;
  input: HistoryInput;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  /** The external app the audio came from. Null for in-app captures. */
  sourceApp: string | null;
  voiceId: string | null;
  sttProvider: string;
  mtProvider: string | null;
  type: EntryType;
}

const APP_GROUP_ID = "group.com.ekwe.app";
const SHARED_HISTORY_FILE = "shared-history.json";

export const HistoryService = {
  recordTranslation: async (
    payload: HistoryEntryPayload,
    session: { user?: { id: string } } | null,
  ): Promise<string | undefined> => {
    if (!session?.user) return undefined;

    const id = await SyncService.writeHistory(payload, session.user.id);
    return id;
  },

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

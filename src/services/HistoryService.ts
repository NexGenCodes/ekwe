import { SyncService } from './SyncService';
import { Db } from './db';
import { mmkv as storage } from './mmkv';

import { logger } from '@/utils';

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
}

const sessionMap = new Map<string, string>(); // sessionKey -> historyEntryId

export const HistoryService = {
  recordTranslation: async (
    payload: HistoryEntryPayload,
    session: { user?: { id: string } } | null,
  ): Promise<string | undefined> => {
    if (!session?.user) return undefined;

    if (payload.sessionKey) {
      const existingId = sessionMap.get(payload.sessionKey);
      if (existingId) {
        if (payload.translation !== null) {
          await SyncService.updateHistoryTranslation(
            existingId,
            payload.translation,
            payload.transliteration,
            payload.targetLang,
          );
        }
        return existingId;
      }
    }

    const id = await SyncService.writeHistory(payload, session.user.id);
    if (payload.sessionKey) {
      sessionMap.set(payload.sessionKey, id);
    }
    return id;
  },

  cleanupLocalHistory: (): void => {
    try {
      const now = Date.now();
      const CLEANUP_KEY = 'ekwe-history-last-cleanup';

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
      logger.error('[HistoryService] Failed to cleanup local history', e);
    }
  },
};

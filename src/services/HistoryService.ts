import { supabase } from '@/services/supabase';
import { history$ } from '@/store';
import { logger } from '@/utils';
import { Db } from './db';
import { SyncService } from './SyncService';

export interface HistoryEntryPayload {
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration: string | null;
  duration: number;
  sourceApp: string;
  provider: string;
}

export const HistoryService = {
  recordTranslation: async (
    payload: HistoryEntryPayload,
    session: { user?: { id: string } } | null,
  ): Promise<string | undefined> => {
    if (!session?.user) return undefined;

    const id = await SyncService.writeHistory(payload, session.user.id);
    return id;
  },

  cleanupLocalHistory: (): void => {
    try {
      const now = Date.now();
      const CLEANUP_KEY = 'ekwe-history-last-cleanup';

      const lastCleanup = Number(Db.getStore(CLEANUP_KEY) ?? 0);
      if (now - lastCleanup < 86_400_000) return;
      Db.setStore(CLEANUP_KEY, String(now));

      const ttlDays = 7;
      const deletedCount = Db.cleanupExpiredHistory(ttlDays);

      if (deletedCount > 0) {
        logger.info(`[HistoryService] Pruned ${deletedCount} expired local history records.`);
      }
    } catch (e) {
      logger.error('[HistoryService] Failed to cleanup local history', e);
    }
  },
};

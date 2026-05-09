import { Session } from '@supabase/supabase-js';

import { useHistoryStore } from '@/store';
import { useSyncQueue } from '@/store/syncQueue';
import { logger } from '@/utils';

export interface HistoryEntryPayload {
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  duration: number;
  sourceApp: string;
  provider: string;
}

export const HistoryService = {
  recordTranslation: async (
    payload: HistoryEntryPayload,
    session: Session | null,
  ): Promise<void> => {
    const historyEntry = {
      id: `echo_${Date.now()}`,
      ...payload,
      timestamp: Date.now(),
    };

    // Update local history store
    useHistoryStore.getState().addEntry(historyEntry);

    // Feature: Offline-First Sync to Supabase
    if (session?.user) {
      logger.info('[Sync] Queuing history entry for background sync...');
      const dbPayload = {
        id: historyEntry.id,
        user_id: session.user.id,
        source_lang: historyEntry.sourceLang,
        target_lang: historyEntry.targetLang,
        transcript: historyEntry.transcript,
        translation_text: historyEntry.translation || null,
        duration: historyEntry.duration,
        source_app: historyEntry.sourceApp,
        provider: historyEntry.provider,
      };

      // 1. Instantly persist to the offline-first queue (backed by MMKV)
      useSyncQueue.getState().enqueue(dbPayload);

      // 2. Trigger a background flush (it handles network failures gracefully)
      useSyncQueue
        .getState()
        .flushQueue()
        .catch((e) => {
          logger.error('[Sync] Background flush failed (will retry later)', e);
        });
    }
  },
};

import { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';

import { PLAN_LIMITS } from '@/constants';
import { supabase } from '@/services/supabase';
import { history$, pendingSync$, MAX_RETRIES, RETRY_BACKOFF_MS } from '@/store';
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
}

export const HistoryService = {
  recordTranslation: async (
    payload: HistoryEntryPayload,
    session: Session | null,
  ): Promise<void> => {
    const id = Crypto.randomUUID();

    if (session?.user) {
      logger.info('[Sync] Inserting history entry into local state...');

      const newEntry = {
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
        deleted: false,
      };

      // 1. Instantly update UI and persist to local MMKV storage
      history$[id].set(newEntry);

      // 2. Background sync to Supabase
      try {
        await supabase.from('history').upsert({
          id,
          user_id: session.user.id,
          source_lang: payload.sourceLang,
          target_lang: payload.targetLang,
          transcript: payload.transcript,
          translation_text: payload.translation || null,
          transliteration_text: payload.transliteration || null,
          duration: payload.duration,
          source_app: payload.sourceApp,
          provider: payload.provider,
          created_at: new Date(newEntry.timestamp).toISOString(),
        });
      } catch (e) {
        logger.error('[Sync] Supabase insert failed, queueing for retry', e);
        pendingSync$[id].set({
          id,
          payload: {
            source_lang: payload.sourceLang,
            target_lang: payload.targetLang,
            transcript: payload.transcript,
            translation_text: payload.translation || null,
            transliteration_text: payload.transliteration || null,
            duration: payload.duration,
            source_app: payload.sourceApp,
            provider: payload.provider,
            created_at: new Date(newEntry.timestamp).toISOString(),
          },
          user_id: session.user.id,
          retries: 0,
          lastAttempt: 0,
        });
      }
    }
  },

  drainSyncQueue: async (): Promise<void> => {
    const queue = pendingSync$.get();
    if (!queue || Object.keys(queue).length === 0) return;

    const now = Date.now();
    const entries = Object.values(queue);

    for (const entry of entries) {
      // Backoff: skip if last attempt was too recent
      if (now - entry.lastAttempt < RETRY_BACKOFF_MS) continue;

      // Max retries exceeded — drop from queue
      if (entry.retries >= MAX_RETRIES) {
        logger.warn('[Sync] Dropping entry after max retries', entry.id);
        pendingSync$[entry.id].delete();
        continue;
      }

      try {
        await supabase.from('history').upsert({
          id: entry.id,
          user_id: entry.user_id,
          source_lang: entry.payload.source_lang,
          target_lang: entry.payload.target_lang,
          transcript: entry.payload.transcript,
          translation_text: entry.payload.translation_text,
          transliteration_text: entry.payload.transliteration_text,
          duration: entry.payload.duration,
          source_app: entry.payload.source_app,
          provider: entry.payload.provider,
          created_at: entry.payload.created_at,
        });
        pendingSync$[entry.id].delete();
        logger.info('[Sync] Queued entry synced successfully', entry.id);
      } catch {
        pendingSync$[entry.id].retries.set(entry.retries + 1);
        pendingSync$[entry.id].lastAttempt.set(now);
        logger.error('[Sync] Retry failed for entry', entry.id);
      }
    }
  },

  cleanupLocalHistory: (): void => {
    try {
      const now = Date.now();
      const ttlMs = PLAN_LIMITS.free.historyLocalTtlDays * 24 * 60 * 60 * 1000;

      const allHistory = history$.get();
      if (!allHistory) return;

      let deletedCount = 0;
      Object.keys(allHistory).forEach((id) => {
        const entry = allHistory[id];
        if (now - entry.timestamp > ttlMs) {
          history$[id].delete();
          deletedCount++;
        }
      });

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

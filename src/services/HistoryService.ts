import * as Crypto from 'expo-crypto';
import { Session } from '@supabase/supabase-js';

import { history$ } from '@/store';
import { supabase } from '@/services/supabase';
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
    const id = Crypto.randomUUID();
    
    // Feature: Offline-First Sync using Legend-State
    if (session?.user) {
      logger.info('[Sync] Inserting history entry into local state...');
      
      const newEntry = {
        id,
        sourceLang: payload.sourceLang,
        targetLang: payload.targetLang,
        transcript: payload.transcript,
        translation: payload.translation || null,
        duration: payload.duration,
        sourceApp: payload.sourceApp,
        provider: payload.provider,
        timestamp: Date.now(),
        deleted: false,
      };

      // 1. Instantly update UI and persist to local MMKV storage
      history$[id].set(newEntry);

      // 2. Background sync to Supabase (Legend-State v3 would handle this automatically via syncedSupabase,
      // but in v2 we push the local mutation directly).
      try {
        await supabase.from('history').upsert({
          id,
          user_id: session.user.id,
          source_lang: payload.sourceLang,
          target_lang: payload.targetLang,
          transcript: payload.transcript,
          translation_text: payload.translation || null,
          duration: payload.duration,
          source_app: payload.sourceApp,
          provider: payload.provider,
          created_at: new Date(newEntry.timestamp).toISOString(),
        });
      } catch (e) {
        logger.error('[Sync] Supabase insert failed (will retry if queued)', e);
      }
    }
  },
};

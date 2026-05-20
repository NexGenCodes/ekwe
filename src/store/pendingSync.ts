import { observable } from '@legendapp/state';
import { persistObservable } from '@legendapp/state/persist';

import { ObservablePersistMMKVCustom } from '@/store/mmkvPlugin';

export interface PendingSyncEntry {
  id: string;
  payload: {
    source_lang: string;
    target_lang: string;
    transcript: string;
    translation_text: string | null;
    transliteration_text: string | null;
    duration: number;
    source_app: string;
    provider: string;
    created_at: string;
  };
  user_id: string;
  retries: number;
  lastAttempt: number;
}

export const pendingSync$ = observable<Record<string, PendingSyncEntry>>({});

persistObservable(pendingSync$, {
  local: 'ekwe-pending-sync',
  pluginLocal: ObservablePersistMMKVCustom,
});

export const MAX_RETRIES = 5;
export const RETRY_BACKOFF_MS = 30_000;

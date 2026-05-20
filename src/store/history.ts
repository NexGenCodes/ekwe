import { observable } from '@legendapp/state';
import { persistObservable } from '@legendapp/state/persist';

import { ObservablePersistMMKVCustom } from '@/store/mmkvPlugin';

export interface HistoryEntry {
  id: string;
  sourceLang: string;
  targetLang: string;
  transcript: string;
  translation: string | null;
  transliteration?: string | null;
  timestamp: number;
  duration: number;
  sourceApp: string | null;
  provider?: string;
  deleted?: boolean;
}

// ─── Local State ───
// This observable replaces the PowerSync SQLite table.
export const history$ = observable<Record<string, HistoryEntry>>({});

persistObservable(history$, {
  local: 'ekwe-history',
  pluginLocal: ObservablePersistMMKVCustom,
});

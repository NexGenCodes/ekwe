import { observable } from '@legendapp/state';
import { persistObservable } from '@legendapp/state/persist';

import { supabase } from '@/services/supabase';
import { ObservablePersistMMKVCustom } from '@/store/mmkvPlugin';

export interface SyncEntry {
  id: string;
  user_id: string;
  source_lang: string;
  target_lang: string;
  transcript: string;
  translation_text: string | null;
  duration: number;
  source_app: string;
}

export interface SyncQueueState {
  queue: SyncEntry[];
  isSyncing: boolean;
}

export const syncQueue$ = observable<SyncQueueState>({
  queue: [],
  isSyncing: false,
});

persistObservable(syncQueue$, {
  local: 'ekwe-sync-queue',
  pluginLocal: ObservablePersistMMKVCustom,
});

// Actions
export const syncQueueActions = {
  enqueue: (entry: SyncEntry): void => {
    const queue = syncQueue$.queue.get();
    if (queue.find((item) => item.id === entry.id)) return;
    syncQueue$.queue.push(entry);
  },

  flushQueue: async (): Promise<void> => {
    const { queue, isSyncing } = syncQueue$.get();
    if (queue.length === 0 || isSyncing) return;

    syncQueue$.isSyncing.set(true);

    const successfulIds: string[] = [];

    for (const entry of queue) {
      try {
        const { error } = await supabase.from('history').insert(entry);
        if (!error) {
          successfulIds.push(entry.id);
        }
      } catch {
        // Silent fail, it will retry on the next flush
      }
    }

    const currentQueue = syncQueue$.queue.get();
    syncQueue$.queue.set(
      currentQueue.filter((item) => !successfulIds.includes(item.id)),
    );
    syncQueue$.isSyncing.set(false);
  },
};

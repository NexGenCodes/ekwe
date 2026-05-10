import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { supabase } from '@/services/supabase';
import { mmkvStorage } from '@/store/mmkvStorage';

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

export interface SyncQueueActions {
  enqueue: (entry: SyncEntry) => void;
  flushQueue: () => Promise<void>;
}

export const useSyncQueue = create<SyncQueueState & SyncQueueActions>()(
  persist(
    (set, get) => ({
      queue: [],
      isSyncing: false,

      enqueue: (entry: SyncEntry): void => {
        set((state) => {
          // Prevent duplicate queue entries based on ID
          if (state.queue.find((item) => item.id === entry.id)) return state;
          return { queue: [...state.queue, entry] };
        });
      },

      flushQueue: async (): Promise<void> => {
        const { queue, isSyncing } = get();
        if (queue.length === 0 || isSyncing) return;

        set({ isSyncing: true });

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

        set((state) => ({
          queue: state.queue.filter((item) => !successfulIds.includes(item.id)),
          isSyncing: false,
        }));
      },
    }),
    {
      name: 'ekwe-sync-queue',
      storage: createJSONStorage(() => mmkvStorage),
    },
  ),
);

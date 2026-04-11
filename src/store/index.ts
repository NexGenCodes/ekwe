import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { createAudioSlice, AudioState, AudioActions } from '@/store/audioSlice';
import {
  createHistorySlice,
  HistoryState,
  HistoryActions,
} from '@/store/historySlice';
import { mmkvStorage } from '@/store/mmkvStorage';
import {
  createSettingsSlice,
  SettingsState,
  SettingsActions,
} from '@/store/settingsSlice';

export type { AudioState, AudioActions };
export type { HistoryState, HistoryActions };
export { mmkvStorage };
export type { SettingsState, SettingsActions };

// Audio — session only, not persisted
export const useAudioStore = create<AudioState & AudioActions>()((set) =>
  createAudioSlice(set),
);

// History — persisted to MMKV
export const useHistoryStore = create<HistoryState & HistoryActions>()(
  persist((set) => createHistorySlice(set), {
    name: 'ekwe-history',
    storage: createJSONStorage(() => mmkvStorage),
    onRehydrateStorage:
      () =>
      (state): void => {
        if (state) {
          const retentionMs = 7 * 24 * 60 * 60 * 1000;
          state.runCleanup(retentionMs);
        }
      },
  }),
);

// Settings — persisted to MMKV
export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist((set) => createSettingsSlice(set), {
    name: 'ekwe-settings',
    storage: createJSONStorage(() => mmkvStorage),
  }),
);

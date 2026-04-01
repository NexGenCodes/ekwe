import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { createAudioSlice } from './audioSlice';
import type { AudioSlice } from './audioSlice';
import { createHistorySlice } from './historySlice';
import type { HistorySlice } from './historySlice';
import { mmkvStorage } from './mmkvStorage';
import { createSettingsSlice } from './settingsSlice';
import type { SettingsSlice } from './settingsSlice';
import { createThemeSlice } from './themeSlice';
import type { ThemeSlice } from './themeSlice';

export type StoreState = AudioSlice & HistorySlice & SettingsSlice & ThemeSlice;

export const useStore = create<StoreState>()(
  persist(
    (...args) => ({
      ...createAudioSlice(...args),
      ...createHistorySlice(...args),
      ...createSettingsSlice(...args),
      ...createThemeSlice(...args),
    }),
    {
      name: 'ekwe-settings',
      storage: createJSONStorage(() => mmkvStorage),
      partialize: (state): Partial<StoreState> => ({
        // Only persist settings and history slices
        bubbleEnabled: state.bubbleEnabled,
        themePreference: state.themePreference,
        retentionDays: state.retentionDays,
        selectedLanguages: state.selectedLanguages,
        pinnedLanguages: state.pinnedLanguages,
        autoRaiseVolume: state.autoRaiseVolume,
        forceSpeakerMode: state.forceSpeakerMode,
        showVolumeRaiseBanner: state.showVolumeRaiseBanner,
        showSpeakerRerouteBanner: state.showSpeakerRerouteBanner,
        entries: state.entries,
      }),
      onRehydrateStorage: () => {
        return (state?: StoreState): void => {
          if (state) {
            const retentionMs = state.retentionDays * 24 * 60 * 60 * 1000;
            state.runCleanup(retentionMs);
          }
        };
      },
    },
  ),
);

// Typed selectors for performance
export const useRecordingState = (): AudioSlice['recordingState'] =>
  useStore((s) => s.recordingState);

export const useTranscriptBuffer = (): AudioSlice['transcriptBuffer'] =>
  useStore((s) => s.transcriptBuffer);

export const useErrorCode = (): AudioSlice['errorCode'] =>
  useStore((s) => s.errorCode);

export const useHistoryEntries = (): HistorySlice['entries'] =>
  useStore((s) => s.entries);

export const useThemePreference = (): SettingsSlice['themePreference'] =>
  useStore((s) => s.themePreference);

export const useSelectedLanguages = (): SettingsSlice['selectedLanguages'] =>
  useStore((s) => s.selectedLanguages);

export const useBubbleEnabled = (): SettingsSlice['bubbleEnabled'] =>
  useStore((s) => s.bubbleEnabled);

export const useResolvedTheme = (): ThemeSlice['resolved'] =>
  useStore((s) => s.resolved);

// Re-export types and enums
export { RecordingState } from './audioSlice';
export type { AudioState, AudioActions, AudioSlice } from './audioSlice';
export type {
  HistoryEntry,
  HistoryState,
  HistoryActions,
  HistorySlice,
} from './historySlice';
export { ThemePreference } from './settingsSlice';
export type {
  SettingsState,
  SettingsActions,
  SettingsSlice,
} from './settingsSlice';
export { ResolvedTheme } from './themeSlice';
export type { ThemeState, ThemeActions, ThemeSlice } from './themeSlice';

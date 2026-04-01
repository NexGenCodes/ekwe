import type { StateCreator } from 'zustand';

export enum ThemePreference {
  LIGHT = 'light',
  DARK = 'dark',
  SYSTEM = 'system',
}

export interface SettingsState {
  bubbleEnabled: boolean;
  themePreference: ThemePreference;
  retentionDays: number;
  selectedLanguages: string[];
  pinnedLanguages: string[];
  autoRaiseVolume: boolean;
  forceSpeakerMode: boolean;
  showVolumeRaiseBanner: boolean;
  showSpeakerRerouteBanner: boolean;
}

export interface SettingsActions {
  setBubbleEnabled: (val: boolean) => void;
  setThemePreference: (val: ThemePreference) => void;
  setRetentionDays: (val: number) => void;
  setSelectedLanguages: (codes: string[]) => void;
  setPinnedLanguages: (codes: string[]) => void;
  setAutoRaiseVolume: (val: boolean) => void;
  setForceSpeakerMode: (val: boolean) => void;
  setShowVolumeRaiseBanner: (val: boolean) => void;
  setShowSpeakerRerouteBanner: (val: boolean) => void;
}

export type SettingsSlice = SettingsState & SettingsActions;

export const createSettingsSlice: StateCreator<
  SettingsSlice,
  [],
  [],
  SettingsSlice
> = (set) => ({
  bubbleEnabled: false,
  themePreference: ThemePreference.SYSTEM,
  retentionDays: 7,
  selectedLanguages: ['en', 'es', 'it', 'de', 'zh'],
  pinnedLanguages: [],
  autoRaiseVolume: true,
  forceSpeakerMode: true,
  showVolumeRaiseBanner: true,
  showSpeakerRerouteBanner: true,
  setBubbleEnabled: (val: boolean): void => {
    set({ bubbleEnabled: val });
  },
  setThemePreference: (val: ThemePreference): void => {
    set({ themePreference: val });
  },
  setRetentionDays: (val: number): void => {
    set({ retentionDays: val });
  },
  setSelectedLanguages: (codes: string[]): void => {
    set({ selectedLanguages: codes });
  },
  setPinnedLanguages: (codes: string[]): void => {
    set({ pinnedLanguages: codes });
  },
  setAutoRaiseVolume: (val: boolean): void => {
    set({ autoRaiseVolume: val });
  },
  setForceSpeakerMode: (val: boolean): void => {
    set({ forceSpeakerMode: val });
  },
  setShowVolumeRaiseBanner: (val: boolean): void => {
    set({ showVolumeRaiseBanner: val });
  },
  setShowSpeakerRerouteBanner: (val: boolean): void => {
    set({ showSpeakerRerouteBanner: val });
  },
});

import { observable } from '@legendapp/state';
import { persistObservable } from '@legendapp/state/persist';

import { ObservablePersistMMKVCustom } from '@/store/mmkvPlugin';

export enum ThemePreference {
  Light = 'light',
  Dark = 'dark',
  System = 'system',
}

export interface SettingsState {
  bubbleEnabled: boolean;
  themePreference: ThemePreference;
  retentionDays: number;
  selectedLanguages: string[];
  targetLanguage: string;
  pinnedLanguages: string[];
  autoRaiseVolume: boolean;
  forceSpeakerMode: boolean;
  showVolumeRaiseBanner: boolean;
  showSpeakerRerouteBanner: boolean;
  onboardingCompleted: boolean;
  autoCopy: boolean;
  hapticsEnabled: boolean;
}

const initialSettings: SettingsState = {
  bubbleEnabled: false,
  themePreference: ThemePreference.System,
  retentionDays: 7,
  selectedLanguages: ['en', 'es', 'it', 'de', 'zh'],
  targetLanguage: 'en',
  pinnedLanguages: [],
  autoRaiseVolume: true,
  forceSpeakerMode: true,
  showVolumeRaiseBanner: true,
  showSpeakerRerouteBanner: true,
  onboardingCompleted: false,
  autoCopy: true,
  hapticsEnabled: true,
};

export const settings$ = observable<SettingsState>(initialSettings);

// Persist settings to MMKV
persistObservable(settings$, {
  local: 'ekwe-settings',
  pluginLocal: ObservablePersistMMKVCustom,
});
// Actions
export const settingsActions = {
  setBubbleEnabled: (val: boolean): void => {
    settings$.bubbleEnabled.set(val);
  },
  setThemePreference: (val: ThemePreference): void => {
    settings$.themePreference.set(val);
  },
  setRetentionDays: (val: number): void => {
    settings$.retentionDays.set(val);
  },
  setSelectedLanguages: (codes: string[]): void => {
    settings$.selectedLanguages.set(codes);
  },
  setTargetLanguage: (code: string): void => {
    settings$.targetLanguage.set(code);
  },
  setPinnedLanguages: (codes: string[]): void => {
    settings$.pinnedLanguages.set(codes);
  },
  setAutoRaiseVolume: (val: boolean): void => {
    settings$.autoRaiseVolume.set(val);
  },
  setForceSpeakerMode: (val: boolean): void => {
    settings$.forceSpeakerMode.set(val);
  },
  setShowVolumeRaiseBanner: (val: boolean): void => {
    settings$.showVolumeRaiseBanner.set(val);
  },
  setShowSpeakerRerouteBanner: (val: boolean): void => {
    settings$.showSpeakerRerouteBanner.set(val);
  },
  setOnboardingCompleted: (val: boolean): void => {
    settings$.onboardingCompleted.set(val);
  },
  setAutoCopy: (val: boolean): void => {
    settings$.autoCopy.set(val);
  },
  setHapticsEnabled: (val: boolean): void => {
    settings$.hapticsEnabled.set(val);
  },
};

import { observable } from "@legendapp/state";
import { persistObservable } from "@legendapp/state/persist";

import { detectDeviceCurrency } from "@/constants/currency";
import { ObservablePersistMMKV } from "@/store/mmkvPlugin";

export enum ThemePreference {
  Light = "light",
  Dark = "dark",
  System = "system",
}

export interface SettingsState {
  themePreference: ThemePreference;
  retentionDays: number;
  selectedLanguages: string[];
  targetLanguage: string;
  autoRaiseVolume: boolean;
  forceSpeakerMode: boolean;
  showVolumeRaiseBanner: boolean;
  showSpeakerRerouteBanner: boolean;
  onboardingCompleted: boolean;
  autoCopy: boolean;
  hapticsEnabled: boolean;
  currency: string;
  liveTranscriptionEnabled: boolean;
  analyticsConsent: boolean;
}

const initialSettings: SettingsState = {
  themePreference: ThemePreference.System,
  retentionDays: 7,
  selectedLanguages: [],
  targetLanguage: "en",
  autoRaiseVolume: true,
  forceSpeakerMode: true,
  showVolumeRaiseBanner: true,
  showSpeakerRerouteBanner: true,
  onboardingCompleted: false,
  autoCopy: true,
  hapticsEnabled: true,
  currency: detectDeviceCurrency(),
  liveTranscriptionEnabled: false,
  analyticsConsent: false,
};

export const settings$ = observable<SettingsState>(initialSettings);

// Persist settings to MMKV
persistObservable(settings$, {
  local: "ekwe-settings",
  pluginLocal: ObservablePersistMMKV,
});
// Actions
export const settingsActions = {
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
  setCurrency: (val: string): void => {
    settings$.currency.set(val);
  },
  setLiveTranscriptionEnabled: (val: boolean): void => {
    settings$.liveTranscriptionEnabled.set(val);
  },
  setAnalyticsConsent: (val: boolean): void => {
    settings$.analyticsConsent.set(val);
  },
};

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
}

export interface SettingsActions {
  setBubbleEnabled: (val: boolean) => void;
  setThemePreference: (val: ThemePreference) => void;
  setRetentionDays: (val: number) => void;
  setSelectedLanguages: (codes: string[]) => void;
  setTargetLanguage: (code: string) => void;
  setPinnedLanguages: (codes: string[]) => void;
  setAutoRaiseVolume: (val: boolean) => void;
  setForceSpeakerMode: (val: boolean) => void;
  setShowVolumeRaiseBanner: (val: boolean) => void;
  setShowSpeakerRerouteBanner: (val: boolean) => void;
  setOnboardingCompleted: (val: boolean) => void;
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
};

export const createSettingsSlice = (
  set: (fn: (state: SettingsState) => Partial<SettingsState>) => void,
): SettingsState & SettingsActions => ({
  ...initialSettings,
  setBubbleEnabled: (bubbleEnabled): void => set(() => ({ bubbleEnabled })),
  setThemePreference: (themePreference): void =>
    set(() => ({ themePreference })),
  setRetentionDays: (retentionDays): void => set(() => ({ retentionDays })),
  setSelectedLanguages: (selectedLanguages): void =>
    set(() => ({ selectedLanguages })),
  setTargetLanguage: (targetLanguage): void => set(() => ({ targetLanguage })),
  setPinnedLanguages: (pinnedLanguages): void =>
    set(() => ({ pinnedLanguages })),
  setAutoRaiseVolume: (autoRaiseVolume): void =>
    set(() => ({ autoRaiseVolume })),
  setForceSpeakerMode: (forceSpeakerMode): void =>
    set(() => ({ forceSpeakerMode })),
  setShowVolumeRaiseBanner: (showVolumeRaiseBanner): void =>
    set(() => ({ showVolumeRaiseBanner })),
  setShowSpeakerRerouteBanner: (showSpeakerRerouteBanner): void =>
    set(() => ({ showSpeakerRerouteBanner })),
  setOnboardingCompleted: (onboardingCompleted): void =>
    set(() => ({ onboardingCompleted })),
});

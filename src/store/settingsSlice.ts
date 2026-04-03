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

const initialSettings: SettingsState = {
  bubbleEnabled: false,
  themePreference: ThemePreference.System,
  retentionDays: 7,
  selectedLanguages: ['en', 'es', 'it', 'de', 'zh'],
  pinnedLanguages: [],
  autoRaiseVolume: true,
  forceSpeakerMode: true,
  showVolumeRaiseBanner: true,
  showSpeakerRerouteBanner: true,
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
});

import { observable } from "@legendapp/state";
import { persistObservable } from "@legendapp/state/persist";

import { PLAN_LIMITS } from "@/constants/billing";
import {
  mirrorSettingsToShared,
  SharedPreferences,
} from "@/services/sharedContainer";
import { auth$ } from "@/store/auth";
import { ObservablePersistMMKV } from "@/store/mmkvPlugin";

export enum ThemePreference {
  Light = "light",
  Dark = "dark",
  System = "system",
}

/** Version of the analytics-consent copy. Bump when the wording changes so
 * returning users are prompted to re-confirm. */
const CONSENT_VERSION = 1;

export type TtsVoice = "male" | "female" | "default";

export interface SettingsState {
  themePreference: ThemePreference;
  selectedLanguages: string[];
  targetLanguage: string;
  autoRaiseVolume: boolean;
  forceSpeakerMode: boolean;
  showVolumeRaiseBanner: boolean;
  showSpeakerRerouteBanner: boolean;
  onboardingCompleted: boolean;
  autoCopy: boolean;
  hapticsEnabled: boolean;
  liveTranscriptionEnabled: boolean;
  ttsVoice: TtsVoice;
  /** ISO 4217 code the user manually picked; null = auto-detect from device. */
  currency: string | null;
  analyticsConsent: boolean;
  /** ISO timestamp of the last analytics consent decision. */
  analyticsConsentUpdatedAt: string | null;
  /** Version of the consent copy the user agreed to. */
  analyticsConsentVersion: number | null;
}

const initialSettings: SettingsState = {
  themePreference: ThemePreference.System,
  selectedLanguages: [],
  targetLanguage: "en",
  autoRaiseVolume: true,
  forceSpeakerMode: true,
  showVolumeRaiseBanner: true,
  showSpeakerRerouteBanner: true,
  onboardingCompleted: false,
  autoCopy: true,
  hapticsEnabled: true,
  liveTranscriptionEnabled: false,
  ttsVoice: "default",
  currency: null,
  analyticsConsent: false,
  analyticsConsentUpdatedAt: null,
  analyticsConsentVersion: null,
};

export const settings$ = observable<SettingsState>(initialSettings);

// Build the prefs object for the native share extension's shared container.
// Read here rather than in sharedContainer to avoid `store -> services` cycle.
export function buildSettingsSharedPrefs(
  overrides?: Partial<
    Pick<SharedPreferences, "selectedLanguages" | "autoCopy">
  >,
): SharedPreferences {
  return {
    selectedLanguages:
      overrides?.selectedLanguages ?? settings$.selectedLanguages.peek(),
    autoCopy: overrides?.autoCopy ?? settings$.autoCopy.peek(),
    autoDetectAllowed:
      PLAN_LIMITS[auth$.isPro.peek() ? "pro" : "free"].autoDetectAllowed,
  };
}

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
  setSelectedLanguages: (codes: string[]): void => {
    settings$.selectedLanguages.set(codes);
    mirrorSettingsToShared(
      buildSettingsSharedPrefs({ selectedLanguages: codes }),
    );
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
    mirrorSettingsToShared(buildSettingsSharedPrefs({ autoCopy: val }));
  },
  setHapticsEnabled: (val: boolean): void => {
    settings$.hapticsEnabled.set(val);
  },
  setLiveTranscriptionEnabled: (val: boolean): void => {
    settings$.liveTranscriptionEnabled.set(val);
  },
  setTtsVoice: (val: TtsVoice): void => {
    settings$.ttsVoice.set(val);
  },
  setCurrency: (val: string | null): void => {
    settings$.currency.set(val);
  },
  setAnalyticsConsent: (val: boolean): void => {
    settings$.analyticsConsent.set(val);
    settings$.analyticsConsentUpdatedAt.set(new Date().toISOString());
    settings$.analyticsConsentVersion.set(CONSENT_VERSION);
  },
};

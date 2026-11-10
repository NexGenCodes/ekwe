import { observable } from "@legendapp/state";
import { syncObservable } from "@legendapp/state/sync";
import { Platform } from "react-native";

import { VoiceGender } from "@ekwe/shared";
import {
  DEFAULT_PAYMENT_CURRENCY,
  isSupportedPaymentCurrency,
} from "@ekwe/shared/money";
import type { FlutterwaveCurrency } from "@ekwe/shared/money";
import { PLAN_FEATURES, PLAN_LIMITS } from "@/constants/billing";
import {
  mirrorSettingsToShared,
  SharedPreferences,
} from "@/services/sharedContainer";
import { mmkvPlugin, registerTableTransform } from "@/store/mmkvPlugin";

type IsProProvider = () => boolean;
import EkweNative from "../../modules/ekwe-native/src/EkweNativeModule";

let isProProvider: IsProProvider = () => false;

export function registerIsProProvider(provider: IsProProvider): void {
  isProProvider = provider;
}

export enum ThemePreference {
  Light = "light",
  Dark = "dark",
  System = "system",
}

const CONSENT_VERSION = 1;

export type VoiceGenderSetting = NonNullable<VoiceGender> | "default";

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
  orbEnabled: boolean;
  orbAutoArm: boolean;
  orbSourceLang: string;
  orbTargetLang: string;
  voiceGender: VoiceGenderSetting;
  voiceId: string | null;
  currency: FlutterwaveCurrency;
  analyticsConsent: boolean;
  analyticsConsentUpdatedAt: string | null;
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
  orbEnabled: false,
  orbAutoArm: false,
  orbSourceLang: "auto",
  orbTargetLang: "en",
  voiceGender: "default",
  voiceId: null,
  currency: DEFAULT_PAYMENT_CURRENCY,
  analyticsConsent: false,
  analyticsConsentUpdatedAt: null,
  analyticsConsentVersion: null,
};

export const settings$ = observable<SettingsState>(initialSettings);

function isAutoCopyAllowed(): boolean {
  return PLAN_FEATURES[isProProvider() ? "pro" : "free"].autoCopy;
}

export function buildSettingsSharedPrefs(
  overrides?: Partial<
    Pick<SharedPreferences, "selectedLanguages" | "autoCopy">
  >,
): SharedPreferences {
  const isPro = isProProvider();
  return {
    selectedLanguages:
      overrides?.selectedLanguages ?? settings$.selectedLanguages.peek(),
    autoCopy:
      (overrides?.autoCopy ?? settings$.autoCopy.peek()) &&
      PLAN_FEATURES[isPro ? "pro" : "free"].autoCopy,
    autoDetectAllowed: PLAN_LIMITS[isPro ? "pro" : "free"].autoDetectAllowed,
  };
}

function migrateSettings(
  data: Record<string, unknown>,
): Record<string, unknown> {
  if ("ttsVoice" in data && !("voiceGender" in data)) {
    data.voiceGender = data.ttsVoice;
    delete data.ttsVoice;
  }
  if (data.voiceGender === "neutral") {
    data.voiceGender = "default";
  }
  const storedCurrency =
    typeof data.currency === "string" ? data.currency.trim() : "";
  const normalizedCurrency = storedCurrency.toUpperCase();
  data.currency = isSupportedPaymentCurrency(normalizedCurrency)
    ? normalizedCurrency
    : DEFAULT_PAYMENT_CURRENCY;
  if (Platform.OS !== "android") {
    data.orbEnabled = false;
    data.orbAutoArm = false;
  }
  return data;
}

registerTableTransform("ekwe-settings", migrateSettings);

syncObservable(settings$, {
  persist: {
    name: "ekwe-settings",
    plugin: mmkvPlugin,
  },
});
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
    // Paid-only: keep the observable itself from holding an unauthorized `true`,
    // which the Echo flow, result screen and share extension all trust.
    const next = val && isAutoCopyAllowed();
    settings$.autoCopy.set(next);
    mirrorSettingsToShared(buildSettingsSharedPrefs({ autoCopy: next }));
  },
  setHapticsEnabled: (val: boolean): void => {
    settings$.hapticsEnabled.set(val);
  },
  setLiveTranscriptionEnabled: (val: boolean): void => {
    settings$.liveTranscriptionEnabled.set(val);
  },
  setOrbEnabled: (val: boolean): void => {
    if (Platform.OS !== "android") {
      settings$.orbEnabled.set(false);
      return;
    }
    settings$.orbEnabled.set(val);
  },
  setOrbAutoArm: (val: boolean): void => {
    if (Platform.OS !== "android") {
      settings$.orbAutoArm.set(false);
      return;
    }
    settings$.orbAutoArm.set(val);
  },
  setOrbSourceLang: (val: string): void => {
    settings$.orbSourceLang.set(val);
  },
  setOrbTargetLang: (val: string): void => {
    settings$.orbTargetLang.set(val);
  },
  setVoiceGender: (val: VoiceGenderSetting): void => {
    settings$.voiceGender.set(val);
  },
  setVoiceId: (val: string | null): void => {
    settings$.voiceId.set(val);
  },
  setCurrency: (val: FlutterwaveCurrency): void => {
    settings$.currency.set(val);
  },
  setAnalyticsConsent: (val: boolean): void => {
    settings$.analyticsConsent.set(val);
    settings$.analyticsConsentUpdatedAt.set(new Date().toISOString());
    settings$.analyticsConsentVersion.set(CONSENT_VERSION);
  },
};

export function resetPersonalSettings(): void {
  settings$.selectedLanguages.set(initialSettings.selectedLanguages);
  settings$.targetLanguage.set(initialSettings.targetLanguage);
  settings$.autoCopy.set(initialSettings.autoCopy);
  settings$.currency.set(initialSettings.currency);
  settings$.voiceGender.set(initialSettings.voiceGender);
  settings$.voiceId.set(initialSettings.voiceId);
  settings$.liveTranscriptionEnabled.set(
    initialSettings.liveTranscriptionEnabled,
  );
  settings$.orbEnabled.set(initialSettings.orbEnabled);
  settings$.orbAutoArm.set(initialSettings.orbAutoArm);
  settings$.orbSourceLang.set(initialSettings.orbSourceLang);
  settings$.orbTargetLang.set(initialSettings.orbTargetLang);

  mirrorSettingsToShared(buildSettingsSharedPrefs());
}

// Keep native orb config in sync
let lastSyncOrb = {
  orbEnabled: false,
  myLanguages: "",
  orbSourceLang: "",
  orbTargetLang: "",
};
function syncOrbConfig(): void {
  const state = settings$.get();
  const langs =
    state.selectedLanguages.length > 0 ? state.selectedLanguages : ["en"];
  const effectiveEnabled = state.orbEnabled && isProProvider();
  const next = {
    orbEnabled: effectiveEnabled,
    myLanguages: langs.join(","),
    orbSourceLang: state.orbSourceLang,
    orbTargetLang: state.orbTargetLang,
  };
  if (
    next.orbEnabled === lastSyncOrb.orbEnabled &&
    next.myLanguages === lastSyncOrb.myLanguages &&
    next.orbSourceLang === lastSyncOrb.orbSourceLang &&
    next.orbTargetLang === lastSyncOrb.orbTargetLang
  ) {
    return;
  }
  lastSyncOrb = next;
  void EkweNative.configureOrb?.({
    orbEnabled: next.orbEnabled,
    myLanguages: langs,
    sourceLang: next.orbSourceLang,
    targetLang: next.orbTargetLang,
  });
}
try {
  settings$.orbEnabled.onChange(() => syncOrbConfig());
  settings$.selectedLanguages.onChange(() => syncOrbConfig());
  settings$.orbSourceLang.onChange(() => syncOrbConfig());
  settings$.orbTargetLang.onChange(() => syncOrbConfig());
  syncOrbConfig();
} catch {
  // ignore
}

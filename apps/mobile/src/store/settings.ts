import { observable } from "@legendapp/state";
import { syncObservable } from "@legendapp/state/sync";
import { internal } from "@legendapp/state";

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
import { mmkvPlugin } from "@/store/mmkvPlugin";
import { initializeMMKV, mmkv } from "@/services/mmkv";

type IsProProvider = () => boolean;
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

void (async (): Promise<void> => {
  try {
    await initializeMMKV();
    const raw = mmkv.getString("ekwe-settings");
    if (raw) {
      const parsed = internal.safeParse(raw) as Record<string, unknown> | null;
      if (parsed && "ttsVoice" in parsed && !("voiceGender" in parsed)) {
        parsed.voiceGender = parsed.ttsVoice;
        delete parsed.ttsVoice;
        mmkv.set("ekwe-settings", internal.safeStringify(parsed));
      }
      if (parsed && parsed.voiceGender === "neutral") {
        parsed.voiceGender = "default";
        mmkv.set("ekwe-settings", internal.safeStringify(parsed));
      }
      if (parsed) {
        const storedCurrency =
          typeof parsed.currency === "string" ? parsed.currency.trim() : "";
        const normalizedCurrency = storedCurrency.toUpperCase();
        if (!isSupportedPaymentCurrency(normalizedCurrency)) {
          parsed.currency = DEFAULT_PAYMENT_CURRENCY;
          mmkv.set("ekwe-settings", internal.safeStringify(parsed));
        } else if (parsed.currency !== normalizedCurrency) {
          parsed.currency = normalizedCurrency;
          mmkv.set("ekwe-settings", internal.safeStringify(parsed));
        }
      }
    }
  } catch {
    // Non-fatal: the next session retries or the user starts from
    // defaults if the old value is unrecoverable.
  }
})();

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
    // Pro-only: keep the observable itself from holding an unauthorized `true`,
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

  mirrorSettingsToShared(buildSettingsSharedPrefs());
}

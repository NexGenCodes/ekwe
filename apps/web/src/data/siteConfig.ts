import { APP_VERSION } from "@ekwe/shared/version";
import {
  FREE_LIMITS,
  PREMIUM_LIMITS,
  USD_PRICE,
  PLAN_CONFIG,
} from "@ekwe/shared/plans";
import { LANGUAGES } from "@ekwe/shared/languages";
import { providerIdsForCapability } from "@ekwe/shared/languageCapabilities";

export const LANGUAGE_COUNT = LANGUAGES.length;
export const SUPPORTED_TICKER = LANGUAGES.map((l) => l.nativeName);

export const STT_COUNT = providerIdsForCapability("stt").length;
export const TTT_COUNT = providerIdsForCapability("ttt").length;
export const TTS_COUNT = providerIdsForCapability("tts").length;
export const TOTAL_PROVIDERS = new Set(
  ["stt", "ttt", "tts"].flatMap((c) =>
    providerIdsForCapability(c as "stt" | "ttt" | "tts"),
  ),
).size;

export const siteConfig = {
  app: {
    name: "Ekwe",
    tagline: "Voice notes, translated instantly.",
    description: `Record or import voice notes and get instant translations in ${LANGUAGE_COUNT} languages. Powered by AI, built for everyone.`,
    version: APP_VERSION,
  },
  links: {
    siteUrl: "https://ekwe.pages.dev",
    download:
      "https://pub-dcd31dbfad344d278cc48d4601c658fc.r2.dev/app-release.apk",
  },
  contact: {
    email: "support@ekwe.pages.dev",
  },
  legal: {
    companyName: "NexGenCodes",
    lastUpdated: "2026-08-20",
  },
  features: [
    {
      title: "Voice Translation",
      description: `Record or import voice notes and get accurate translations in ${LANGUAGE_COUNT} languages.`,
      icon: "mic" as const,
    },
    {
      title: "AI-Powered",
      description: `${STT_COUNT} speech-to-text engines and ${TTT_COUNT} translation models with automatic failover for fast, natural results.`,
      icon: "cpu" as const,
    },
    {
      title: "Native Audio Engine",
      description:
        "A custom C++ audio core runs Opus encoding, noise-aware silence detection, and waveform extraction on your device.",
      icon: "waves" as const,
    },
    {
      title: "Share Extension",
      description:
        "Translate audio from any messaging app — WhatsApp, Telegram, Signal, and more — via the system share sheet.",
      icon: "share" as const,
    },
    {
      title: "History",
      description:
        "Every voice note Ekwe has understood, tagged by where it came from. Search and export anytime.",
      icon: "clock" as const,
    },
    {
      title: "Secure & Private",
      description:
        "Your audio is never stored by us. It's processed on the fly and only the resulting text is kept.",
      icon: "shield" as const,
    },
  ],
  pricing: {
    plans: PLAN_CONFIG,
    free: FREE_LIMITS,
    premium: PREMIUM_LIMITS,
    usd: USD_PRICE,
  },
} as const;

export type SiteConfig = typeof siteConfig;

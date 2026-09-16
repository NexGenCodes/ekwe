import logger from "@/utils/logger";

// Known bundle IDs → brand names. This is only a fallback for when the native
// layer can't resolve a display label (historical records, iOS, unmapped
// packages). Android resolves the real installed app label at the source, so
// values here are usually already human-readable.
const KNOWN_APPS: Record<string, string> = {
  "com.whatsapp": "WhatsApp",
  "com.whatsapp.w4b": "WhatsApp Business",
  w4b: "WhatsApp Business",
  "org.telegram.messenger": "Telegram",
  "ph.telegra.Telegraph": "Telegram",
  "com.zhiliaoapp.musically": "TikTok",
  "com.apple.VoiceMemos": "Voice Memos",
  "com.google.android.youtube": "YouTube",
  "com.instagram.android": "Instagram",
  "com.twitter.android": "X (Twitter)",
  "com.facebook.orca": "Messenger",
  "com.facebook.katana": "Facebook",
  "com.viber.voip": "Viber",
  "com.skype.raider": "Skype",
  "com.microsoft.teams": "Teams",
  "com.slack": "Slack",
  "com.discord": "Discord",
  "org.thoughtcrime.securesms": "Signal",
  "com.tencent.mm": "WeChat",
};

const UNKNOWN_SENTINELS = new Set([
  "unknown app",
  "unknown",
  "ios",
  "none",
  "audio",
]);

const IGNORE_SEGMENTS = new Set([
  "com",
  "org",
  "net",
  "io",
  "co",
  "app",
  "android",
  "apple",
  "google",
  "mobile",
  "inc",
]);

export const formatSourceApp = (source: string | null | undefined): string => {
  if (!source) return "Audio";

  const value = source.trim();
  const normalized = value.toLowerCase();

  if (UNKNOWN_SENTINELS.has(normalized)) return "Audio";

  // Native-resolved display labels (e.g. "WhatsApp Business") pass through
  // untouched — no splitting, no truncation.
  if (value.includes(" ") || (/[A-Z]/.test(value) && !value.includes(".")))
    return value;

  // Exact known-package match.
  if (KNOWN_APPS[value]) return KNOWN_APPS[value];

  // Dotted bundle ID — last resort heuristic. Strips namespace segments and
  // title-cases the most specific part (e.g. org.telegram.messenger → Telegram).
  const parts = value.split(".");
  if (parts.length === 1) {
    logger.info(
      "[formatSource] Unmapped source, formatting:",
      JSON.stringify(source),
    );
    return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
  }

  const validParts = parts.filter((p) => !IGNORE_SEGMENTS.has(p.toLowerCase()));
  const nameToFormat =
    validParts.length > 0
      ? validParts[validParts.length - 1]
      : parts[parts.length - 1];

  logger.info(
    "[formatSource] Unmapped source, formatting:",
    JSON.stringify(source),
  );

  return (
    nameToFormat.charAt(0).toUpperCase() + nameToFormat.slice(1).toLowerCase()
  );
};

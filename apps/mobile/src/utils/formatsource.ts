export const formatSourceApp = (
  bundleId: string | null | undefined,
): string => {
  if (!bundleId) return "Audio";

  // Map known bundle IDs to their exact brand names
  const KNOWN_APPS: Record<string, string> = {
    "com.whatsapp": "WhatsApp",
    "com.whatsapp.w4b": "WhatsApp Business",
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

  if (KNOWN_APPS[bundleId]) {
    return KNOWN_APPS[bundleId];
  }

  // Fallback: strip domain extensions and common namespace words
  const parts = bundleId.split(".");
  const ignoreList = [
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
  ];

  const validParts = parts.filter((p) => !ignoreList.includes(p.toLowerCase()));

  // Pick the most specific part (usually the last one before the app name, or the app name itself)
  const nameToFormat =
    validParts.length > 0
      ? validParts[validParts.length - 1]
      : parts[parts.length - 1];

  return (
    nameToFormat.charAt(0).toUpperCase() + nameToFormat.slice(1).toLowerCase()
  );
};

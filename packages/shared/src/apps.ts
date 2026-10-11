export interface OrbTargetApp {
  readonly packageName: string;
  readonly name: string;
}

/**
 * Known voice-note apps, used for labelling history and for foreground detection
 * when auto-arming. Membership is never a capture gate: playback capture matches
 * any app publishing USAGE_MEDIA or USAGE_UNKNOWN audio, so an app missing from
 * this list still captures. Entries are apps verified to play voice notes.
 */
export const ORB_TARGET_APPS: readonly OrbTargetApp[] = [
  { packageName: "com.whatsapp", name: "WhatsApp" },
  { packageName: "com.whatsapp.w4b", name: "WhatsApp Business" },
  { packageName: "com.instagram.android", name: "Instagram" },
  { packageName: "com.snapchat.android", name: "Snapchat" },
  { packageName: "com.zhiliaoapp.musically", name: "TikTok" },
  { packageName: "org.telegram.messenger", name: "Telegram" },
  { packageName: "com.facebook.orca", name: "Messenger" },
  { packageName: "com.facebook.messenger", name: "Messenger Lite" },
  { packageName: "com.twitter.android", name: "X" },
  { packageName: "com.instagram.barcelona", name: "Threads" },
  { packageName: "com.discord", name: "Discord" },
  { packageName: "jp.naver.line.android", name: "LINE" },
  { packageName: "com.tencent.mm", name: "WeChat" },
  { packageName: "com.viber.voip", name: "Viber" },
  { packageName: "org.thoughtcrime.securesms", name: "Signal" },
  { packageName: "com.Slack", name: "Slack" },
] as const;

const TARGETS_BY_PACKAGE: ReadonlyMap<string, OrbTargetApp> = new Map(
  ORB_TARGET_APPS.map((app) => [app.packageName, app]),
);

export function isOrbTargetApp(
  packageName: string | null | undefined,
): boolean {
  return packageName != null && TARGETS_BY_PACKAGE.has(packageName);
}

export function orbAppName(
  packageName: string | null | undefined,
): string | null {
  if (packageName == null) return null;
  return TARGETS_BY_PACKAGE.get(packageName)?.name ?? null;
}

export function orbTargetPackages(): string[] {
  return ORB_TARGET_APPS.map((app) => app.packageName);
}

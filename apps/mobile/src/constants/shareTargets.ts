export type ShareTarget = "whatsapp" | "telegram";

export interface ShareTargetConfig {
  readonly id: ShareTarget;
  readonly label: string;
  readonly packageName: string;
  readonly fallbackPackageName?: string;
  /** Whether the target accepts the transcript as a caption. */
  readonly includeCaption: boolean;
  /** Short label shown beside the target name. */
  readonly badge: string;
  /** One-line explanation of what the target will render. */
  readonly description: string;
}

export const SHARE_TARGETS: readonly ShareTargetConfig[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    packageName: "com.whatsapp",
    fallbackPackageName: "com.whatsapp.w4b",
    includeCaption: false,
    badge: "Voice note",
    description: "Voice note with profile picture",
  },
  {
    id: "telegram",
    label: "Telegram",
    packageName: "org.telegram.messenger",
    fallbackPackageName: "org.thunderdog.challegram",
    includeCaption: false,
    badge: "Voice note",
    description: "Voice note with waveform",
  },
] as const;

export const SHARE_TARGET_BY_ID: Record<ShareTarget, ShareTargetConfig> =
  Object.fromEntries(
    SHARE_TARGETS.map((target) => [target.id, target]),
  ) as Record<ShareTarget, ShareTargetConfig>;

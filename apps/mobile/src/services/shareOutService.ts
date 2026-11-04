import { File, Paths } from "expo-file-system";
import { Share } from "react-native";

import type { HistoryOrigin } from "@ekwe/shared";

import EkweNative from "../../modules/ekwe-native";
import { EKWE_SHARE_SIGNATURE } from "@/constants/share";
import { SHARE_TARGET_BY_ID, type ShareTarget } from "@/constants/shareTargets";
import { logger } from "@/utils";
import type { TelemetrySource } from "@/types/telemetry";
import { AnalyticsEvents, track } from "@/utils/analytics";

/** Android share chooser title. iOS uses the first activity item instead. */
const SHARE_CHOOSER_TITLE = "Share voice";

/** Maps domain origins to frozen telemetry keys for stable dashboard reporting. */
export const TELEMETRY_KEY: Record<ShareSource, TelemetrySource> = {
  "speech-studio": "studio",
  echo: "echo",
  // Orb shares a generated result, and the frozen vocabulary has no Orb key.
  orb: "result",
  history: "history",
  result: "result",
};

/** Fires `result_shared` after a successful share with the content kind. */
const trackShare = (
  source: ShareSource,
  kind: "audio" | "text",
  target?: ShareTarget,
): void => {
  track(AnalyticsEvents.RESULT_SHARED, {
    source: TELEMETRY_KEY[source],
    kind,
    ...(target ? { target } : {}),
  });
};

/**
 * MIME type per file extension.
 * Ogg/Opus carries `codecs=opus`, which Telegram and WhatsApp expect for voice notes.
 */
const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  opus: "audio/ogg; codecs=opus",
  ogg: "audio/ogg; codecs=opus",
  caf: "audio/x-caf",
};

export function mimeFor(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_MIME_BY_EXT[ext] ?? "audio/*";
}

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * Generates a target-aware filename for the shared artifact.
 * WhatsApp requires .opus and PTT- naming convention to display as a native
 * Push-To-Talk voice note displaying the sender's profile picture.
 */
export const sharedFileName = (
  extension: string,
  target?: ShareTarget,
): string => {
  const now = new Date();
  const salt = Math.random().toString(36).slice(2, 6);

  if (target === "whatsapp") {
    // WhatsApp native PTT voice note format: PTT-YYYYMMDD-WAxxxx.opus
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    return `PTT-${stamp}-WA${salt}.opus`;
  }

  const dateHyphen = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `ekwe-voice-${dateHyphen}-${salt}.${extension}`;
};

/** Copies the artifact to a target-appropriate cache path. Uses a copy to preserve the original playback source. */
export const prepareShareFile = async (
  uri: string,
  target?: ShareTarget,
): Promise<string> => {
  try {
    const source = new File(uri);
    if (!source.exists) return uri;

    // File.extension includes the leading dot.
    const sourceExt = source.extension.replace(/^\./, "") || "ogg";
    const ext = target === "whatsapp" ? "opus" : sourceExt;
    const copy = new File(`${Paths.cache.uri}${sharedFileName(ext, target)}`);
    try {
      source.copySync(copy, { overwrite: true });
    } catch {
      copy.create({ intermediates: true, overwrite: true });
      copy.write(source.bytesSync());
    }
    return copy.uri;
  } catch (err) {
    logger.error("[ShareOut] prepareShareFile failed:", err);
    return uri;
  }
};

/** Surface type for share operations. Superset of `HistoryOrigin`. */
export type ShareSource = HistoryOrigin | "history" | "result";

export const ShareOutService = {
  /** Shares audio, as a voice note where the target supports it, falling back to text if unavailable. */
  shareArtifact: async (
    audioUri: string | null,
    text: string | null,
    source: ShareSource,
  ): Promise<boolean> => {
    const message = text?.trim() || undefined;

    if (audioUri) {
      const shared = await ShareOutService.shareAudio(
        audioUri,
        message,
        source,
      );
      if (shared) return true;
    }
    if (!message) return false;
    return ShareOutService.shareText(message, source);
  },

  shareAudio: async (
    uri: string,
    message?: string,
    source: ShareSource = "speech-studio",
  ): Promise<boolean> => {
    try {
      const file = new File(uri);
      if (!file.exists) {
        logger.warn("[ShareOut] Audio file missing:", uri);
        return false;
      }

      const payload = message ? `${message.trim()}${EKWE_SHARE_SIGNATURE}` : "";
      // Derive MIME from the actual shared file's extension for type consistency.
      const sharedUri = await prepareShareFile(uri);
      const result = await EkweNative.shareAudio(
        sharedUri,
        mimeFor(sharedUri),
        payload || null,
        SHARE_CHOOSER_TITLE,
      );

      if (!result.success) {
        logger.warn("[ShareOut] Audio share failed:", result.error);
        return false;
      }
      trackShare(source, "audio");
      return true;
    } catch (err) {
      logger.error("[ShareOut] Audio share failed:", err);
      return false;
    }
  },

  /**
   * Shares audio directly to WhatsApp or Telegram.
   *
   * WhatsApp receives a PTT-formatted .opus file without caption so it renders
   * as a native Push-To-Talk voice note displaying the sender's profile picture;
   * Telegram receives an Ogg/Opus file without caption so it renders as a native
   * voice message bubble.
   */
  shareTo: async (
    target: ShareTarget,
    uri: string,
    message?: string,
    source: ShareSource = "speech-studio",
  ): Promise<boolean> => {
    const config = SHARE_TARGET_BY_ID[target];

    try {
      const file = new File(uri);
      if (!file.exists) {
        logger.warn("[ShareOut] Audio file missing:", uri);
        return false;
      }

      const trimmedMessage = message?.trim();
      const caption =
        config.includeCaption && trimmedMessage
          ? `${trimmedMessage}${EKWE_SHARE_SIGNATURE}`
          : null;
      const sharedUri = await prepareShareFile(uri, target);
      const mimeType = mimeFor(sharedUri);

      let result = await EkweNative.shareAudio(
        sharedUri,
        mimeType,
        caption,
        SHARE_CHOOSER_TITLE,
        config.packageName,
      );

      if (
        !result.success &&
        result.error === "TARGET_NOT_INSTALLED" &&
        config.fallbackPackageName
      ) {
        result = await EkweNative.shareAudio(
          sharedUri,
          mimeType,
          caption,
          SHARE_CHOOSER_TITLE,
          config.fallbackPackageName,
        );
      }

      if (!result.success) {
        logger.warn(`[ShareOut] ${config.label} share failed:`, result.error);
        return false;
      }

      trackShare(source, "audio", target);
      return true;
    } catch (err) {
      logger.error(`[ShareOut] ${config.label} share failed:`, err);
      return false;
    }
  },

  shareText: async (
    message: string,
    source: ShareSource = "speech-studio",
  ): Promise<boolean> => {
    try {
      await Share.share({
        message: `${message.trim()}${EKWE_SHARE_SIGNATURE}`,
      });
      trackShare(source, "text");
      return true;
    } catch (err) {
      logger.error("[ShareOut] Text share failed:", err);
      return false;
    }
  },
};

import { File, Paths } from "expo-file-system";
import { Share } from "react-native";

import type { HistoryOrigin } from "@ekwe/shared";

import EkweNative from "../../modules/ekwe-native";
import { EKWE_SHARE_SIGNATURE } from "@/constants/share";
import { logger } from "@/utils";
import type { TelemetrySource } from "@/types/telemetry";
import { AnalyticsEvents, track } from "@/utils/analytics";

/** Android share chooser title. iOS uses the first activity item instead. */
const SHARE_CHOOSER_TITLE = "Send with Ekwe";

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
const trackShare = (source: ShareSource, kind: "audio" | "text"): void => {
  track(AnalyticsEvents.RESULT_SHARED, {
    source: TELEMETRY_KEY[source],
    kind,
  });
};

/** MIME type per file extension. Ogg/Opus carries `codecs=opus` for WhatsApp/Telegram voice note rendering. */
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

/** Generates a date-stamped filename for the shared artifact. */
const sharedFileName = (extension: string): string => {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  // Add random suffix to prevent staging collisions for same-day shares.
  const salt = Math.random().toString(36).slice(2, 6);
  return `ekwe-voice-${stamp}-${salt}.${extension}`;
};

/** Copies the artifact to a human-readable cache path. Uses a copy to preserve the original playback source. */
const prepareShareFile = async (uri: string): Promise<string> => {
  try {
    const source = new File(uri);
    if (!source.exists) return uri;

    // File.extension includes the leading dot.
    const ext = source.extension.replace(/^\./, "") || "ogg";
    const copy = new File(`${Paths.cache.uri}${sharedFileName(ext)}`);
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
  /** Shares audio as a voice note, falling back to text if unavailable. */
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

import { File, Paths } from "expo-file-system";
import { Share } from "react-native";

import type { HistoryOrigin } from "@ekwe/shared";

import EkweNative from "../../modules/ekwe-native";
import { EKWE_SHARE_SIGNATURE } from "@/constants/share";
import { logger } from "@/utils";
import type { TelemetrySource } from "@/types/telemetry";
import { AnalyticsEvents, track } from "@/utils/analytics";

/**
 * Chooser header, Android only — UIActivityViewController has no title, and on
 * iOS the caption travels as the first activity item instead.
 *
 * Share-out is not a capture surface, so it gets no feature name: Echo, Speech
 * Studio and Orb all name where audio came *in*. The sender here is the app
 * itself. See docs/naming.md.
 */
const SHARE_CHOOSER_TITLE = "Send with Ekwe";

/**
 * Domain origin -> frozen telemetry key.
 *
 * Callers pass the origin they actually have (`"speech-studio"`), and this is
 * the one place that knows the reporting vocabulary is older and different.
 * Mapping it here rather than at each call site is what stops the next rename
 * from silently editing a dashboard key: the surface is renamed, the map gains
 * a row, and `result_shared` reports `"studio"` exactly as it did before.
 */
export const TELEMETRY_KEY: Record<ShareSource, TelemetrySource> = {
  "speech-studio": "studio",
  echo: "echo",
  // Orb shares a generated result, and the frozen vocabulary has no Orb key.
  orb: "result",
  history: "history",
  result: "result",
};

/**
 * One `result_shared` per successful share.
 *
 * Fired here rather than by each caller because they disagreed: three surfaces
 * fired before opening the sheet, which counted every dismissal as a share.
 * `kind` separates a voice note from plain text without adding an event.
 */
const trackShare = (source: ShareSource, kind: "audio" | "text"): void => {
  track(AnalyticsEvents.RESULT_SHARED, {
    source: TELEMETRY_KEY[source],
    kind,
  });
};

/**
 * MIME type per file extension for outgoing shares.
 *
 * Ogg/Opus must carry the `codecs=opus` parameter rather than plain
 * `audio/ogg`. WhatsApp allow-lists exactly "audio/ogg; codecs=opus" (plus
 * audio/m4a and audio/x-m4a) to render an incoming file as a PTT voice note,
 * and Telegram requires the type to both start with "audio/ogg" and contain
 * "codecs=opus" before treating it as a voice message. Both compare the full
 * string, so the parameter is what separates a voice note from an ordinary
 * audio attachment. Everything else maps to a plain type and arrives as one.
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
 * The filename the recipient sees in their chat. Built from local date parts
 * rather than toISOString(), which would land a day early west of UTC.
 */
const sharedFileName = (extension: string): string => {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `ekwe-voice-${stamp}.${extension}`;
};

/**
 * Copies the artifact to a human-readable name in the cache.
 *
 * A copy rather than a rename: the same uri is the studio's playback source,
 * so moving it would break replay after a share. The copy is transient —
 * sweepStaleAudioCache() owns anything named "ekwe-voice-".
 */
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

/**
 * Which surface is handing the result to another app.
 *
 * Deliberately a superset of `HistoryOrigin`: `history` and `result` are
 * surfaces that show results without capturing anything, so they have no
 * origin to key on. A frozen counterpart lives in `@/types/telemetry` — the two
 * must not be merged.
 */
export type ShareSource = HistoryOrigin | "history" | "result";

export const ShareOutService = {
  /**
   * Hand a voice note to another app, falling back to its text.
   *
   * The audio path is the one that matters — a file the receiving app can play,
   * typed as `audio/ogg; codecs=opus` so WhatsApp and Telegram render it as a
   * voice note rather than an audio document. When there is no file, or the
   * platform sheet cannot carry it, the text is the fallback, so a share is
   * never a no-op.
   */
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
      const result = await EkweNative.shareAudio(
        await prepareShareFile(uri),
        mimeFor(uri),
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

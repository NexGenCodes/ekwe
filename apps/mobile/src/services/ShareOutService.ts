import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import { Share } from "react-native";

import { isAndroid, isIOS, logger } from "@/utils";

const SHARE_SIGNATURE = "\n\n— Shared with Ekwe · Speak, we'll handle the rest";

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  opus: "audio/ogg",
  ogg: "audio/ogg",
  caf: "audio/x-caf",
};

function mimeFor(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_MIME_BY_EXT[ext] ?? "audio/*";
}

/**
 * "Say it once, be heard everywhere." — the outbound half of the core loop.
 *
 * Wraps the native OS Share Sheet so a generated voice note (plus its optional
 * translated text) can be sent to any social app. Two paths:
 *
 *  1. Audio files → `expo-sharing` (`Sharing.isAvailableAsync` + `shareAsync`).
 *     This is the only cross-platform way to hand a file off to the sheet; the
 *     RN `Share` API only carries URLs/text on Android.
 *  2. Text-only → RN `Share.share` (still exported as an escape hatch for
 *     historical a11y/UX reasons where no audio file exists).
 */
export const ShareOutService = {
  /**
   * Shares a generated TTS audio file through the native OS share sheet,
   * attaching the translated text as the "message" when the platform allows.
   * Returns whether the share was successfully presented.
   */
  shareAudio: async (uri: string, message?: string): Promise<boolean> => {
    try {
      const file = new File(uri);
      if (!file.exists) {
        logger.warn("[ShareOut] Audio file missing:", uri);
        return false;
      }

      const canShare = isIOS
        ? await Sharing.isAvailableAsync()
        : await Sharing.isAvailableAsync();
      if (!canShare) {
        logger.warn("[ShareOut] Sharing unavailable on this device");
        return false;
      }

      const payload = message
        ? `${message.trim()}${SHARE_SIGNATURE}`
        : undefined;

      await Sharing.shareAsync(uri, {
        mimeType: mimeFor(uri),
        dialogTitle: "Send as Echo",
        UTI: mimeFor(uri),
        ...(isIOS && payload ? { text: payload } : {}),
      });
      return true;
    } catch (err) {
      logger.error("[ShareOut] Audio share failed:", err);
      return false;
    }
  },

  /**
   * Text-only share fallback (no audio generated, e.g. free-tier/offline).
   * Kept as a distinct method so callers can degrade gracefully instead of
   * silently dropping the message when a voice note isn't available.
   */
  shareText: async (message: string): Promise<boolean> => {
    try {
      await Share.share({ message: `${message.trim()}${SHARE_SIGNATURE}` });
      return true;
    } catch (err) {
      logger.error("[ShareOut] Text share failed:", err);
      return false;
    }
  },

  /**
   * Ensures `uri` lives in a directory the OS share sheet can reach. `expo-sharing`
   * can present files from the app cache dir directly, but some Android OEMs
   * reject `content://` providers for cache files; copying into a dedicated
   * shareable temp dir keeps this consistent. No-op when already compliant.
   */
  ensureShareable: async (uri: string): Promise<string> => {
    try {
      const cache = Paths.cache.uri;
      if (!cache || !uri.startsWith(cache)) return uri;

      // iOS presents cache files fine via UIActivityViewController; the copy
      // dance only matters on Android.
      if (isIOS) return uri;
      if (!isAndroid) return uri;

      const file = new File(uri);
      if (!file.exists) return uri;
      const ext = file.extension || "mp3";
      const copy = new File(`${cache}ekwe_shareout_${Date.now()}${ext}`);
      try {
        file.copySync(copy, { overwrite: true });
      } catch {
        // Fallback: write bytes manually if the copy helper rejects.
        copy.create({ intermediates: true, overwrite: true });
        copy.write(file.bytesSync());
      }
      return copy.uri;
    } catch (err) {
      // Best-effort: on failure just return the original URI.
      logger.error("[ShareOut] ensureShareable failed:", err);
      return uri;
    }
  },
};

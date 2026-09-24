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

const AUDIO_UTI_BY_EXT: Record<string, string> = {
  mp3: "public.mp3",
  wav: "com.microsoft.waveform-audio",
  m4a: "public.mpeg-4-audio",
  opus: "org.xiph.ogg-audio",
  ogg: "org.xiph.ogg-audio",
  caf: "com.apple.coreaudio-format",
};

export function mimeFor(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_MIME_BY_EXT[ext] ?? "audio/*";
}

export function utiFor(uri: string): string | undefined {
  const ext = uri.split(".").pop()?.toLowerCase() ?? "";
  return AUDIO_UTI_BY_EXT[ext];
}

export const ShareOutService = {
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
        UTI: utiFor(uri),
        ...(isIOS && payload ? { text: payload } : {}),
      });
      return true;
    } catch (err) {
      logger.error("[ShareOut] Audio share failed:", err);
      return false;
    }
  },

  shareText: async (message: string): Promise<boolean> => {
    try {
      await Share.share({ message: `${message.trim()}${SHARE_SIGNATURE}` });
      return true;
    } catch (err) {
      logger.error("[ShareOut] Text share failed:", err);
      return false;
    }
  },

  ensureShareable: async (uri: string): Promise<string> => {
    try {
      const cache = Paths.cache.uri;
      if (!cache || !uri.startsWith(cache)) return uri;

      if (isIOS) return uri;
      if (!isAndroid) return uri;

      const file = new File(uri);
      if (!file.exists) return uri;
      const ext = file.extension || "mp3";
      const copy = new File(`${cache}ekwe_shareout_${Date.now()}${ext}`);
      try {
        file.copySync(copy, { overwrite: true });
      } catch {
        copy.create({ intermediates: true, overwrite: true });
        copy.write(file.bytesSync());
      }
      return copy.uri;
    } catch (err) {
      logger.error("[ShareOut] ensureShareable failed:", err);
      return uri;
    }
  },
};

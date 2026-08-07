import { File } from "expo-file-system";

import { isAndroid } from "./platform";
import EkweNative from "../../modules/ekwe-native";

import { logger } from "@/utils";

/**
 * Formats seconds into MM:SS format, rounding to the nearest second so the
 * shown length matches how other players (WhatsApp) report durations — e.g. a
 * 9.9s clip shows "0:10" instead of flooring to "0:09". Without this, the
 * displayed total runs short and the last ~1s of the waveform appears to fill
 * "before" playback actually ends.
 */
export const formatDuration = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const rounded = Math.round(seconds);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

/**
 * Cleans up temporary audio files from the local cache and native layer
 */
export const cleanEchoCache = async (
  uri: string | null | undefined,
): Promise<void> => {
  if (!uri) return;

  try {
    // 1. Filesystem cleanup
    if (uri.includes("Cache") || uri.includes("cache")) {
      const f = new File(uri);
      if (f.exists) f.delete();
    }

    // 2. Native bridge cleanup
    if (isAndroid) {
      await EkweNative.deleteFile(uri);
    }
  } catch (err) {
    logger.error("[EchoUtils] Cache cleanup failed:", err);
  }
};

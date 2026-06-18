import * as FileSystem from "expo-file-system/legacy";

import { isAndroid } from "./platform";
import EkweNative from "../../modules/ekwe-native";

import { logger } from "@/utils";

/**
 * Formats seconds into MM:SS format
 */
export const formatDuration = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
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
    // 1. Filesystem cleanup (Legacy Expo API for stability)
    if (uri.includes("Cache") || uri.includes("cache")) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
    }

    // 2. Native bridge cleanup
    if (isAndroid) {
      await EkweNative.deleteFile(uri);
    }
  } catch (err) {
    logger.error("[EchoUtils] Cache cleanup failed:", err);
  }
};

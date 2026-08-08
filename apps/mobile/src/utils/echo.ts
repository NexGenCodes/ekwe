import { File, Paths } from "expo-file-system";

import { isAndroid } from "./platform";
import EkweNative from "../../modules/ekwe-native";

import { logger } from "@/utils";

/**
 * Whether a URI lives in the app's own writable cache directory. This is the
 * only place Echo writes temporary converted files, so cleanup is scoped to it
 * instead of a fragile "contains Cache" substring check.
 */
const isCacheUri = (uri: string): boolean => {
  try {
    const cache = Paths.cache.uri;
    return uri.startsWith(cache);
  } catch {
    // Paths.cache unavailable (tests/server env) — fall back to a defensive
    // substring match rather than risking a false-negative delete.
    return uri.includes("/Cache/") || uri.includes("/cache/");
  }
};

/**
 * Cleans up temporary audio files from the local cache and native layer
 */
export const cleanEchoCache = async (
  uri: string | null | undefined,
): Promise<void> => {
  if (!uri) return;

  try {
    // 1. Filesystem cleanup — only touch files we created in the cache dir.
    if (isCacheUri(uri)) {
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

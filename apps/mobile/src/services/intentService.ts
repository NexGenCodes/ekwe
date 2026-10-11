import EkweNative from "../../modules/ekwe-native";

import { MAX_AUDIO_BYTES } from "@ekwe/shared/plans";
import { isAndroid } from "@/utils";
import logger from "@/utils/logger";
import type { OpusTranscodeResult } from "../../modules/ekwe-native/src/EkweNative.types";

export const IntentService = {
  resolveToFileUri: async (rawUri: string): Promise<string | null> => {
    if (isAndroid && rawUri.startsWith("content://")) {
      // Registered only on Android, which is what is being tested here. The
      // optional call is a type-level acknowledgement of that, not a runtime
      // check: `isAndroid` already rules out iOS.
      return EkweNative.resolveContentUri?.(rawUri, MAX_AUDIO_BYTES) ?? null;
    }
    return rawUri;
  },

  resolveAndTranscodeToOpus: async (
    contentUri: string,
    outputPath: string,
    options?: { maxDurationMs?: number },
  ): Promise<OpusTranscodeResult | null> => {
    if (
      (isAndroid && contentUri.startsWith("content://")) ||
      (!isAndroid && Boolean(contentUri))
    ) {
      try {
        return await EkweNative.resolveAndTranscodeToOpus(
          contentUri,
          outputPath,
          MAX_AUDIO_BYTES,
          options ?? null,
        );
      } catch (err) {
        logger.error("[IntentService] resolveAndTranscodeToOpus failed:", err);
        return null;
      }
    }
    return null;
  },

  /**
   * Granule-based duration probe (C++ `probe_audio_duration_ms`). Authoritative
   * for Ogg/Opus: it skips the `-1` / 0xFFFFFFFFFFFFFFFF sentinel page that some
   * encoders (WhatsApp) append, unlike `MediaMetadataRetriever`. Returns -1 when
   * unknown. Debug aid: compare against the MediaMetadataRetriever value.
   */
  probeAudioDurationMs: async (fileUri: string): Promise<number> => {
    try {
      return await EkweNative.probeAudioDurationMs(fileUri);
    } catch (err) {
      logger.error("[IntentService] probeAudioDurationMs failed:", err);
      return -1;
    }
  },

  dismissNativeLoader: (): void => {
    if (isAndroid) {
      EkweNative.dismissNativeLoader?.();
    }
  },

  dismissEcho: (): void => {
    if (isAndroid) {
      EkweNative.dismissEcho?.();
    }
  },
};

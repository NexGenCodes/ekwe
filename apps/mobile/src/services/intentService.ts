import EkweNative from "../../modules/ekwe-native";

import { MAX_AUDIO_BYTES } from "@ekwe/shared/plans";
import { isAndroid } from "@/utils";
import logger from "@/utils/logger";
import type { OpusTranscodeResult } from "../../modules/ekwe-native/src/EkweNative.types";

/**
 * A JS-only OTA update can run on a binary whose native module predates the
 * `options` argument. Expo Modules rejects the extra argument with
 * `InvalidArgsNumberException`; on R8-minified Android builds that surfaces as
 * a `NoSuchMethodError` instead of a readable argument error.
 */
function isNativeArgsMismatch(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /InvalidArgsNumberException|NoSuchMethodError/i.test(message);
}

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
      const maxDurationMs = options?.maxDurationMs;
      try {
        // Only pass `options` when it carries a value. A 3-argument call is
        // accepted by both the current native module and the pre-options
        // signature, so the common path cannot trip an OTA/native mismatch.
        return maxDurationMs
          ? await EkweNative.resolveAndTranscodeToOpus(
              contentUri,
              outputPath,
              MAX_AUDIO_BYTES,
              { maxDurationMs },
            )
          : await EkweNative.resolveAndTranscodeToOpus(
              contentUri,
              outputPath,
              MAX_AUDIO_BYTES,
            );
      } catch (err) {
        if (!maxDurationMs || !isNativeArgsMismatch(err)) {
          logger.error(
            "[IntentService] resolveAndTranscodeToOpus failed:",
            err,
          );
          return null;
        }
      }

      // An OTA update shipped the 4-argument call to a binary built before
      // `options` existed. Retry the legacy signature rather than failing the
      // share; the legacy native cap is wider than the plan cap, so enforce the
      // caller's limit on the returned duration.
      try {
        const result = await EkweNative.resolveAndTranscodeToOpus(
          contentUri,
          outputPath,
          MAX_AUDIO_BYTES,
        );
        if (
          result.success &&
          maxDurationMs > 0 &&
          result.durationMs > maxDurationMs
        ) {
          return {
            ...result,
            success: false,
            error: "AUDIO_TOO_LONG",
            waveform: [],
          };
        }
        return result;
      } catch (err) {
        logger.error(
          "[IntentService] resolveAndTranscodeToOpus legacy call failed:",
          err,
        );
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

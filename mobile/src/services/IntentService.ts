import { Linking } from "react-native";

import EkweNative from "../../modules/ekwe-native";

import { isAndroid } from "@/utils";
import logger from "@/utils/logger";
import type { ExtractWavAndWaveformResult } from "../../modules/ekwe-native/src/EkweNative.types";

export const IntentService = {
  resolveToFileUri: async (rawUri: string): Promise<string | null> => {
    if (isAndroid && rawUri.startsWith("content://")) {
      return EkweNative.resolveContentUri(rawUri);
    }
    return rawUri;
  },

  // ─── Combined resolve + FLAC conversion (no temp file) ──────────────
  // Reads content:// URI directly into memory, passes to C++ decoder,
  // encodes to FLAC, returns path + waveform + duration.
  // Available on Android only; falls back to separate resolve+convert on iOS.
  resolveAndConvertToFlac: async (
    contentUri: string,
    outputPath: string,
  ): Promise<ExtractWavAndWaveformResult | null> => {
    if (isAndroid && contentUri.startsWith("content://")) {
      try {
        return await EkweNative.resolveAndConvertToFlac(contentUri, outputPath);
      } catch (err) {
        logger.error(
          "[IntentService] resolveAndConvertToFlac failed:",
          err,
        );
        return null;
      }
    }
    // iOS: return null so caller falls back to resolveToFileUri + AudioConverter
    return null;
  },

  dismissNativeLoader: (): void => {
    if (isAndroid) {
      EkweNative.dismissNativeLoader();
    }
  },

  updateBubbleMode: (mode: "IDLE" | "MAGIC" | "RECORD"): void => {
    try {
      EkweNative?.updateBubbleMode?.(mode);
    } catch (err) {
      logger.warn("[IntentService] updateBubbleMode failed", err);
    }
  },

  dismissAndRedirect: (): void => {
    EkweNative.dismissEcho();
    Linking.openURL("ekwe://");
  },

  dismissEcho: (): void => {
    if (isAndroid) {
      EkweNative.dismissEcho();
    }
  },
};

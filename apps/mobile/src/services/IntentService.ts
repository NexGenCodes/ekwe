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

  // ─── Combined resolve + Ogg Opus conversion (no temp file) ──────────────
  resolveAndConvertToOpus: async (
    contentUri: string,
    outputPath: string,
  ): Promise<ExtractWavAndWaveformResult | null> => {
    if (isAndroid && contentUri.startsWith("content://")) {
      try {
        return await EkweNative.resolveAndConvertToOpus(contentUri, outputPath);
      } catch (err) {
        logger.error("[IntentService] resolveAndConvertToOpus failed:", err);
        return null;
      }
    }
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

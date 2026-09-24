import EkweNative from "../../modules/ekwe-native";

import { MAX_AUDIO_BYTES } from "@ekwe/shared/plans";
import { isAndroid } from "@/utils";
import logger from "@/utils/logger";
import type { OpusTranscodeResult } from "../../modules/ekwe-native/src/EkweNative.types";

export const IntentService = {
  resolveToFileUri: async (rawUri: string): Promise<string | null> => {
    if (isAndroid && rawUri.startsWith("content://")) {
      return EkweNative.resolveContentUri(rawUri, MAX_AUDIO_BYTES);
    }
    return rawUri;
  },

  resolveAndTranscodeToOpus: async (
    contentUri: string,
    outputPath: string,
  ): Promise<OpusTranscodeResult | null> => {
    if (isAndroid && contentUri.startsWith("content://")) {
      try {
        return await EkweNative.resolveAndTranscodeToOpus(
          contentUri,
          outputPath,
          MAX_AUDIO_BYTES,
        );
      } catch (err) {
        logger.error("[IntentService] resolveAndTranscodeToOpus failed:", err);
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

  dismissEcho: (): void => {
    if (isAndroid) {
      EkweNative.dismissEcho();
    }
  },
};

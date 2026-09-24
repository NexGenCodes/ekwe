import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { ShareOutService, mimeFor, utiFor } from "@/services/shareOutService";
import logger from "@/utils/logger";

const OGG_OPUS_MIME = "audio/ogg; codecs=opus";

export async function shareVoiceNoteToWhatsApp(
  audioPath: string,
): Promise<void> {
  try {
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      throw new Error("Sharing is not available on this device.");
    }

    const shareable = await ShareOutService.ensureShareable(audioPath);

    const shareablePath =
      Platform.OS === "android" && !shareable.startsWith("file://")
        ? `file://${shareable}`
        : shareable;

    const ext = shareablePath.split(".").pop()?.toLowerCase();
    const isOgg = ext === "ogg" || ext === "opus";

    await Sharing.shareAsync(shareablePath, {
      mimeType: isOgg ? OGG_OPUS_MIME : mimeFor(shareablePath),
      UTI: utiFor(shareablePath),
      dialogTitle: "Share to WhatsApp",
    });
  } catch (error) {
    logger.error("WhatsApp share failed", error);
    throw error;
  }
}

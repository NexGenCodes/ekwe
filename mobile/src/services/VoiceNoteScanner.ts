import {
  Query,
  AssetField,
  MediaType,
  requestPermissionsAsync,
} from "expo-media-library";

import { isAndroid } from "@/utils";

export interface RecentVoiceNote {
  uri: string;
  filename: string;
  packageName: string;
  creationTime: number;
}

export const VoiceNoteScanner = {
  /**
   * Scans for the most recent voice note from a specific app.
   * Looks for files created in the last 5 minutes.
   */
  async findRecentVoiceNote(
    packageName: string,
  ): Promise<RecentVoiceNote | null> {
    if (!isAndroid) return null;

    const { status } = await requestPermissionsAsync();
    if (status !== "granted") return null;

    const fiveMinutesAgo = (Date.now() - 5 * 60 * 1000) / 1000;

    const assets = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
      .orderBy({ key: AssetField.CREATION_TIME, ascending: false })
      .limit(20)
      .exe();

    for (const asset of assets) {
      const creationTime = await asset.getCreationTime();
      if (!creationTime || creationTime < fiveMinutesAgo) continue;

      const uri = await asset.getUri();
      const filename = await asset.getFilename();

      // WhatsApp voice notes usually have 'WhatsApp' in path or filename starts with 'PTT'
      // Telegram usually has 'Telegram' in path
      const isWhatsApp =
        packageName === "com.whatsapp" &&
        (uri.includes("WhatsApp") || filename.startsWith("PTT"));

      const isTelegram =
        packageName === "org.telegram.messenger" && uri.includes("Telegram");

      if (isWhatsApp || isTelegram) {
        return {
          uri,
          filename,
          packageName,
          creationTime: creationTime * 1000,
        };
      }
    }

    return null;
  },
};

import * as MediaLibrary from 'expo-media-library';
import { isAndroid } from '@/utils';

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

    const { status } = await MediaLibrary.requestPermissionsAsync();
    if (status !== 'granted') return null;

    // We search for all audio files
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    const assets = await MediaLibrary.getAssetsAsync({
      mediaType: 'audio',
      sortBy: [[MediaLibrary.SortBy.creationTime, false]], // Newest first
      first: 20, // Check first 20 recent files
    });

    for (const asset of assets.assets) {
      if (asset.creationTime < fiveMinutesAgo) continue;

      const info = await MediaLibrary.getAssetInfoAsync(asset);
      const uri = info.localUri || info.uri;

      // WhatsApp voice notes usually have 'WhatsApp' in path or filename starts with 'PTT'
      // Telegram usually has 'Telegram' in path
      const isWhatsApp =
        packageName === 'com.whatsapp' &&
        (uri.includes('WhatsApp') || asset.filename.startsWith('PTT'));

      const isTelegram =
        packageName === 'org.telegram.messenger' && uri.includes('Telegram');

      if (isWhatsApp || isTelegram) {
        return {
          uri,
          filename: asset.filename,
          packageName,
          creationTime: asset.creationTime,
        };
      }
    }

    return null;
  },
};

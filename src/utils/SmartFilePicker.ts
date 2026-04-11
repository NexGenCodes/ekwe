import * as DocumentPicker from 'expo-document-picker';

export const SmartFilePicker = {
  /**
   * Opens a file picker specifically for audio files.
   * In the future, this can be refined with SAF (Storage Access Framework)
   * to open directly in the WhatsApp/Telegram folders based on context.
   */
  async pickAudio(): Promise<string | null> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        return result.assets[0].uri;
      }
      return null;
    } catch (err) {
      console.error('[SmartFilePicker] Failed to pick file:', err);
      return null;
    }
  },
};

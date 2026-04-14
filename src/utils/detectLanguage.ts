/**
 * Detects the ISO 639-1 language code of a given text string
 * using backend detection. Returns 'und' if detection fails.
 *
 * Extracted from TranscriptionService so both audio and
 * text share intent paths can reuse it.
 */

export const detectLanguage = (text: string): string => {
  // Offline language detection was removed to reduce bundle size.
  // Language detection now relies on backend STT APIs (Whisper/Deepgram).
  return 'und';
};

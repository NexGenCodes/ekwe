import { File as ExpoFile } from 'expo-file-system';

import { EkweError } from '@/constants/errors';
import { LANGUAGES } from '@/constants/languages';
import { ProcessedAudio } from '@/services/AudioProcessor';
import { Result, ok, err } from '@/types/Result';
import { getAuthHeaders } from '@/utils/authHeaders';
import { detectLanguage } from '@/utils/detectLanguage';
import { fetchWithRetry } from '@/utils/networkUtils';
import { removeFillerWords } from '@/utils/removeFiller';

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? '';

const HALLUCINATION_PATTERNS = [
  'thank you for watching',
  'thanks for watching',
  'please subscribe',
  'like and subscribe',
  'subtitles by',
  'transcribed by',
  'www.',
  'http',
];

const MAX_WORDS_PER_SECOND = 6;
const MIN_WORDS_PER_SECOND = 0.3;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB Groq limit

export interface WordTimestamp {
  word: string;
  start: number; // seconds
  end: number;
}

export interface TranscriptionResult {
  transcript: string;
  detectedLang: string;
  sourceLang: string;
  wordTimestamps: WordTimestamp[];
  durationSeconds: number;
  isLowQuality: boolean;
  fillerWordsRemoved: number;
  languageMismatch?: {
    expected: string;
    detected: string;
  };
}

class TranscriptionServiceClass {
  /**
   * Transcribes a processed audio recording.
   * Sends the file to the Worker /transcribe endpoint.
   */
  async transcribe(
    audio: ProcessedAudio,
    sourceLang: string,
  ): Promise<Result<TranscriptionResult, EkweError>> {
    try {
      const file = new ExpoFile(audio.uri);
      if (!file.exists) {
        return err(EkweError.SHARE_COPY_FAIL);
      }

      const size = file.size;
      if (size && size > MAX_FILE_SIZE_BYTES) {
        return err(EkweError.FILE_TOO_LARGE);
      }

      const workerUrl = getWorkerUrl();
      if (!workerUrl) {
        console.error('DEBUG: workerUrl is EMPTY!');
        return err(EkweError.NETWORK_LOST);
      }

      // Detect MIME type and extension
      const extension = audio.uri.split('.').pop()?.toLowerCase() || 'm4a';
      const mimeType = this.getMimeType(extension);

      // Build the multipart form
      const formData = new FormData();
      formData.append('file', {
        uri: audio.uri,
        type: mimeType,
        name: `recording.${extension}`,
      } as unknown as Blob);

      formData.append('language', sourceLang || 'auto');
      formData.append('timestamp_granularities', 'word');

      const headers = await getAuthHeaders();

      const response = await fetchWithRetry(`${workerUrl}/transcribe`, {
        method: 'POST',
        headers,
        body: formData,
        retries: 3,
        timeout: 45000,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        console.error(
          'Transcription FAIL: non-ok response',
          response.status,
          body,
        );
        return this.mapErrorCode(body.error ?? 'EKWE_TRANSCRIPTION_FAIL');
      }

      const data = (await response.json()) as {
        text: string;
        words?: { word: string; start: number; end: number }[];
        language?: string;
      };

      return this.processTranscript(
        data.text,
        data.words ?? [],
        data.language ?? sourceLang,
        sourceLang,
        audio,
      );
    } catch (e: any) {
      console.error('Transcription FAIL: exception', e.message);
      return err(EkweError.NETWORK_LOST);
    }
  }

  private getMimeType(extension: string): string {
    const map: Record<string, string> = {
      ogg: 'audio/ogg',
      opus: 'audio/opus',
      m4a: 'audio/m4a',
      mp4: 'audio/mp4',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
    };
    return map[extension] || 'audio/m4a';
  }

  /**
   * Processes the raw transcript from Groq.
   * Runs detection, filler removal, and hallucination checks.
   */
  private processTranscript(
    rawText: string,
    words: { word: string; start: number; end: number }[],
    returnedLang: string,
    sourceLang: string,
    audio: ProcessedAudio,
  ): Result<TranscriptionResult, EkweError> {
    if (rawText.trim().length === 0) {
      return err(EkweError.EMPTY_TRANSCRIPT);
    }

    // Hallucination detection
    if (this.isHallucination(rawText, audio.durationMs)) {
      return err(EkweError.EMPTY_TRANSCRIPT);
    }

    // Language detection
    const detectedLang = this.detectLanguage(rawText);

    // Filler word removal
    const language = LANGUAGES.find((l) => l.code === sourceLang);
    const fillerWords = language?.fillerWords ?? [];
    const cleaned = removeFillerWords(rawText, fillerWords);
    const fillerWordsRemoved =
      this.countWords(rawText) - this.countWords(cleaned);

    // Adjust word timestamps for trim offset
    const trimOffsetSeconds = audio.trimStartMs / 1000;
    const adjustedWords: WordTimestamp[] = words.map((w) => ({
      word: w.word,
      start: w.start + trimOffsetSeconds,
      end: w.end + trimOffsetSeconds,
    }));

    return ok({
      transcript: cleaned.trim(),
      detectedLang,
      sourceLang,
      wordTimestamps: adjustedWords,
      durationSeconds: audio.durationMs / 1000,
      isLowQuality: audio.averageDb < -60, // Recalibrated for dB
      fillerWordsRemoved,
      languageMismatch: this.getLanguageMismatch(returnedLang, sourceLang),
    });
  }

  private getLanguageMismatch(detected: string, expected: string) {
    if (expected === 'auto' || !detected) return undefined;

    // Normalize (some providers return 'en', some 'english')
    const d = detected.toLowerCase();
    const e = expected.toLowerCase();

    if (d !== e && d.substring(0, 2) !== e.substring(0, 2)) {
      return { expected, detected };
    }
    return undefined;
  }

  /**
   * Detects language via shared utility.
   */
  detectLanguage(text: string): string {
    return detectLanguage(text);
  }

  /**
   * Checks if a transcript is likely a Whisper hallucination.
   */
  isHallucination(text: string, durationMs: number): boolean {
    const words = this.countWords(text);
    const durationSeconds = durationMs / 1000;

    if (durationSeconds > 0) {
      const wps = words / durationSeconds;
      if (wps > MAX_WORDS_PER_SECOND) return true;
      if (words > 3 && wps < MIN_WORDS_PER_SECOND) return true;
    }

    const lower = text.toLowerCase();
    return HALLUCINATION_PATTERNS.some((p) => lower.includes(p));
  }

  private countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
  }

  private mapErrorCode(code: string): Result<never, EkweError> {
    const map: Record<string, EkweError> = {
      EKWE_NETWORK_LOST: EkweError.NETWORK_LOST,
      EKWE_ALL_PROVIDERS_FAIL: EkweError.ALL_PROVIDERS_FAIL,
      EKWE_SHARE_COPY_FAIL: EkweError.SHARE_COPY_FAIL,
      EKWE_EMPTY_TRANSCRIPT: EkweError.EMPTY_TRANSCRIPT,
      EKWE_TRANSCRIPTION_FAIL: EkweError.TRANSCRIPTION_FAIL,
      EKWE_TRANSCRIBE_TIMEOUT: EkweError.TRANSCRIBE_TIMEOUT,
    };
    return err(map[code] ?? EkweError.TRANSCRIPTION_FAIL);
  }
}

export const TranscriptionService = new TranscriptionServiceClass();

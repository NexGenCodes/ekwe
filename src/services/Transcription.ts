import * as FileSystem from 'expo-file-system';
import { EkweError } from 'src/constants/errors';
import { LANGUAGES } from 'src/constants/languages';
import { ProcessedAudio } from 'src/services/AudioProcessor';
import { Result, ok, err } from 'src/types/Result';
import { removeFillerWords } from 'src/utils/removeFiller';

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
}

class TranscriptionServiceClass {
  /**
   * Transcribes a processed audio recording.
   * Sends the file to the Worker /transcribe endpoint.
   * Runs language detection, filler word removal,
   * and hallucination checks before returning.
   */
  async transcribe(
    audio: ProcessedAudio,
    sourceLang: string,
  ): Promise<Result<TranscriptionResult, EkweError>> {
    // Read the file and check size
    const fileInfo = await FileSystem.getInfoAsync(audio.uri);

    if (!fileInfo.exists) {
      return err(EkweError.SHARE_COPY_FAIL);
    }

    if (fileInfo.exists && fileInfo.size > MAX_FILE_SIZE_BYTES) {
      return err(EkweError.BAD_FORMAT);
    }

    const workerUrl = getWorkerUrl();
    if (workerUrl.length === 0) {
      return err(EkweError.NETWORK_LOST);
    }

    // Build the multipart form
    const formData = new FormData();

    formData.append('file', {
      uri: audio.uri,
      type: 'audio/m4a',
      name: 'recording.m4a',
    } as unknown as Blob);

    formData.append('language', sourceLang);
    formData.append('timestamp_granularities', 'word');

    try {
      const response = await fetch(`${workerUrl}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const body = (await response.json()) as {
          error?: string;
        };
        return this.mapErrorCode(body.error ?? 'EKWE_TRANSCRIPTION_FAIL');
      }

      const data = (await response.json()) as {
        text: string;
        words?: {
          word: string;
          start: number;
          end: number;
        }[];
        language?: string;
      };

      return this.processTranscript(
        data.text,
        data.words ?? [],
        data.language ?? sourceLang,
        sourceLang,
        audio,
      );
    } catch {
      return err(EkweError.NETWORK_LOST);
    }
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

    // Language detection with franc-min
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
      isLowQuality: audio.averageAmplitude < 0.1,
      fillerWordsRemoved,
    });
  }

  /**
   * Detects language using franc-min.
   * Returns the detected ISO 639-1 code or the fallback.
   */
  detectLanguage(text: string): string {
    try {
      // franc returns ISO 639-3, we need 639-1
      // Use a minimal mapping for the languages Ekwe supports
      const { franc } = require('franc-min') as {
        franc: (text: string) => string;
      };
      const iso3 = franc(text);
      return this.iso3ToIso1(iso3);
    } catch {
      return 'und'; // undetermined
    }
  }

  /**
   * Checks if a transcript is likely a Whisper hallucination.
   * Uses words-per-second ratio and known hallucination patterns.
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

  private iso3ToIso1(iso3: string): string {
    const map: Record<string, string> = {
      eng: 'en',
      spa: 'es',
      ita: 'it',
      deu: 'de',
      zho: 'zh',
      fra: 'fr',
      por: 'pt',
      rus: 'ru',
      jpn: 'ja',
      kor: 'ko',
      ara: 'ar',
      hin: 'hi',
      nld: 'nl',
      pol: 'pl',
      tur: 'tr',
      swe: 'sv',
      dan: 'da',
      fin: 'fi',
      nor: 'nb',
      ces: 'cs',
      slk: 'sk',
      ron: 'ro',
      hun: 'hu',
      ukr: 'uk',
      ell: 'el',
      heb: 'he',
      tha: 'th',
      vie: 'vi',
      ind: 'id',
      msa: 'ms',
      bul: 'bg',
      hrv: 'hr',
      srp: 'sr',
      cat: 'ca',
      lit: 'lt',
      lav: 'lv',
      est: 'et',
      slv: 'sl',
      sqi: 'sq',
      mkd: 'mk',
      afr: 'af',
      ben: 'bn',
      fas: 'fa',
      urd: 'ur',
      swa: 'sw',
      fil: 'tl',
      tam: 'ta',
      tel: 'te',
      mal: 'ml',
      mar: 'mr',
      guj: 'gu',
      pan: 'pa',
      nep: 'ne',
      sin: 'si',
      khm: 'km',
      lao: 'lo',
      mya: 'my',
      kat: 'ka',
    };
    return map[iso3] ?? 'und';
  }

  private mapErrorCode(code: string): Result<never, EkweError> {
    const map: Record<string, EkweError> = {
      EKWE_NETWORK_LOST: EkweError.NETWORK_LOST,
      EKWE_ALL_PROVIDERS_FAIL: EkweError.ALL_PROVIDERS_FAIL,
      EKWE_SHARE_COPY_FAIL: EkweError.SHARE_COPY_FAIL,
      EKWE_EMPTY_TRANSCRIPT: EkweError.EMPTY_TRANSCRIPT,
      EKWE_TRANSCRIPTION_FAIL: EkweError.TRANSCRIPTION_FAIL,
    };
    return err(map[code] ?? EkweError.TRANSCRIPTION_FAIL);
  }
}

export const TranscriptionService = new TranscriptionServiceClass();

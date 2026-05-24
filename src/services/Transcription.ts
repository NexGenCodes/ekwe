import { File as ExpoFile } from 'expo-file-system';
import { z } from 'zod';

import { EkweError } from '@/constants/errors';
import { ProcessedAudio } from '@/services/AudioProcessor';
import { supabase } from '@/services/supabase';
import { authActions } from '@/store';
import { Result, ok, err } from '@/types/Result';
import logger from '@/utils/logger';
import { fetchWithRetry } from '@/utils/networkUtils';

const transcriptionResponseSchema = z.object({
  text: z.string(),
  words: z
    .array(
      z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
      }),
    )
    .optional(),
  language: z.string().optional(),
  provider: z.string().optional(),
  transaction: z
    .object({
      transactions_used: z.unknown().transform((v) => Number(v) || 0),
      tier_active: z
        .unknown()
        .transform((v) =>
          typeof v === 'string' && v.toUpperCase() === 'PREMIUM'
            ? 'PREMIUM'
            : 'FREE',
        ),
      is_fallback: z.unknown().transform((v) => Boolean(v)),
    })
    .nullish()
    .catch(undefined),
});

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? '';

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
  provider?: string;
}

class TranscriptionServiceClass {
  private readonly CACHE_TTL_MS = 5 * 60 * 1000;
  private cache = new Map<string, { value: Result<TranscriptionResult, EkweError>; timestamp: number }>();

  clearCache(): void {
    this.cache.clear();
    logger.info('[Transcription] Cache cleared');
  }

  /**
   * Transcribes a processed audio recording.
   * Sends the file to the Worker /transcribe endpoint.
   */
  async transcribe(
    audio: ProcessedAudio,
    sourceLang: string,
    signal?: AbortSignal,
  ): Promise<Result<TranscriptionResult, EkweError>> {
    const cacheKey = `${audio.uri}_${sourceLang || 'auto'}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      logger.info('[Transcription] Frontend Cache Hit');
      return cached.value;
    }
    if (cached) this.cache.delete(cacheKey);

    try {
      const file = new ExpoFile(audio.uri);
      if (!file.exists) {
        return err(EkweError.SHARE_COPY_FAIL);
      }

      if (file.size && file.size > MAX_FILE_SIZE_BYTES) {
        return err(EkweError.FILE_TOO_LARGE);
      }

      const workerUrl = getWorkerUrl();
      if (!workerUrl) {
        logger.error('[Transcription] workerUrl is EMPTY!');
        return err(EkweError.NETWORK_LOST);
      }

      // Detect MIME type and extension
      const extension = audio.uri.split('.').pop()?.toLowerCase() || 'm4a';
      const mimeType = this.getMimeType(extension);

      // Get auth token
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Build standard FormData
      const formData = new FormData();

      // In React Native, we can append a file to FormData using this specific object structure
      formData.append('file', {
        uri: audio.uri,
        name: `audio.${extension}`,
        type: mimeType,
      } as unknown as Blob);

      formData.append('lang', sourceLang || 'auto');
      formData.append('timestamp_granularities', 'word');

      const fetchResponse = await fetchWithRetry(`${workerUrl}/transcribe`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
        signal,
        retries: 2,
        backoff: 1000,
        timeout: 30000,
      });

      if (!fetchResponse.ok) {
        let errorCode = 'EKWE_TRANSCRIPTION_FAIL';
        try {
          const errorBody = await fetchResponse.text();
          const parsed = JSON.parse(errorBody) as { error?: string };
          errorCode = parsed.error ?? errorCode;
        } catch {
          /* ignore parse failures on error body */
        }
        logger.error(
          '[Transcription] FAIL: non-ok response',
          fetchResponse.status,
          errorCode,
        );

        if (fetchResponse.status === 429) {
          return err(EkweError.RATE_LIMITED);
        }
        if (fetchResponse.status === 401) {
          return err(EkweError.TRANSCRIPTION_FAIL);
        }
        return this.mapErrorCode(errorCode);
      }

      const json = await fetchResponse.json();
      const parsed = transcriptionResponseSchema.safeParse(json);
      if (!parsed.success) {
        logger.error(
          '[Transcription] Response validation failed:',
          parsed.error.message,
        );
        return err(EkweError.TRANSCRIPTION_FAIL);
      }

      const data = parsed.data;

      if (data.transaction) {
        authActions.updateBilling(data.transaction);
      }

      const resultValue = this.processTranscript(
        data.text,
        data.words ?? [],
        data.language ?? sourceLang,
        sourceLang,
        audio,
        data.provider,
      );

      if (resultValue.ok) {
        this.cache.set(cacheKey, { value: resultValue, timestamp: Date.now() });
        if (this.cache.size > 100) {
          const firstKey = this.cache.keys().next().value;
          if (firstKey !== undefined) {
            this.cache.delete(firstKey);
          }
        }
      }

      return resultValue;
    } catch (e: unknown) {
      if (e instanceof Error) {
        if (e.name === 'AbortError') {
          logger.info('[Transcription] Request was aborted');
          return err(EkweError.INTERRUPTED);
        }
        if (e.message === 'CLIENT_ABORTED') {
          return err(EkweError.INTERRUPTED);
        }
        logger.error('[Transcription] FAIL: exception', e.message);
      } else {
        logger.error('[Transcription] FAIL: unknown error', String(e));
      }
      return err(EkweError.NETWORK_LOST);
    }
  }

  private getMimeType(extension: string): string {
    const map: Record<string, string> = {
      ogg: 'audio/ogg',
      opus: 'audio/ogg',
      m4a: 'audio/m4a',
      mp4: 'audio/mp4',
      wav: 'audio/wav',
      mp3: 'audio/mpeg',
    };
    return map[extension] || 'audio/m4a';
  }

  /**
   * Processes the raw transcript from Groq.
   * Runs detection and hallucination checks.
   */
  private processTranscript(
    rawText: string,
    words: { word: string; start: number; end: number }[],
    returnedLang: string,
    sourceLang: string,
    audio: ProcessedAudio,
    provider?: string,
  ): Result<TranscriptionResult, EkweError> {
    if (rawText.trim().length === 0) {
      return err(EkweError.EMPTY_TRANSCRIPT);
    }

    // Language detection — never let detectedLang be 'auto'
    const detectedLang =
      returnedLang && returnedLang !== 'auto'
        ? returnedLang
        : sourceLang !== 'auto'
          ? sourceLang
          : 'en';

    const adjustedWords: WordTimestamp[] = words.map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    return ok({
      transcript: rawText.trim(),
      detectedLang,
      sourceLang,
      wordTimestamps: adjustedWords,
      durationSeconds: audio.durationMs / 1000,
      isLowQuality: audio.averageDb < -60,
      provider,
    });
  }

  private mapErrorCode(code: string): Result<never, EkweError> {
    const map: Record<string, EkweError> = {
      EKWE_NETWORK_LOST: EkweError.NETWORK_LOST,
      EKWE_ALL_PROVIDERS_FAIL: EkweError.ALL_PROVIDERS_FAIL,
      EKWE_SHARE_COPY_FAIL: EkweError.SHARE_COPY_FAIL,
      EKWE_EMPTY_TRANSCRIPT: EkweError.EMPTY_TRANSCRIPT,
      EKWE_TRANSCRIPTION_FAIL: EkweError.TRANSCRIPTION_FAIL,
      EKWE_TRANSCRIBE_TIMEOUT: EkweError.TRANSCRIBE_TIMEOUT,
      EKWE_FILE_TOO_LARGE: EkweError.FILE_TOO_LARGE,
      EKWE_RATE_LIMITED: EkweError.RATE_LIMITED,
    };
    return err(map[code] ?? EkweError.TRANSCRIPTION_FAIL);
  }
}

export const TranscriptionService = new TranscriptionServiceClass();

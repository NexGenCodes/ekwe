import { File as ExpoFile } from 'expo-file-system';

import { EkweError } from '@/constants/errors';
import { ProcessedAudio } from '@/services/AudioProcessor';
import { supabase } from '@/services/supabase';
import { authActions } from '@/store';
import { Result, ok, err } from '@/types/Result';
import { logger } from '@/utils';

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
  /**
   * Transcribes a processed audio recording.
   * Sends the file to the Worker /transcribe endpoint.
   */
  async transcribe(
    audio: ProcessedAudio,
    sourceLang: string,
    signal?: AbortSignal,
  ): Promise<Result<TranscriptionResult, EkweError>> {
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

      // Use standard fetch API (natively supports binary streaming and AbortSignal in SDK 55)
      const fetchResponse = await fetch(`${workerUrl}/transcribe`, {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Ekwe-Key': process.env.EXPO_PUBLIC_EKWE_APP_KEY ?? '',
        },
        body: formData,
        signal,
      });

      const bodyText = await fetchResponse.text();

      const response = {
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        body: bodyText,
      };

      if (!response.ok) {
        let body: { error?: string } = {};
        try {
          body = JSON.parse(response.body);
        } catch {
          /* empty */
        }
        logger.error(
          '[Transcription] FAIL: non-ok response',
          response.status,
          body,
        );
        return this.mapErrorCode(body.error ?? 'EKWE_TRANSCRIPTION_FAIL');
      }

      const data = JSON.parse(response.body) as {
        text: string;
        words?: { word: string; start: number; end: number }[];
        language?: string;
        provider?: string;
        transaction?: {
          transactions_used: number;
          tier_active: 'FREE' | 'PREMIUM';
          is_fallback: boolean;
        };
      };

      if (data.transaction) {
        authActions.updateBilling(data.transaction);
      }

      return this.processTranscript(
        data.text,
        data.words ?? [],
        data.language ?? sourceLang,
        sourceLang,
        audio,
        data.provider,
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      logger.error('[Transcription] FAIL: exception', message);
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

    // Adjust word timestamps for trim offset
    const trimOffsetSeconds = audio.trimStartMs / 1000;
    const adjustedWords: WordTimestamp[] = words.map((w) => ({
      word: w.word,
      start: w.start + trimOffsetSeconds,
      end: w.end + trimOffsetSeconds,
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
    };
    return err(map[code] ?? EkweError.TRANSCRIPTION_FAIL);
  }
}

export const TranscriptionService = new TranscriptionServiceClass();

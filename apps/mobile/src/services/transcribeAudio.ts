import { File as ExpoFile, UploadType } from "expo-file-system";
import { z } from "zod";

import { EkweError } from "@/constants/errors";
import { ProcessedAudio } from "@/services/AudioProcessor";
import { supabase } from "@/services/supabase";
import { Result, ok, err } from "@/types/Result";
import { resolveDetectedLanguage } from "@/utils/languageUtils";
import logger from "@/utils/logger";
import { MAX_AUDIO_BYTES as MAX_FILE_SIZE_BYTES } from "@ekwe/shared/plans";

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
});

const getWorkerUrl = (): string => process.env.EXPO_PUBLIC_WORKER_URL ?? "";

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

export async function transcribeAudio(
  audio: ProcessedAudio,
  sourceLang: string,
  signal?: AbortSignal,
  onProgress?: (fraction: number) => void,
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
      logger.error("[transcribeAudio] workerUrl is EMPTY!");
      return err(EkweError.NETWORK_LOST);
    }

    const extension = audio.uri.split(".").pop()?.toLowerCase() || "m4a";

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const token = session?.access_token;

    const uploadResult = await uploadAudioFile(file, `${workerUrl}/transcribe`, {
      lang: sourceLang || "auto",
      extension,
      token: token ?? null,
      signal,
      onProgress,
    });

    if (uploadResult.status >= 400) {
      let errorCode = "EKWE_TRANSCRIPTION_FAIL";
      try {
        const errorBody = uploadResult.body;
        const parsed = JSON.parse(errorBody) as { error?: string };
        errorCode = parsed.error ?? errorCode;
      } catch {
        /* ignore parse failures on error body */
      }
      logger.error(
        "[transcribeAudio] FAIL: non-ok response",
        uploadResult.status,
        errorCode,
      );

      if (uploadResult.status === 429) {
        return err(EkweError.RATE_LIMITED);
      }
      if (uploadResult.status === 401) {
        return err(EkweError.TRANSCRIPTION_FAIL);
      }
      return mapErrorCode(errorCode);
    }

    const json = JSON.parse(uploadResult.body) as unknown;
    const parsed = transcriptionResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.error(
        "[transcribeAudio] Response validation failed:",
        parsed.error.message,
      );
      return err(EkweError.TRANSCRIPTION_FAIL);
    }

    const data = parsed.data;

    return processTranscript(
      data.text,
      data.words ?? [],
      data.language ?? sourceLang,
      sourceLang,
      audio,
      data.provider,
    );
  } catch (e: unknown) {
    if (e instanceof Error) {
      if (e.name === "AbortError") {
        logger.info("[transcribeAudio] Request was aborted");
        return err(EkweError.INTERRUPTED);
      }
      if (e.message === "CLIENT_ABORTED") {
        return err(EkweError.INTERRUPTED);
      }
      logger.error("[transcribeAudio] FAIL: exception", e.message);
    } else {
      logger.error("[transcribeAudio] FAIL: unknown error", String(e));
    }
    return err(EkweError.NETWORK_LOST);
  }
}

interface UploadAudioFileOptions {
  lang: string;
  extension: string;
  token: string | null;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  timeoutMs?: number;
}

/**
 * Uploads the audio as multipart/form-data using the native upload task
 * (expo-file-system), which reports real byte-level progress and streams the
 * file from disk instead of buffering it in JS. Retries only on network-level
 * failures; an HTTP response (including 5xx, where the worker has already run
 * the provider pipeline) is returned as-is.
 */
async function uploadAudioFile(
  file: ExpoFile,
  url: string,
  opts: UploadAudioFileOptions,
): Promise<{ status: number; body: string }> {
  const retries = 2;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);

    try {
      const task = file.createUploadTask(url, {
        httpMethod: "POST",
        uploadType: UploadType.MULTIPART,
        fieldName: "file",
        mimeType: getMimeType(opts.extension),
        parameters: {
          lang: opts.lang,
          timestamp_granularities: "word",
        },
        headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
        signal: controller.signal,
        onProgress: opts.onProgress
          ? ({
              bytesSent,
              totalBytes,
            }: {
              bytesSent: number;
              totalBytes: number;
            }): void => {
              const fraction = totalBytes > 0 ? bytesSent / totalBytes : 1;
              opts.onProgress!(Math.min(1, Math.max(0, fraction)));
            }
          : undefined,
      });
      const result = await task.uploadAsync();
      return { status: result.status, body: result.body };
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      // Don't retry if the user explicitly cancelled the request.
      if (error.name === "AbortError" && opts.signal?.aborted) {
        throw error;
      }

      // Exponential backoff: 1s, 2s
      const wait = 1000 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, wait));
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError ?? new Error("Network request failed");
}

function getMimeType(extension: string): string {
  const map: Record<string, string> = {
    ogg: "audio/ogg",
    m4a: "audio/m4a",
    mp4: "audio/mp4",
    wav: "audio/wav",
    mp3: "audio/mpeg",
  };
  return map[extension] || "audio/ogg";
}

function processTranscript(
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

  const detectedLang = resolveDetectedLanguage(returnedLang, sourceLang, "en");

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
    durationSeconds:
      audio.durationMs > 0
        ? audio.durationMs / 1000
        : adjustedWords.length > 0
          ? adjustedWords[adjustedWords.length - 1].end
          : 0,
    isLowQuality: audio.averageDb < -60,
    provider,
  });
}

function mapErrorCode(code: string): Result<never, EkweError> {
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

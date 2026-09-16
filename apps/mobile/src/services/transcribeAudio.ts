import { File as ExpoFile, UploadType } from "expo-file-system";

import { transcribeResponseSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import {
  MAX_AUDIO_BYTES as MAX_FILE_SIZE_BYTES,
  PREMIUM_LIMITS,
} from "@ekwe/shared/plans";
import { EkweError } from "@/constants/errors";
import { ProcessedAudio } from "@/services/AudioProcessor";
import { supabase } from "@/services/supabase";
import { Result, ok, err } from "@/types/Result";
import { resolveDetectedLanguage } from "@/utils/languageUtils";
import logger from "@/utils/logger";
import { isDefinitelyOffline } from "@/utils/netInfo";
import {
  getWorkerUrl,
  mapWorkerError,
  TimeoutError,
  isTimeoutError,
} from "@/utils/networkUtils";
import { VOICE_NOTE_EXTENSION_TO_MIME } from "@/utils/fileValidation";

export interface TranscriptionResult {
  transcript: string;
  detectedLang: string | null;
  sourceLang: string;
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

    if (file.size === 0) {
      return err(EkweError.AUDIO_EMPTY);
    }

    if (file.size && file.size > MAX_FILE_SIZE_BYTES) {
      return err(EkweError.FILE_TOO_LARGE);
    }

    if (
      audio.durationMs > 0 &&
      audio.durationMs > PREMIUM_LIMITS.dictationDurationMs
    ) {
      return err(EkweError.AUDIO_TOO_LONG);
    }

    if (isDefinitelyOffline()) {
      return err(EkweError.NETWORK_LOST);
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

    const uploadResult = await uploadAudioFile(
      file,
      `${workerUrl}/transcribe`,
      {
        lang: sourceLang || "auto",
        extension,
        durationMs: audio.durationMs,
        token: token ?? null,
        signal,
        onProgress,
      },
    );

    if (uploadResult.status >= 400) {
      let errorCode = "EKWE_TRANSCRIPTION_FAIL";
      try {
        const errorBody = uploadResult.body;
        const parsed = JSON.parse(errorBody) as { error?: string };
        errorCode = parsed.error ?? errorCode;
      } catch {
        /* ignore parse failures on error body */
      }
      // 429 (quota exceeded / rate limited) is an expected, user-facing
      // condition — surface it at warn level so it doesn't flood Sentry as a
      // crash error. Only genuine server failures are error-level.
      if (uploadResult.status === 429) {
        const handled =
          errorCode === WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED
            ? EkweError.QUOTA_EXCEEDED
            : EkweError.RATE_LIMITED;
        logger.warn(
          "[transcribeAudio] FAIL: handled 429",
          uploadResult.status,
          errorCode,
        );
        return err(handled);
      }

      logger.error(
        "[transcribeAudio] FAIL: non-ok response",
        uploadResult.status,
        errorCode,
      );

      if (uploadResult.status === 401) {
        return err(EkweError.TRANSCRIPTION_FAIL);
      }
      return err(mapWorkerError(errorCode, EkweError.TRANSCRIPTION_FAIL));
    }

    const json = JSON.parse(uploadResult.body) as unknown;
    const parsed = transcribeResponseSchema.safeParse(json);
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
      data.language,
      sourceLang,
      audio,
      data.provider,
    );
  } catch (e: unknown) {
    if (isTimeoutError(e)) {
      logger.info("[transcribeAudio] Request timed out");
      return err(EkweError.TRANSCRIBE_TIMEOUT);
    }
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
  durationMs?: number;
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
  const timeoutMs =
    opts.timeoutMs ??
    30_000 + Math.ceil((file.size ?? 0) / (1024 * 1024)) * 2000;
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
          duration: opts.durationMs ? String(Math.round(opts.durationMs)) : "0",
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

      // An abort that wasn't the user's is the internal timeout. Never retry:
      // a request that blew its deadline almost never succeeds on retry, and
      // retrying re-runs the whole provider pipeline. Fail fast and quietly.
      if (!opts.signal?.aborted && controller.signal.aborted) {
        throw new TimeoutError();
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
  return VOICE_NOTE_EXTENSION_TO_MIME[extension] || "audio/ogg";
}

function processTranscript(
  rawText: string,
  returnedLang: string | undefined,
  sourceLang: string,
  audio: ProcessedAudio,
  provider?: string,
): Result<TranscriptionResult, EkweError> {
  if (rawText.trim().length === 0) {
    return err(EkweError.EMPTY_TRANSCRIPT);
  }

  const detectedLang = resolveDetectedLanguage(returnedLang, sourceLang, "en");

  return ok({
    transcript: rawText.trim(),
    detectedLang,
    sourceLang,
    durationSeconds: audio.durationMs > 0 ? audio.durationMs / 1000 : 0,
    isLowQuality: audio.averageDb < -60,
    provider,
  });
}

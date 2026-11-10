import { File as ExpoFile } from "expo-file-system";

import { transcribeResponseSchema, WORKER_ERROR_CODES } from "@ekwe/shared";
import { MAX_AUDIO_INPUT_BYTES } from "@ekwe/shared/plans";
import { EkweError } from "@/constants/errors";
import { ProcessedAudio } from "@/services/audioProcessor";
import { AudioTranscoder } from "@/services/audioTranscoder";
import { getMimeType, uploadMultipart } from "@/services/uploadMultipart";
import { ensureAccessToken } from "@/services/backend";
import { Result, ok, err } from "@/types/Result";
import { isAbortError } from "@/utils/abort";
import { resolveDetectedLanguage } from "@/utils/languageUtils";
import logger from "@/utils/logger";
import { getActivePlanLimits } from "@/utils/planLimits";
import { isDefinitelyOffline } from "@/utils/connectivity";
import { getWorkerUrl, mapWorkerError, isTimeoutError } from "@/utils/http";
import { isQuotaExhausted } from "@/utils/quota";
import EkweNative from "../../modules/ekwe-native";

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
  options?: { origin?: "orb" },
): Promise<Result<TranscriptionResult, EkweError>> {
  if (isQuotaExhausted("transcribe")) {
    return err(EkweError.QUOTA_EXCEEDED);
  }

  let convertedPath: string | null = null;
  let playbackPath: string | null = null;

  try {
    const file = new ExpoFile(audio.uri);
    if (!file.exists) {
      return err(EkweError.SHARE_COPY_FAIL);
    }

    if (file.size === 0) {
      return err(EkweError.AUDIO_EMPTY);
    }

    if (file.size && file.size > MAX_AUDIO_INPUT_BYTES) {
      return err(EkweError.FILE_TOO_LARGE);
    }

    if (
      audio.durationMs > 0 &&
      audio.durationMs > getActivePlanLimits().dictationDurationMs
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

    const artifact = await AudioTranscoder.prepareUploadArtifact(
      audio.uri,
      audio.durationMs,
      sourceLang,
    );
    convertedPath = artifact.isTemporary ? artifact.uri : null;
    playbackPath =
      artifact.playbackUri && artifact.playbackUri !== artifact.uri
        ? artifact.playbackUri
        : null;

    const uploadFile = new ExpoFile(artifact.uri);
    if (
      uploadFile.size &&
      uploadFile.size > getActivePlanLimits().maxAudioBytes
    ) {
      return err(EkweError.FILE_TOO_LARGE);
    }

    const token = await ensureAccessToken();

    const uploadResult = await uploadMultipart(
      uploadFile,
      `${workerUrl}/transcribe`,
      {
        parameters: {
          lang: sourceLang || "auto",
          duration: audio.durationMs
            ? String(Math.round(audio.durationMs))
            : "0",
          ...(options?.origin ? { origin: options.origin } : {}),
        },
        mimeType: getMimeType(artifact.extension),
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
      if (isAbortError(e)) {
        logger.info("[transcribeAudio] Request was aborted");
        return err(EkweError.INTERRUPTED);
      }
      logger.error("[transcribeAudio] FAIL: exception", e.message);
    } else {
      logger.error("[transcribeAudio] FAIL: unknown error", String(e));
    }
    return err(EkweError.NETWORK_LOST);
  } finally {
    for (const path of [convertedPath, playbackPath]) {
      if (!path) continue;
      try {
        await EkweNative.deleteFile(path);
      } catch {
        /* stale cache entries are reclaimed by sweepStaleAudioCache() */
      }
    }
  }
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

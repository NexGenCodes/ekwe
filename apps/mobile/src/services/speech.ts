import { File, Paths } from "expo-file-system";

import {
  synthesizeResponseSchema,
  WORKER_ERROR_CODES,
  VoiceGender,
} from "@ekwe/shared";
import { MAX_AUDIO_BYTES, PREMIUM_LIMITS } from "@ekwe/shared/plans";

import { EkweError } from "@/constants/errors";
import { AudioTranscoder } from "@/services/audioTranscoder";
import { supabase } from "@/services/supabase";
import { getMimeType, uploadMultipart } from "@/services/uploadMultipart";
import { settings$ } from "@/store/settings";
import { Result, ok, err } from "@/types/Result";
import { base64ToBytes } from "@/utils/base64";
import logger from "@/utils/logger";
import { isDefinitelyOffline } from "@/utils/connectivity";
import { getWorkerUrl, isTimeoutError, mapWorkerError } from "@/utils/http";

const SPEECH_TEXT_TIMEOUT_MS = 26_000;
const SPEECH_AUDIO_TIMEOUT_MS = 28_000;

export interface SpeechAudioSource {
  uri: string;
  durationMs: number;
}

export interface SynthesizedAudio {
  uri: string;
  waveform?: number[];
  durationMs: number;
  sourceLang?: string;
  targetLang?: string;
  translated?: boolean;
}

const getExtension = (mime: string): string =>
  /audio\/wav|audio\/x-wav|audio\/wave/i.test(mime) ? "wav" : "mp3";

const resolveGenderSetting = (): VoiceGender | undefined => {
  const value = settings$.voiceGender.peek();
  return value === "default" ? undefined : value;
};

async function getAccessToken(): Promise<string | undefined> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token;
}

async function writeAudioFile(
  bytes: Uint8Array,
  mime: string,
): Promise<string | null> {
  const cacheDir = Paths.cache.uri;
  if (!cacheDir) return null;

  const outputPath = `${cacheDir}ekwe_speech_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}.${getExtension(mime)}`;
  const file = new File(outputPath);
  if (!file.exists) file.create({ intermediates: true });
  file.write(bytes);
  return outputPath;
}

async function normalizeSynthAudio(rawUri: string): Promise<SynthesizedAudio> {
  const result = await AudioTranscoder.transcodeToOpus(rawUri);
  if (!result.ok) {
    logger.warn(
      "[speech] Opus normalization failed, keeping raw audio:",
      result.error,
    );
    return { uri: rawUri, durationMs: 0 };
  }

  try {
    const raw = new File(rawUri);
    if (raw.exists) raw.delete();
  } catch {
    // Best-effort: the startup cache sweep is the backstop.
  }

  return {
    uri: result.value.uri,
    waveform: result.value.waveform,
    durationMs: result.value.durationMs,
  };
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: string };
    return parsed.error ?? "EKWE_SPEECH_FAIL";
  } catch {
    return "EKWE_SPEECH_FAIL";
  }
}

export async function synthesizeSpeech(
  text: string,
  lang: string,
  options?: {
    signal?: AbortSignal;
    voiceId?: string;
    gender?: VoiceGender;
    sourceLang?: string;
  },
): Promise<Result<SynthesizedAudio, EkweError>> {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > PREMIUM_LIMITS.maxTextChars) {
    return err(EkweError.SPEECH_FAIL);
  }
  if (isDefinitelyOffline()) {
    return err(EkweError.NETWORK_LOST);
  }

  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    logger.error("[speech] workerUrl is EMPTY!");
    return err(EkweError.NETWORK_LOST);
  }

  try {
    const token = await getAccessToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      SPEECH_TEXT_TIMEOUT_MS,
    );
    const onAbort = (): void => controller.abort();
    options?.signal?.addEventListener("abort", onAbort);

    let response: Response;
    try {
      response = await fetch(`${workerUrl}/synthesize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          text: trimmed,
          targetLang: lang,
          ...(options?.sourceLang ? { sourceLang: options.sourceLang } : {}),
          gender: options?.gender ?? resolveGenderSetting(),
          voiceId: options?.voiceId ?? settings$.voiceId.peek() ?? undefined,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      options?.signal?.removeEventListener("abort", onAbort);
    }

    if (response.status >= 400) {
      const errorCode = await readErrorCode(response);
      logger.error(
        "[speech] FAIL: non-ok response",
        response.status,
        errorCode,
      );
      return err(mapWorkerError(errorCode, EkweError.SPEECH_FAIL));
    }

    const parsed = synthesizeResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) {
      logger.error(
        "[speech] Response validation failed:",
        parsed.error.message,
      );
      return err(EkweError.SPEECH_FAIL);
    }

    const rawUri = await writeAudioFile(
      base64ToBytes(parsed.data.audioBase64),
      parsed.data.mime,
    );
    if (!rawUri) return err(EkweError.SPEECH_FAIL);

    return ok(await normalizeSynthAudio(rawUri));
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      logger.info("[speech] Request was aborted");
      return err(EkweError.INTERRUPTED);
    }
    logger.error("[speech] FAIL: exception", e);
    return err(EkweError.NETWORK_LOST);
  }
}

export async function synthesizeAudio(
  audio: SpeechAudioSource,
  sourceLang: string,
  targetLang: string,
  options?: {
    signal?: AbortSignal;
    onProgress?: (fraction: number) => void;
    voiceId?: string;
    gender?: VoiceGender;
  },
): Promise<Result<SynthesizedAudio, EkweError>> {
  try {
    const file = new File(audio.uri);
    if (!file.exists) {
      return err(EkweError.SHARE_COPY_FAIL);
    }
    if (file.size === 0) {
      return err(EkweError.AUDIO_EMPTY);
    }
    if (file.size && file.size > MAX_AUDIO_BYTES) {
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
      logger.error("[speech] workerUrl is EMPTY!");
      return err(EkweError.NETWORK_LOST);
    }

    const extension = audio.uri.split(".").pop()?.toLowerCase() || "m4a";
    const token = await getAccessToken();

    const parameters: Record<string, string> = {
      lang: sourceLang || "auto",
      targetLang,
      duration: audio.durationMs ? String(Math.round(audio.durationMs)) : "0",
    };
    const voiceId = options?.voiceId ?? settings$.voiceId.peek();
    if (voiceId) parameters.voiceId = voiceId;
    const gender = options?.gender ?? resolveGenderSetting();
    if (gender) parameters.gender = gender;

    const upload = await uploadMultipart(file, `${workerUrl}/synthesize`, {
      parameters,
      mimeType: getMimeType(extension),
      token: token ?? null,
      signal: options?.signal,
      onProgress: options?.onProgress,
      timeoutMs: SPEECH_AUDIO_TIMEOUT_MS,
    });

    if (upload.status >= 400) {
      let errorCode = "EKWE_SPEECH_FAIL";
      try {
        const parsed = JSON.parse(upload.body) as { error?: string };
        errorCode = parsed.error ?? errorCode;
      } catch {
        /* ignore parse failures on error body */
      }

      if (upload.status === 429) {
        const handled =
          errorCode === WORKER_ERROR_CODES.EKWE_QUOTA_EXCEEDED
            ? EkweError.QUOTA_EXCEEDED
            : EkweError.RATE_LIMITED;
        logger.warn("[speech] FAIL: handled 429", upload.status, errorCode);
        return err(handled);
      }

      logger.error("[speech] FAIL: non-ok response", upload.status, errorCode);
      return err(mapWorkerError(errorCode, EkweError.SPEECH_FAIL));
    }

    const parsed = synthesizeResponseSchema.safeParse(
      JSON.parse(upload.body) as unknown,
    );
    if (!parsed.success) {
      logger.error(
        "[speech] Response validation failed:",
        parsed.error.message,
      );
      return err(EkweError.SPEECH_FAIL);
    }

    const data = parsed.data;
    const rawUri = await writeAudioFile(
      base64ToBytes(data.audioBase64),
      data.mime,
    );
    if (!rawUri) return err(EkweError.SPEECH_FAIL);

    const normalized = await normalizeSynthAudio(rawUri);

    return ok({
      uri: normalized.uri,
      durationMs: normalized.durationMs ?? data.durationMs ?? 0,
      waveform: normalized.waveform,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang,
      translated: data.translated,
    });
  } catch (e: unknown) {
    if (isTimeoutError(e)) {
      logger.info("[speech] Audio request timed out");
      return err(EkweError.TRANSCRIBE_TIMEOUT);
    }
    if (e instanceof Error) {
      if (e.name === "AbortError" || e.message === "CLIENT_ABORTED") {
        logger.info("[speech] Request was aborted");
        return err(EkweError.INTERRUPTED);
      }
      logger.error("[speech] FAIL: exception", e.message);
    } else {
      logger.error("[speech] FAIL: unknown error", String(e));
    }
    return err(EkweError.NETWORK_LOST);
  }
}

import { File, Paths } from "expo-file-system";

import {
  synthesizeResponseSchema,
  WORKER_ERROR_CODES,
  VoiceGender,
} from "@ekwe/shared";
import { MAX_AUDIO_INPUT_BYTES } from "@ekwe/shared/plans";

import { EkweError } from "@/constants/errors";
import { AudioTranscoder } from "@/services/audioTranscoder";
import { supabase } from "@/services/supabase";
import { getMimeType, uploadMultipart } from "@/services/uploadMultipart";
import { settings$ } from "@/store/settings";
import { Result, ok, err } from "@/types/Result";
import logger from "@/utils/logger";
import { getActivePlanLimits } from "@/utils/planLimits";
import { isDefinitelyOffline } from "@/utils/connectivity";
import { headerValue, parseServerTiming } from "@/utils/perfSpan";
import {
  fetchWithRetry,
  getWorkerUrl,
  isTimeoutError,
  mapWorkerError,
} from "@/utils/http";

const SPEECH_TEXT_TIMEOUT_MS = 26_000;
const SPEECH_AUDIO_TIMEOUT_MS = 28_000;

export interface SpeechAudioSource {
  uri: string;
  durationMs: number;
}

/**
 * Clip delivery mode.
 * - `shareable`: Ogg/Opus for Telegram voice-note compatibility; WhatsApp's
 *   share path still delivers an ordinary audio attachment.
 * - `playback`: Uses the provider's native format, skipping re-encoding.
 */
export type SynthDelivery = "shareable" | "playback";

export interface SynthesizedAudio {
  uri: string;
  waveform?: number[];
  durationMs: number;
  /**
   * An M4A playback copy of `uri`, encoded during synthesis so playback opens it
   * directly instead of decoding the Ogg/Opus artifact lazily on first play. Null
   * when the eager encode failed; the player then derives the copy at play time.
   */
  playbackUri?: string | null;
  sourceLang?: string;
  targetLang?: string;
  translated?: boolean;
  /** The spoken text. Null for older workers that predate this field. */
  transcript?: string | null;
  /** The translation that was rendered, when one was produced. */
  translation?: string | null;
  /** True when translation was truncated due to budget limits. */
  translationTruncated?: boolean;
}

/** Fetches synthesized audio bytes from the URL returned by the worker. */
async function fetchSynthAudio(audioUrl: string): Promise<Uint8Array | null> {
  // Resolve relative paths against the worker base URL.
  const base = getWorkerUrl();
  const url = audioUrl.startsWith("http")
    ? audioUrl
    : `${base.replace(/\/$/, "")}${audioUrl}`;

  const res = await fetchWithRetry(url, { method: "GET" });
  if (!res.ok) {
    logger.warn("[speech] audio fetch failed", res.status, url);
    return null;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return bytes.byteLength > 0 ? bytes : null;
}

/** Returns the file extension matching the response MIME type for correct container identification. */
const getExtension = (mime: string): string => {
  if (/audio\/ogg/i.test(mime)) return "ogg";
  if (/audio\/wav|audio\/x-wav|audio\/wave/i.test(mime)) return "wav";
  return "mp3";
};

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

/** Transcodes provider audio to Ogg/Opus for shareable artifacts. Preview clips bypass this. */
async function normalizeSynthAudio(
  rawUri: string,
): Promise<
  Result<
    Pick<SynthesizedAudio, "uri" | "waveform" | "durationMs" | "playbackUri">,
    EkweError
  >
> {
  const result = await AudioTranscoder.transcodeToOpus(rawUri);

  // The provider's container is a throwaway once transcoded, so drop it on both
  // outcomes rather than leaking it when the transcode fails.
  try {
    const raw = new File(rawUri);
    if (raw.exists) raw.delete();
  } catch {
    // Best-effort: the startup cache sweep is the backstop.
  }

  if (!result.ok) {
    logger.error(
      "[speech] Opus normalization failed, cannot produce a shareable artifact:",
      result.error,
    );
    return err(EkweError.PROCESSOR_FAIL);
  }

  // Encode the M4A playback copy up front, during the convert, so first play
  // never has to decode the Ogg lazily. A failure here is non-fatal: the player
  // still derives the copy at play time.
  const playback = await AudioTranscoder.createPlaybackCopyForPlayback(
    result.value.uri,
  );

  return ok({
    uri: result.value.uri,
    waveform: result.value.waveform,
    durationMs: result.value.durationMs,
    playbackUri: playback.ok ? playback.value : null,
  });
}

async function readErrorCode(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: string };
    return parsed.error ?? "EKWE_SPEECH_FAIL";
  } catch {
    return "EKWE_SPEECH_FAIL";
  }
}

type SynthData = ReturnType<typeof synthesizeResponseSchema.parse>;

/**
 * Shared POST → validate → download → write pipeline for the JSON synth
 * endpoints (`/synthesize`, `/voice-preview`). Returns the parsed response
 * alongside the on-disk URI of the downloaded audio.
 */
async function requestSynthClip(opts: {
  path: "/synthesize" | "/voice-preview";
  body: Record<string, unknown>;
  logTag: string;
  signal?: AbortSignal;
}): Promise<Result<{ data: SynthData; rawUri: string }, EkweError>> {
  const workerUrl = getWorkerUrl();
  if (!workerUrl) {
    logger.error(`${opts.logTag} workerUrl is EMPTY!`);
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
    opts.signal?.addEventListener("abort", onAbort);

    let response: Response;
    try {
      response = await fetch(`${workerUrl}${opts.path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    if (response.status >= 400) {
      const errorCode = await readErrorCode(response);
      logger.error(
        `${opts.logTag} FAIL: non-ok response`,
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
        `${opts.logTag} Response validation failed:`,
        parsed.error.message,
      );
      return err(EkweError.SPEECH_FAIL);
    }

    const audioBytes = await fetchSynthAudio(parsed.data.audioUrl);
    if (!audioBytes) return err(EkweError.SPEECH_FAIL);

    const rawUri = await writeAudioFile(audioBytes, parsed.data.mime);
    if (!rawUri) return err(EkweError.SPEECH_FAIL);

    return ok({ data: parsed.data, rawUri });
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      logger.info(`${opts.logTag} Request was aborted`);
      return err(EkweError.INTERRUPTED);
    }
    logger.error(`${opts.logTag} FAIL: exception`, e);
    return err(EkweError.NETWORK_LOST);
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
    delivery?: SynthDelivery;
    /** Cache-busting counter for a re-roll of identical text. */
    reroll?: number;
  },
): Promise<Result<SynthesizedAudio, EkweError>> {
  const trimmed = text.trim();
  if (!trimmed) return err(EkweError.SPEECH_FAIL);
  if (trimmed.length > getActivePlanLimits().maxTextChars) {
    return err(EkweError.TEXT_TOO_LONG);
  }
  if (isDefinitelyOffline()) {
    return err(EkweError.NETWORK_LOST);
  }

  const result = await requestSynthClip({
    path: "/synthesize",
    logTag: "[speech]",
    signal: options?.signal,
    body: {
      text: trimmed,
      targetLang: lang,
      ...(options?.sourceLang ? { sourceLang: options.sourceLang } : {}),
      gender: options?.gender ?? resolveGenderSetting(),
      voiceId: options?.voiceId ?? settings$.voiceId.peek() ?? undefined,
      ...(options?.reroll === undefined ? {} : { reroll: options.reroll }),
    },
  });
  if (!result.ok) return result;
  const { data, rawUri } = result.value;

  // Playback-only clips keep the provider's format; shareable clips must be Ogg/Opus.
  let normalized: Pick<
    SynthesizedAudio,
    "uri" | "waveform" | "durationMs" | "playbackUri"
  >;
  if (options?.delivery === "playback") {
    normalized = { uri: rawUri, durationMs: data.durationMs ?? 0 };
  } else {
    const result2 = await normalizeSynthAudio(rawUri);
    if (!result2.ok) return err(result2.error);
    normalized = result2.value;
  }

  return ok({
    ...normalized,
    sourceLang: data.sourceLang,
    targetLang: data.targetLang,
    translated: data.translated,
    // Return the transcript and translation from the worker at no extra inference cost.
    transcript: data.transcript ?? null,
    translation: data.translation ?? null,
    translationTruncated: data.translationTruncated ?? false,
  });
}

/** Fetches a voice-picker audition from the dedicated, unmetered endpoint. */
export async function synthesizeVoicePreview(
  voiceId: string,
  gender: VoiceGender,
  lang: string,
  options?: { signal?: AbortSignal },
): Promise<Result<SynthesizedAudio, EkweError>> {
  if (isDefinitelyOffline()) {
    return err(EkweError.NETWORK_LOST);
  }

  const result = await requestSynthClip({
    path: "/voice-preview",
    logTag: "[voice-preview]",
    signal: options?.signal,
    body: { voiceId, gender, lang },
  });
  if (!result.ok) return result;
  const { data, rawUri } = result.value;

  return ok({
    uri: rawUri,
    durationMs: data.durationMs ?? 0,
    sourceLang: data.sourceLang,
    targetLang: data.targetLang,
    translated: data.translated,
    transcript: data.transcript ?? null,
    translation: data.translation ?? null,
    translationTruncated: data.translationTruncated ?? false,
  });
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
  let convertedPath: string | null = null;
  let playbackPath: string | null = null;

  try {
    const file = new File(audio.uri);
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
      logger.error("[speech] workerUrl is EMPTY!");
      return err(EkweError.NETWORK_LOST);
    }

    const token = await getAccessToken();

    const requestStart = Date.now();

    const parameters: Record<string, string> = {
      lang: sourceLang || "auto",
      targetLang,
      duration: audio.durationMs ? String(Math.round(audio.durationMs)) : "0",
    };
    const voiceId = options?.voiceId ?? settings$.voiceId.peek();
    if (voiceId) parameters.voiceId = voiceId;
    const gender = options?.gender ?? resolveGenderSetting();
    if (gender) parameters.gender = gender;

    const artifact = await AudioTranscoder.prepareUploadArtifact(
      audio.uri,
      audio.durationMs,
      sourceLang,
    );
    if (artifact.isTemporary) convertedPath = artifact.uri;
    playbackPath =
      artifact.playbackUri && artifact.playbackUri !== artifact.uri
        ? artifact.playbackUri
        : null;

    const uploadFile = new File(artifact.uri);
    if (
      uploadFile.size &&
      uploadFile.size > getActivePlanLimits().maxAudioBytes
    ) {
      return err(EkweError.FILE_TOO_LARGE);
    }

    const upload = await uploadMultipart(
      uploadFile,
      `${workerUrl}/synthesize`,
      {
        parameters,
        mimeType: getMimeType(artifact.extension),
        token: token ?? null,
        signal: options?.signal,
        onProgress: options?.onProgress,
        timeoutMs: SPEECH_AUDIO_TIMEOUT_MS,
      },
    );

    if (__DEV__) {
      const serverTiming = parseServerTiming(
        headerValue(upload.headers, "server-timing"),
      );
      const stages = Object.entries(serverTiming)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      if (stages) logger.info(`[Perf] synth server: ${stages}`);
    }

    const responseAt = Date.now();

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
    const audioBytes = await fetchSynthAudio(data.audioUrl);
    if (!audioBytes) return err(EkweError.SPEECH_FAIL);

    const rawUri = await writeAudioFile(audioBytes, data.mime);
    if (!rawUri) return err(EkweError.SPEECH_FAIL);

    const normalized = await normalizeSynthAudio(rawUri);
    if (!normalized.ok) return err(normalized.error);

    if (__DEV__) {
      const writeMs = Date.now() - responseAt;
      logger.info(
        `[Perf] synth client: write+normalize ${writeMs}ms, total ${Date.now() - requestStart}ms`,
      );
    }

    return ok({
      uri: normalized.value.uri,
      durationMs: normalized.value.durationMs || data.durationMs || 0,
      waveform: normalized.value.waveform,
      sourceLang: data.sourceLang,
      targetLang: data.targetLang,
      translated: data.translated,
      transcript: data.transcript ?? null,
      translation: data.translation ?? null,
      translationTruncated: data.translationTruncated ?? false,
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
  } finally {
    for (const path of [convertedPath, playbackPath]) {
      if (!path) continue;
      try {
        const file = new File(path);
        if (file.exists) file.delete();
      } catch {
        // Best-effort: the startup cache sweep is the backstop.
      }
    }
  }
}

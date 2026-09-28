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
import logger from "@/utils/logger";
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
 * What the caller intends to do with the clip.
 *
 * `shareable` is the default and means the artifact must be Ogg/Opus, because
 * that is the only thing WhatsApp and Telegram accept as a voice note — see
 * `shareOutService.ts`, which derives the outgoing MIME from the file
 * extension and never transcodes.
 *
 * `playback` is for a clip that is only ever played back. It skips the
 * re-encode and hands back the provider's own bytes, which every platform
 * plays natively, so a short clip costs a download and nothing else. It is for
 * voice previews: never shared, and the same clip is cached after the first
 * request, so the transcode would be paid once per voice to produce a file
 * nothing looks at again.
 */
export type SynthDelivery = "shareable" | "playback";

export interface SynthesizedAudio {
  uri: string;
  waveform?: number[];
  durationMs: number;
  sourceLang?: string;
  targetLang?: string;
  translated?: boolean;
  /**
   * The text that was spoken — the user's input, or the transcript of their
   * audio. Null only when talking to a worker that predates the field.
   */
  transcript?: string | null;
  /** The translation that was rendered, when one was produced. */
  translation?: string | null;
  /**
   * True when the source was over the translate budget, so the worker
   * translated only its opening span. `transcript` then holds that same span,
   * not everything the user said.
   */
  translationTruncated?: boolean;
}

/**
 * Fetches synthesised audio from the URL the worker returned.
 *
 * The response is a few hundred bytes regardless of clip length; the audio
 * itself is a separate, cacheable GET, so nothing here has to decode base64
 * or hold a few megabytes in memory to hand them to the player.
 */
async function fetchSynthAudio(audioUrl: string): Promise<Uint8Array | null> {
  // The worker returns a path so it never has to trust a forwarded host. Join it
  // onto the same base every other request uses.
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

/**
 * File extension for a response's MIME type.
 *
 * The share path derives the outgoing MIME from this extension, and WhatsApp
 * only renders a PTT voice note for `audio/ogg; codecs=opus` — so this must
 * track the container, not just the two formats the worker used to return.
 * Writing Opus bytes under a `.mp3` name would make the share arrive as an
 * ordinary attachment, and would also bypass the transcoder's Ogg fast path.
 */
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
    delivery?: SynthDelivery;
    /** Cache-busting counter for a re-roll of identical text. */
    reroll?: number;
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
          ...(options?.reroll === undefined ? {} : { reroll: options.reroll }),
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

    const audioBytes = await fetchSynthAudio(parsed.data.audioUrl);
    if (!audioBytes) return err(EkweError.SPEECH_FAIL);

    const rawUri = await writeAudioFile(audioBytes, parsed.data.mime);
    if (!rawUri) return err(EkweError.SPEECH_FAIL);

    // A playback-only clip keeps the provider's container. The bytes are
    // already on disk and playable, so re-encoding them would buy nothing and
    // would leave a shorter clip in the cache than the user will ever hear.
    const normalized =
      options?.delivery === "playback"
        ? { uri: rawUri, durationMs: parsed.data.durationMs ?? 0 }
        : await normalizeSynthAudio(rawUri);

    return ok({
      ...normalized,
      sourceLang: parsed.data.sourceLang,
      targetLang: parsed.data.targetLang,
      translated: parsed.data.translated,
      // The worker understood this text on our behalf to render it. Returning
      // it costs no extra inference and is the only way Studio can archive
      // what the user said or typed.
      transcript: parsed.data.transcript ?? null,
      translation: parsed.data.translation ?? null,
      translationTruncated: parsed.data.translationTruncated ?? false,
    });
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

    const upload = await uploadMultipart(file, `${workerUrl}/synthesize`, {
      parameters,
      mimeType: getMimeType(extension),
      token: token ?? null,
      signal: options?.signal,
      onProgress: options?.onProgress,
      timeoutMs: SPEECH_AUDIO_TIMEOUT_MS,
    });

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

    if (__DEV__) {
      const writeMs = Date.now() - responseAt;
      logger.info(
        `[Perf] synth client: write+normalize ${writeMs}ms, total ${Date.now() - requestStart}ms`,
      );
    }

    return ok({
      uri: normalized.uri,
      durationMs: normalized.durationMs ?? data.durationMs ?? 0,
      waveform: normalized.waveform,
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
  }
}

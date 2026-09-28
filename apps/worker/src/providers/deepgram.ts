import {
  Env,
  CLIENT_ABORTED,
  TranscribeResult,
  SpeechAttempt,
} from "@/core/types";
import { rotateKeys, rotateKeysDetailed } from "@/utils/keys";
import { isHallucination } from "@/utils/hallucination";
import { fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { rotateWsKeys, createStreamInterceptor } from "@/utils/stream";
import { logger } from "@/core/logger";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";
import type { StreamRoute } from "@ekwe/shared/languageCapabilities";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  logger.info("[deepgram] Requesting transcription", {
    lang,
    size: blob.size,
    type: blob.type,
  });
  const params = new URLSearchParams({ model: "nova-3" });
  if (lang && lang !== "auto") {
    params.set("language", lang);
  } else {
    // In auto mode Deepgram does not look at the language at all unless this is
    // set, so the request was effectively "transcribe with no language hint" and
    // detected_language never came back. Asking explicitly costs nothing when
    // the caller already knows the language, and is the only way the auto path
    // can report what was detected.
    params.set("detect_language", "true");
  }

  const res = await rotateKeys(
    env,
    "DEEPGRAM_KEY_",
    (key) =>
      fetchWithTimeout(
        `${DEEPGRAM_URL}?${params}`,
        {
          method: "POST",
          headers: {
            Authorization: `Token ${key}`,
            "Content-Type": blob.type || "audio/wav",
          },
          body: blob,
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    if (res?.status === 402 || res?.status === 403) {
      logger.error("[CREDIT_EXHAUSTED] Deepgram key requires manual rotation!");
    } else {
      logger.warn("[deepgram] Transcribe failed, provider returned error", {
        status: res?.status ?? "no response",
      });
    }
    return null;
  }

  const data = await res.json<DeepgramResponse>();
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  const duration = data.metadata?.duration;
  const durationMs = duration ? duration * 1000 : undefined;
  // Folded through the shared resolver like every other provider: an
  // unresolved detection is an absent field, not a guessed default — "en" here
  // would silently mislabel every unknown-language clip.
  const detectedLang = canonicalLanguageFromName(
    data.results?.channels?.[0]?.detected_language,
  );

  if (transcript && !isHallucination(transcript, durationMs)) {
    return {
      text: transcript,
      provider: "deepgram",
      ...(duration ? { duration } : {}),
      ...(detectedLang ? { language: detectedLang } : {}),
    };
  }

  return null;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{ transcript?: string; confidence?: number }>;
      detected_language?: string;
    }>;
  };
  metadata?: { duration?: number };
}

const DEEPGRAM_SPEAK_URL = "https://api.deepgram.com/v1/speak";

const MAX_SPEECH_BYTES = 8 * 1024 * 1024;

function resolveModelName(voice: string | undefined, lang: string): string {
  const langCode = lang.split("-")[0].toLowerCase() || "en";
  return `aura-2-${voice ?? "vesta"}-${langCode}`;
}

type VoiceGender = "male" | "female";

/**
 * Aura-2 voices per language, ordered so index 0 is the Clear persona and
 * index 1 the Warm persona. Characteristics are Deepgram's own
 * (developers.deepgram.com/docs/tts-models). Accent is baked into the voice
 * identity — `aura-2-draco-en` is British, `aura-2-hyperion-en` Australian — so
 * no non-`en-us` voice appears in a pool unless that is deliberate.
 *
 * Coverage is uneven: French publishes one voice per gender, so the Warm
 * persona legitimately has no Deepgram candidate there. Lists are short on
 * purpose — the pool walks at most one voice per provider, and a long list
 * only spends the synthesis budget on requests that already failed.
 */
const DEEPGRAM_FEMALE: Record<string, string[]> = {
  default: ["vesta", "hera"],
  en: ["vesta", "hera", "luna", "callista"],
  es: ["diana", "estrella", "selena"],
  de: ["elara", "kara", "viktoria"],
  fr: ["agathe"],
  nl: ["daphne", "rhea", "beatrix"],
  it: ["livia", "maia", "cinzia"],
  ja: ["izanami", "ama", "uzume"],
};

const DEEPGRAM_MALE: Record<string, string[]> = {
  default: ["orpheus", "aries"],
  en: ["orpheus", "aries", "orion", "arcas"],
  es: ["nestor", "javier", "sirio"],
  de: ["fabian", "julius"],
  fr: ["hector"],
  nl: ["sander", "roman", "lars"],
  it: ["dionisio", "flavio", "elio"],
  ja: ["fujin", "ebisu"],
};

export function voices(
  gender: VoiceGender | undefined,
  langCode: string,
): string[] {
  if (!gender) {
    return [...(DEEPGRAM_FEMALE[langCode] ?? DEEPGRAM_FEMALE.default)];
  }
  const set = gender === "male" ? DEEPGRAM_MALE : DEEPGRAM_FEMALE;
  return [...(set[langCode] ?? set.default)];
}

/**
 * Asks Aura for Ogg Opus rather than its default MP3.
 *
 * Two reasons, both measured against this app's client. It is the only
 * upstream here that can emit Opus at all, and mono Opus is the one container
 * the device reuses byte-for-byte instead of re-encoding, so a clip that
 * arrives in this format costs the phone no transcoding on the share paths. At
 * the default bitrate it is also roughly a quarter the size of the MP3 it
 * replaces.
 *
 * `bit_rate` is deliberately left alone: the device's reuse check compares
 * channel count, not bitrate, so there is nothing to match, and the measured
 * default was already smaller than the phone's own 24 kbps encode target.
 */
const DEEPGRAM_SPEAK_ENCODING: Readonly<Record<string, string>> = {
  encoding: "opus",
  container: "ogg",
};

const SPEAK_QUERY = new URLSearchParams({
  ...DEEPGRAM_SPEAK_ENCODING,
}).toString();

export async function tts(
  text: string,
  lang: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
): Promise<SpeechAttempt> {
  if (signal.aborted || !text || !text.trim()) {
    return { result: null, status: null };
  }

  const model = resolveModelName(voice, lang);
  logger.info("[deepgram] Requesting speech", { model, chars: text.length });

  let response: Response | null;
  let lastStatus: number | null;
  try {
    const rotation = await rotateKeysDetailed(
      env,
      "DEEPGRAM_KEY_",
      (key) =>
        fetchWithTimeout(
          `${DEEPGRAM_SPEAK_URL}?model=${encodeURIComponent(model)}&${SPEAK_QUERY}`,
          {
            method: "POST",
            headers: {
              Authorization: `Token ${key}`,
              "Content-Type": "application/json",
              Accept: "audio/ogg;codecs=opus",
            },
            body: JSON.stringify({ text }),
          },
          TIMEOUT_FAST,
          signal,
        ),
      signal,
    );
    response = rotation.response;
    lastStatus = rotation.lastStatus;
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[deepgram] Speech exception", {
      error: e instanceof Error ? e.message : String(e),
    });
    return { result: null, status: null };
  }

  if (!response) {
    logger.warn("[deepgram] Speak failed", { status: lastStatus });
    return { result: null, status: lastStatus };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SPEECH_BYTES) {
    logger.warn("[deepgram] Speech output over hard cap", {
      bytes: bytes.byteLength,
    });
    return { result: null, status: 502 };
  }

  return {
    result: {
      audio: bytes,
      mime: "audio/ogg;codecs=opus",
      provider: "deepgram",
    },
    status: null,
  };
}

/** Serves both Deepgram streaming routes; they share keys and rotation. */
export async function sttStream(
  env: Env,
  route: StreamRoute,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  if (route.id === "deepgram-flux-multi") {
    return fluxStream(env, route, lang, clientWs, signal);
  }
  if (route.id === "deepgram-nova-3") {
    return nova3Stream(env, route, lang, clientWs, signal);
  }
  return false;
}

function emit(
  clientWs: WebSocket,
  isFinal: boolean,
  text: string,
  language?: string,
): void {
  if (!text || isHallucination(text)) return;
  clientWs.send(
    JSON.stringify({
      type: isFinal ? "final" : "interim",
      text,
      provider: "deepgram",
      ...(language ? { language } : {}),
    }),
  );
}

/**
 * `/v2/listen` with `flux-general-multi`. The language is a hint, not a selector:
 * Flux rejects `language=`, so a wrong hint costs accuracy, not the session.
 */
async function fluxStream(
  env: Env,
  route: StreamRoute,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    model: route.model,
    // Long enough not to split a mid-thought pause, short enough to end.
    eot_threshold: "0.7",
    eot_timeout_ms: "5000",
  });
  if (lang && lang !== "auto") params.append("language_hint", lang);

  const dgWs = await rotateWsKeys(env, "DEEPGRAM_KEY_", (key) => {
    const withKey = new URLSearchParams(params);
    withKey.set("access_token", key);
    return `wss://api.deepgram.com/v2/listen?${withKey}`;
  });
  if (!dgWs) return false;

  createStreamInterceptor(
    clientWs,
    dgWs,
    (data) => {
      try {
        const payload = JSON.parse(data) as {
          type?: string;
          event?: string;
          transcript?: string;
          languages?: string[];
        };
        if (payload.type !== "TurnInfo" || !payload.transcript) return;
        // Primary language first, so entry 0 is the one to pin.
        emit(
          clientWs,
          payload.event === "EndOfTurn",
          payload.transcript,
          payload.languages?.[0],
        );
      } catch {
        /* ignore parse errors */
      }
    },
    { signal },
  );

  return true;
}

/** `/v1/listen` with `nova-3`: no turn model, so endpointing is a threshold. */
async function nova3Stream(
  env: Env,
  route: StreamRoute,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const params = new URLSearchParams({
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    model: route.model,
    interim_results: "true",
    smart_format: "true",
    endpointing: "500",
  });
  if (lang && lang !== "auto") params.set("language", lang);
  else params.set("detect_language", "true");

  const dgWs = await rotateWsKeys(env, "DEEPGRAM_KEY_", (key) => {
    const withKey = new URLSearchParams(params);
    withKey.set("access_token", key);
    return `wss://api.deepgram.com/v1/listen?${withKey}`;
  });
  if (!dgWs) return false;

  createStreamInterceptor(
    clientWs,
    dgWs,
    (data) => {
      try {
        const payload = JSON.parse(data) as {
          type?: string;
          channel?: { alternatives?: Array<{ transcript?: string }> };
          is_final?: boolean;
          detected_language?: string;
        };
        const alternatives = payload.channel?.alternatives;
        if (
          payload.type !== "Results" ||
          !alternatives ||
          alternatives.length === 0
        ) {
          return;
        }
        emit(
          clientWs,
          payload.is_final === true,
          alternatives[0].transcript ?? "",
          payload.detected_language,
        );
      } catch {
        /* ignore parse errors */
      }
    },
    { signal },
  );

  return true;
}

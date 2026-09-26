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
  if (lang && lang !== "auto") params.set("language", lang);

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
  const detectedLang = data.results?.channels?.[0]?.detected_language;
  const duration = data.metadata?.duration;
  const durationMs = duration ? duration * 1000 : undefined;

  if (transcript && !isHallucination(transcript, durationMs)) {
    return {
      text: transcript,
      provider: "deepgram",
      duration,
      language: detectedLang,
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

const DEEPGRAM_LANGUAGES = new Set([
  "bg",
  "ca",
  "zh",
  "cs",
  "da",
  "nl",
  "en",
  "et",
  "fi",
  "fr",
  "de",
  "el",
  "hi",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lv",
  "lt",
  "ms",
  "no",
  "pl",
  "pt",
  "ro",
  "ru",
  "sk",
  "es",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
]);
export { DEEPGRAM_LANGUAGES as supportedLanguages };

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
          `${DEEPGRAM_SPEAK_URL}?model=${encodeURIComponent(model)}`,
          {
            method: "POST",
            headers: {
              Authorization: `Token ${key}`,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
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
      mime: "audio/mpeg",
      provider: "deepgram",
    },
    status: null,
  };
}

export async function sttStream(
  env: Env,
  lang: string,
  clientWs: WebSocket,
  signal: AbortSignal,
): Promise<boolean> {
  const dgWs = await rotateWsKeys(env, "DEEPGRAM_KEY_", (key) => {
    const params = new URLSearchParams({
      access_token: key,
      encoding: "opus",
      sample_rate: "16000",
      channels: "1",
      model: "nova-3",
      interim_results: "true",
      smart_format: "true",
    });
    if (lang && lang !== "auto") params.set("language", lang);
    return `wss://api.deepgram.com/v1/listen?${params}`;
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
        };
        const alternatives = payload.channel?.alternatives;
        if (
          payload.type === "Results" &&
          alternatives &&
          alternatives.length > 0
        ) {
          const text = alternatives[0].transcript;
          const isFinal = payload.is_final === true;

          if (text && !isHallucination(text)) {
            clientWs.send(
              JSON.stringify({
                type: isFinal ? "final" : "interim",
                text,
                provider: "deepgram",
              }),
            );
          }
        }
      } catch {
        /* ignore parse errors */
      }
    },
    signal,
  );

  return true;
}

import { Env, SpeechAttempt, TranscribeResult } from "@/core/types";
import { rotateKeysDetailed } from "@/utils/keys";
import { isHallucination } from "@/utils/hallucination";
import { mimeToExt } from "@/utils/mime";
import { fetchWithTimeout, TIMEOUT_FAST } from "@/utils/fetch";
import { logger } from "@/core/logger";
import { toProviderCode } from "@ekwe/shared/languageCapabilities";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

const ELEVENLABS_STT = "https://api.elevenlabs.io/v1/speech-to-text";
const ELEVENLABS_TTS = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_MODEL = "scribe_v2";
const ELEVENLABS_TTS_MODEL = "eleven_flash_v2_5";
/**
 * Flash v2.5's own per-request character ceiling. Splitting longer text is the
 * caller's job rather than ours: stitching segments back into one file with
 * correct prosody needs the previous_text/next_text parameters, which we do not
 * send, so a silent truncation here would be worse than a refusal.
 */
const ELEVENLABS_TTS_MAX_CHARS = 40_000;
const MAX_SPEECH_BYTES = 8 * 1024 * 1024;

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  logger.info("[elevenlabs] Requesting transcription", {
    lang,
    size: blob.size,
  });

  const { response: res } = await rotateKeysDetailed(
    env,
    "ELEVENLABS_KEY_",
    (key) => {
      const body = new FormData();
      body.append("file", blob, `audio.${mimeToExt(blob.type)}`);
      body.append("model_id", ELEVENLABS_MODEL);

      const isAuto = !lang || lang === "auto";
      if (!isAuto) {
        body.append("language_code", toProviderCode("elevenlabs", "stt", lang));
      }

      return fetchWithTimeout(
        ELEVENLABS_STT,
        {
          method: "POST",
          headers: { "xi-api-key": key },
          body,
        },
        TIMEOUT_FAST,
        signal,
      );
    },
    signal,
  );

  if (!res?.ok) {
    logger.warn("[elevenlabs] Transcribe failed, provider returned error", {
      status: res?.status ?? "no response",
    });
    return null;
  }

  const data = await res.json<{
    text?: string;
    language_code?: string;
  }>();
  const detected = canonicalLanguageFromName(data.language_code);

  if (data.text && !isHallucination(data.text)) {
    logger.info("[elevenlabs] Transcription success", {
      length: data.text.length,
      lang: detected,
    });
    return {
      text: data.text,
      provider: "elevenlabs",
      ...(detected ? { language: detected } : {}),
    };
  }

  logger.warn("[elevenlabs] Transcription empty or hallucinated", {
    text: data.text,
  });
  return null;
}

/**
 * Curated voices, keyed by gender then language.
 *
 * ElevenLabs publishes a large live catalogue at `GET /v1/voices`, but
 * `voices()` is synchronous by contract and this pool is consulted while
 * building a failover list, so the ids are pinned here instead of awaited.
 * Each entry is a stock voice id that ships with every account; a voice the
 * account cannot access returns 404 and the pool moves on.
 *
 * Only the languages in `FLASH_TTS_LANGUAGES` appear. The shared registry
 * already excludes everything else, so a Yoruba request is routed to another
 * provider before it reaches this table rather than being handed a voice that
 * cannot speak Yoruba.
 */
const ELEVENLABS_VOICES: Readonly<
  Record<string, Record<string, readonly string[]>>
> = {
  female: {
    default: ["EXAVITQu4vr4xnSDxMaL", "AZnzlk1XvdvUeBnXmlld"],
    en: ["EXAVITQu4vr4xnSDxMaL", "AZnzlk1XvdvUeBnXmlld"],
    es: ["EXAVITQu4vr4xnSDxMaL", "AZnzlk1XvdvUeBnXmlld"],
    fr: ["ThT5KcBeYPX3keUQqHPh", "FrAf7bUg1iNPo0Np9SJi"],
    de: ["ThT5KcBeYPX3keUQqHPh", "FrAf7bUg1iNPo0Np9SJi"],
    it: ["ThT5KcBeYPX3keUQqHPh", "FrAf7bUg1iNPo0Np9SJi"],
    pt: ["ThT5KcBeYPX3keUQqHPh", "FrAf7bUg1iNPo0Np9SJi"],
  },
  male: {
    default: ["TxGEqnHWrfWFTfGW9XjX", "ErXwobaYiN019PkySvjV"],
    en: ["TxGEqnHWrfWFTfGW9XjX", "ErXwobaYiN019PkySvjV"],
    es: ["TxGEqnHWrfWFTfGW9XjX", "ErXwobaYiN019PkySvjV"],
    fr: ["pNInz6obpgDQGcFmaJgB", "onwK4e9ZLuTAKqWW03F9"],
    de: ["pNInz6obpgDQGcFmaJgB", "onwK4e9ZLuTAKqWW03F9"],
    it: ["pNInz6obpgDQGcFmaJgB", "onwK4e9ZLuTAKqWW03F9"],
    pt: ["pNInz6obpgDQGcFmaJgB", "onwK4e9ZLuTAKqWW03F9"],
  },
};

export function voices(
  gender: "male" | "female" | undefined,
  langCode: string,
): string[] {
  const byGender = ELEVENLABS_VOICES[gender ?? "female"];
  const lang = langCode.split("-")[0].toLowerCase();
  // Position 0 is the provider's clearest read of the language and position 1
  // the alternate, which is what the voice slots index on.
  return [...(byGender[lang] ?? byGender.default)];
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

  if (text.length > ELEVENLABS_TTS_MAX_CHARS) {
    // Refusing is honest; asking the provider to truncate would return a clip
    // that stops mid-sentence while reporting success.
    logger.warn("[elevenlabs] Text over the per-request character limit", {
      chars: text.length,
      limit: ELEVENLABS_TTS_MAX_CHARS,
    });
    return { result: null, status: 413 };
  }

  const voiceId = voice ?? voices(undefined, lang)[0];
  logger.info("[elevenlabs] Requesting speech", {
    voice: voiceId,
    chars: text.length,
  });

  const { response: res, lastStatus } = await rotateKeysDetailed(
    env,
    "ELEVENLABS_KEY_",
    (key) =>
      fetchWithTimeout(
        `${ELEVENLABS_TTS}/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": key,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: ELEVENLABS_TTS_MODEL,
          }),
        },
        TIMEOUT_FAST,
        signal,
      ),
    signal,
  );

  if (!res?.ok) {
    logger.warn("[elevenlabs] Speak failed", {
      status: res?.status ?? lastStatus ?? "no response",
    });
    return { result: null, status: res?.status ?? lastStatus };
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SPEECH_BYTES) {
    logger.warn("[elevenlabs] Speech output over hard cap", {
      bytes: bytes.byteLength,
    });
    return { result: null, status: 502 };
  }

  return {
    result: {
      audio: bytes,
      mime: "audio/mpeg",
      provider: "elevenlabs",
    },
    status: null,
  };
}

import { blobToBase64 } from "@/utils/base64";
import {
  CLIENT_ABORTED,
  Env,
  TranscribeResult,
  TranslateResult,
} from "@/core/types";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import { isHallucination } from "@/utils/hallucination";
import { logger } from "@/core/logger";
import { toProviderCode } from "@ekwe/shared/languageCapabilities";
import { canonicalLanguageFromName } from "@ekwe/shared/languageNames";

// The turbo build is the current large-v3 Whisper on Workers AI. The older
// `@cf/openai/whisper` binding model is no longer served reliably and fails
// outright on the audio we send, so it must not be used here.
const WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  try {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);

    // The Workers AI binding serializes Blob/ArrayBuffer into a JSON
    // object, but the Whisper endpoint expects /audio to be a base64
    // string. Encode explicitly so the shape matches what the API
    // actually accepts (verified against the live binding).
    const audio = await blobToBase64(blob);

    const isAuto = !lang || lang === "auto";
    const input = isAuto
      ? { audio }
      : { audio, language: toProviderCode("cloudflare", "stt", lang) };

    const result = await env.AI.run(
      WHISPER_MODEL,
      input as unknown as Ai_Cf_Openai_Whisper_Large_V3_Turbo_Input,
    );
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
    const text = typeof result?.text === "string" ? result.text : "";

    if (text && !isHallucination(text)) {
      // turbo reports what it detected under transcription_info rather than a
      // top-level field. Only trust it for auto detection; when the caller named
      // a language we already know it, and a provider-side disagreement would
      // just be noise. Folded through the shared resolver like every other
      // provider's reported language, so the field is a canonical code or
      // nothing — never a name or a guess.
      const detected = canonicalLanguageFromName(
        isAuto ? result?.transcription_info?.language : undefined,
      );

      return {
        text,
        provider: "cloudflare",
        ...(detected ? { language: detected } : {}),
      };
    }
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[cloudflare] Transcription error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
  transliteration: boolean = false,
): Promise<TranslateResult | null> {
  try {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
    const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
      messages: [
        {
          role: "system",
          content: buildTranslatePrompt(
            targetLang,
            sourceLang,
            transliteration,
          ),
        },
        { role: "user", content: text },
      ],
    });
    if (signal.aborted) throw new Error(CLIENT_ABORTED);

    const response = result?.choices?.[0]?.message?.content ?? "";
    if (response) {
      const { translation, transliteration: romanized } = parseTranslateOutput(
        response,
        transliteration,
      );
      return {
        translation,
        ...(romanized ? { transliteration: romanized } : {}),
        provider: "cloudflare",
      };
    }
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[cloudflare] Translation error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

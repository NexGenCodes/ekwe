import {
  CLIENT_ABORTED,
  Env,
  TranscribeResult,
  TranslateResult,
} from "@/core/types";
import { buildTranslatePrompt, parseTranslateOutput } from "@/utils/prompts";
import { isHallucination } from "@/utils/hallucination";
import { logger } from "@/core/logger";
import { toWhisperCode } from "@/core/languages";
import { bytesToBase64 } from "@/utils/base64";

export async function stt(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  try {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
    const audio = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const input =
      lang && lang !== "auto"
        ? { audio, language: toWhisperCode(lang) }
        : { audio };
    const result = await env.AI.run(
      "@cf/openai/whisper",
      input as unknown as Ai_Cf_Openai_Whisper_Input,
    );
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
    const text = typeof result?.text === "string" ? result.text : "";

    if (text && !isHallucination(text)) {
      return { text, provider: "cloudflare" };
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

export { ALL_LANGUAGES as supportedLanguages } from "@/core/languages";

import {
  CLIENT_ABORTED,
  Env,
  TranscribeResult,
  TranslateResult,
  TtsAttempt,
} from "../core/types";
import {
  isHallucination,
  buildTranslatePrompt,
  parseTranslateOutput,
} from "../utils/prompts";
import { logger } from "../core/logger";
import { toWhisperCode } from "../services/languages";
import { bytesToBase64 } from "../utils/base64";
import { runAiTtsRaw } from "../utils/ai";

/**
 * Cloudflare Workers AI — zero-key safety net.
 * Uses AI binding directly, no API keys needed.
 */

// ─── Transcription (@cf/openai/whisper) ───────────────────────────

export async function transcribe(
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
      // The workers-types schema types `audio` as number[]; the API also
      // accepts a base64 string, which we send here.
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

// ─── Translation (@cf/zai-org/glm-4.7-flash) ─────────────────────

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

    // GLM returns OpenAI-style chat completions; read the first choice's
    // assistant text content.
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

export { ALL_LANGUAGES as supportedLanguages } from "../services/languages";

// ─── Text-to-Speech (@cf/myshell-ai/melotts) ──────────────────────
// MeloTTS is a Cloudflare-hosted voice; the model's `lang` field is a base
// language code (en/fr/es/zh/ja/ko) matching the worker's own codes.

export async function melotts(
  text: string,
  lang: string,
  env: Env,
): Promise<TtsAttempt> {
  return runAiTtsRaw(
    env,
    "@cf/myshell-ai/melotts",
    { prompt: text, lang },
    "melotts",
  );
}

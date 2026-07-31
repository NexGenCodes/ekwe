import { CLIENT_ABORTED, Env, TranscribeResult, TranslateResult } from "../types";
import { isHallucination, buildTranslatePrompt } from "../utils/prompts";
import { logger } from "../logger";

/**
 * Cloudflare Workers AI — zero-key safety net.
 * Uses AI binding directly, no API keys needed.
 */

// ─── Transcription (@cf/openai/whisper) ───────────────────────────

const B64_CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

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
      lang && lang !== "auto" ? { audio, language: lang } : { audio };
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

// ─── Translation (@cf/meta/llama-3-8b-instruct) ──────────────────

export async function translate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  env: Env,
  signal: AbortSignal,
): Promise<TranslateResult | null> {
  try {
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
    const result = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
      messages: [
        {
          role: "system",
          content: buildTranslatePrompt(targetLang, sourceLang),
        },
        { role: "user", content: text },
      ],
    });
    if (signal.aborted) throw new Error(CLIENT_ABORTED);

    const response =
      typeof result?.response === "string" ? result.response : "";
    if (response) {
      return { translation: response, provider: "cloudflare" };
    }
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error("[cloudflare] Translation error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

export { ALL_LANGUAGES as supportedLanguages } from "../languages";

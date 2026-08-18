import { CLIENT_ABORTED, Env, TtsAttempt } from "../core/types";
import { logger } from "../core/logger";

/** Hard ceiling on decoded provider output. */
export const MAX_TTS_BYTES = 8 * 1024 * 1024;

/**
 * Runs a Workers AI TTS model with `returnRawResponse` and returns the raw
 * bytes as a TtsAttempt.
 *
 * Shared by the aura-1/2 (deepgram.ts) and melotts (cloudflare.ts) voices —
 * both are served through the same zero-key `env.AI` binding. The model name
 * is a runtime string, so the response is typed via cast (the raw-response
 * overload only resolves for literal model keys). Rethrows CLIENT_ABORTED so
 * callers can tell "client disconnected" from "provider failed".
 */
export async function runAiTtsRaw(
  env: Env,
  model: string,
  input: Record<string, unknown>,
  provider: string,
): Promise<TtsAttempt> {
  try {
    const raw = (await env.AI.run(model, input, {
      returnRawResponse: true,
    })) as unknown as Response;
    if (!raw.ok) {
      logger.warn(`[tts:${provider}] HTTP error`, { status: raw.status });
      return { result: null, status: raw.status };
    }

    const bytes = new Uint8Array(await raw.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_TTS_BYTES) {
      logger.warn(`[tts:${provider}] Output over hard cap`, {
        bytes: bytes.byteLength,
      });
      return { result: null, status: 502 };
    }

    return {
      result: {
        audio: bytes,
        mime: raw.headers.get("Content-Type") ?? "audio/mpeg",
        provider,
      },
      status: null,
    };
  } catch (e) {
    if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
    logger.error(`[tts:${provider}] Exception`, {
      error: e instanceof Error ? e.message : String(e),
    });
    return { result: null, status: null };
  }
}

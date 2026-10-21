import {
  WORKER_ERROR_CODES,
  VOICE_PREVIEW_TEXT,
  getStandardSlot,
  getVoiceSlot,
  type VoicePreviewRequest,
} from "@ekwe/shared";
import { SPEECH_PIPELINE_TOTAL_MS } from "@/core/budgets";
import { RequestTimings } from "@/core/timing";
import { CLIENT_ABORTED, Env } from "@/core/types";
import { pipelineTierForSlot, resolveVoicePool } from "@/core/voices";
import { buildSpeechResponse } from "@/routes/synthesize";
import {
  buildSpeechCacheKey,
  readSpeechCache,
  runSpeechSynth,
} from "@/services/speech";

function speechUnavailable(): Response {
  return Response.json(
    {
      error: WORKER_ERROR_CODES.SPEECH_UNAVAILABLE,
      message:
        "Speech generation is temporarily unavailable. Please try again shortly.",
    },
    { status: 503 },
  );
}

/**
 * Renders a voice-picker audition.
 *
 * Unlike `/synthesize` this is never metered or entitlement-gated: the text is
 * fixed, the cache scope is shared, and the pool is pinned to the slot's own
 * tier so a free user hears the Studio voice they are being offered.
 */
export async function synthesizeVoicePreview(
  body: VoicePreviewRequest,
  env: Env,
  signal: AbortSignal,
  userId: string,
  remainingMs: () => number,
  timings: RequestTimings,
): Promise<Response> {
  const { voiceId, gender, lang } = body;
  const slot = getVoiceSlot(voiceId) ?? getStandardSlot();
  const tier = pipelineTierForSlot(slot);

  const budgetMs = Math.min(SPEECH_PIPELINE_TOTAL_MS, remainingMs());
  if (budgetMs <= 0) return speechUnavailable();
  if (signal.aborted) throw new Error(CLIENT_ABORTED);

  if (resolveVoicePool(slot, gender, lang, tier).length === 0) {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.LANGUAGE_UNSUPPORTED,
        message: `No provider handles ${lang} for speech.`,
      },
      { status: 400 },
    );
  }

  const cacheKey = await buildSpeechCacheKey(
    VOICE_PREVIEW_TEXT,
    lang,
    gender,
    voiceId,
    userId,
    tier,
    "shared",
  );

  const meta = {
    sourceLang: lang,
    targetLang: lang,
    translated: false,
    voiceId,
    transcript: VOICE_PREVIEW_TEXT,
    translation: null,
    translationTruncated: false,
  };

  const cached = await timings.measure("cache", () =>
    readSpeechCache(env, cacheKey),
  );
  if (cached) {
    timings.start("encode");
    const res = await buildSpeechResponse(env, cached, meta, cacheKey);
    timings.end("encode");
    return res;
  }

  const result = await timings.measure("tts", () =>
    runSpeechSynth({
      text: VOICE_PREVIEW_TEXT,
      lang,
      gender,
      slot,
      tier,
      env,
      signal,
      budgetMs,
      cacheKey,
    }),
  );
  if (!result) return speechUnavailable();

  timings.start("encode");
  const res = await buildSpeechResponse(env, result, meta, cacheKey);
  timings.end("encode");
  return res;
}

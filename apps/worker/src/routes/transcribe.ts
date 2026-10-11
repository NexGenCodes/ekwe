import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import {
  guardAutoDetect,
  guardLanguageCode,
  guardSupportedLanguage,
} from "@/core/guards";
import { getTranscribeProviderNames } from "@/core/providers";
import { ingestAudioUpload } from "@/services/audio";
import { transcribeBudgetMs } from "@/core/budgets";
import {
  readTranscribeCache,
  runTranscribe,
  buildTranscribeCacheKey,
  stripTranscriptLanguage,
  writeTranscribeCache,
} from "@/services/transcribe";
import { releaseUsage } from "@/services/usage";
import { Env, Tier } from "@/core/types";

export async function handleTranscribe(
  request: Request,
  env: Env,
  tier: Tier,
  pipelineTier: Tier,
  signal: AbortSignal,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  logger.info(`[transcribe] handleTranscribe started`, { tier, pipelineTier });

  // One refund path. Calling `releaseUsage` at each short-circuit site instead
  // meant a client that disconnected mid-transcription threw past all of them:
  // the provider calls were paid for, the result discarded, the charge kept.
  let charged = true;
  const settle = (): void => {
    if (!charged) return;
    charged = false;
    releaseUsage(env, userId, "transcribe", ctx);
  };

  try {
    const ingest = await ingestAudioUpload(request, tier);
    if (!ingest.ok) {
      settle();
      return ingest.response;
    }
    const { audio, audioHash, durationMs, form, codec } = ingest.value;

    const lang = form.get("lang") as string | null;
    logger.info(
      `[transcribe] lang=${lang} duration=${durationMs} mime=${ingest.value.mimeType} codec=${codec} size=${audio.size}`,
    );

    const autoGuard = guardAutoDetect(lang, tier);
    if (!autoGuard.allowed) {
      settle();
      return autoGuard.response;
    }

    const langGuard = guardLanguageCode(lang, "lang");
    if (!langGuard.allowed) {
      settle();
      return langGuard.response;
    }

    // A catalog language no provider transcribes must fail as a request error,
    // before audio is decoded and before healthy providers are marked down.
    const supportGuard = guardSupportedLanguage(
      lang,
      "stt",
      getTranscribeProviderNames(pipelineTier),
    );
    if (!supportGuard.allowed) {
      settle();
      return supportGuard.response;
    }

    let cacheKey: string | null = null;
    try {
      cacheKey = buildTranscribeCacheKey({
        userId,
        tier,
        audioHash,
        lang,
      });

      const cached = await readTranscribeCache(env, cacheKey);
      if (cached) {
        settle();
        return Response.json(cached);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[transcribe] D1 cache lookup error (continuing): ${msg}`);
    }

    const isAuto = !lang || lang === "auto";
    const effectiveLang = isAuto ? "auto" : lang;

    // Scales with the clip. A flat budget cannot serve a long upload — Deepgram
    // 504s past ten minutes of processing, so every provider would be skipped
    // on budget and the result would read as an outage rather than a clip
    // nobody can transcribe in that time.
    const budgetMs = transcribeBudgetMs(durationMs ?? 0);

    const result = await runTranscribe({
      audioBlob: audio,
      effectiveLang,
      isAuto,
      codec,
      tier: pipelineTier,
      env,
      signal,
      budgetMs,
      durationMs: durationMs ?? 0,
    });

    if (result) {
      const prepared = stripTranscriptLanguage(result, tier);
      if (cacheKey && ctx) {
        ctx.waitUntil(
          writeTranscribeCache(env, cacheKey, userId, tier, prepared),
        );
      } else if (cacheKey) {
        await writeTranscribeCache(env, cacheKey, userId, tier, prepared);
      }
      return Response.json(prepared);
    }

    logger.error(`[transcribe] ALL providers failed`);
    settle();

    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
      { status: 503 },
    );
  } catch (err) {
    // Covers CLIENT_ABORTED and any unexpected throw. The quota charge is
    // returned either way: the user got no transcription.
    settle();
    throw err;
  }
}

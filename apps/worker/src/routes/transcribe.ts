import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import {
  guardAutoDetect,
  guardLanguageCode,
  guardSupportedLanguage,
} from "@/core/guards";
import { getTranscribeProviderNames } from "@/core/providers";
import { ingestAudioUpload, resolveBilledDurationMs } from "@/services/audio";
import { transcribeBudgetMs } from "@/core/budgets";
import { getLimits } from "@/core/limits";
import {
  readTranscribeCache,
  runTranscribe,
  buildTranscribeCacheKey,
  stripTranscriptLanguage,
  writeTranscribeCache,
} from "@/services/transcribe";
import { runPreflightGate } from "@/services/preflight";
import { trackBillableSuccess } from "@/services/usage";
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

  const charge = (billedDurationMs: number): void => {
    trackBillableSuccess(env, userId, "transcribe", ctx, 0, billedDurationMs);
  };

  const ingest = await ingestAudioUpload(request, tier);
  if (!ingest.ok) {
    return ingest.response;
  }
  const { audio, audioHash, durationMs, form, codec } = ingest.value;

  // The middleware gate runs before multipart parsing, so it cannot see the
  // clip length. Re-run the quota/budget check with the real duration before
  // any provider is called; the cooldown is deliberately skipped because the
  // middleware already consumed it for this request. A declared duration above
  // the plan's clip limit is clamped here: the upload guard may have allowed a
  // suspicious declaration (the file cannot physically hold it), and we must
  // never bill or gate more than the plan can deliver.
  const maxClipMs = getLimits(tier).dictationDurationMs;
  const gateDurationMs = Math.min(durationMs ?? 0, maxClipMs);
  const preciseGate = await runPreflightGate(
    env,
    ctx,
    userId,
    tier,
    "transcribe",
    true,
    0,
    gateDurationMs,
  );
  if (!preciseGate.ok) return preciseGate.response;
  const effectivePipelineTier = preciseGate.tier;

  const origin = (form.get("origin") as string | null)?.toLowerCase() ?? null;
  if (origin === "orb" && preciseGate.tier !== "PREMIUM") {
    return Response.json(
      { error: WORKER_ERROR_CODES.PREMIUM_FEATURE_REQUIRED },
      { status: 403 },
    );
  }

  const lang = form.get("lang") as string | null;
  logger.info(
    `[transcribe] lang=${lang} duration=${durationMs} mime=${ingest.value.mimeType} codec=${codec} size=${audio.size}`,
  );

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) {
    return autoGuard.response;
  }

  const langGuard = guardLanguageCode(lang, "lang");
  if (!langGuard.allowed) {
    return langGuard.response;
  }

  // A catalog language no provider transcribes must fail as a request error,
  // before audio is decoded and before healthy providers are marked down.
  const supportGuard = guardSupportedLanguage(
    lang,
    "stt",
    getTranscribeProviderNames(effectivePipelineTier),
  );
  if (!supportGuard.allowed) {
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
    tier: effectivePipelineTier,
    env,
    signal,
    budgetMs,
    durationMs: durationMs ?? 0,
  });

  if (result) {
    const billedDurationMs = Math.min(
      resolveBilledDurationMs(durationMs, result.duration),
      maxClipMs,
    );
    if (
      billedDurationMs > 0 &&
      durationMs !== undefined &&
      billedDurationMs > durationMs * 1.5 &&
      billedDurationMs - durationMs > 30_000
    ) {
      logger.warn(
        "[transcribe] provider duration exceeded client declaration",
        {
          clientDurationMs: durationMs,
          providerDurationMs: billedDurationMs,
        },
      );
    }
    charge(billedDurationMs);
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

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}

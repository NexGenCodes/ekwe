import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { guardAutoDetect, guardLanguageCode } from "@/core/guards";
import { ingestAudioUpload } from "@/services/audio";
import { TRANSCRIBE_TOTAL_MS } from "@/core/budgets";
import {
  readTranscribeCache,
  runTranscribe,
  buildTranscribeCacheKey,
  stripTranscriptLanguage,
  writeTranscribeCache,
} from "@/services/transcribe";
import { trackBillableSuccess } from "@/services/usage";
import { Env, Tier } from "@/core/types";

export async function handleTranscribe(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  logger.info(`[transcribe] handleTranscribe started`, { tier });

  const ingest = await ingestAudioUpload(request, tier);
  if (!ingest.ok) return ingest.response;
  const { audio, audioHash, durationMs, form } = ingest.value;

  const lang = form.get("lang") as string | null;
  logger.info(
    `[transcribe] lang=${lang} duration=${durationMs} mime=${ingest.value.mimeType} size=${audio.size}`,
  );

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, "lang");
  if (!langGuard.allowed) return langGuard.response;

  let cacheKey: string | null = null;
  try {
    cacheKey = buildTranscribeCacheKey({
      userId,
      tier,
      audioHash,
      lang,
    });

    const cached = await readTranscribeCache(env, cacheKey);
    if (cached) return Response.json(cached);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] D1 cache lookup error (continuing): ${msg}`);
  }

  const isAuto = !lang || lang === "auto";
  const effectiveLang = isAuto ? "auto" : lang;

  const result = await runTranscribe({
    audioBlob: audio,
    effectiveLang,
    isAuto,
    tier,
    env,
    signal,
    budgetMs: TRANSCRIBE_TOTAL_MS,
  });

  if (result) {
    const prepared = stripTranscriptLanguage(result, tier);
    if (cacheKey) {
      await writeTranscribeCache(env, cacheKey, userId, tier, prepared);
    }

    trackBillableSuccess(env, userId, "transcribe", ctx);

    return Response.json(prepared);
  }

  logger.error(`[transcribe] ALL providers failed`);

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}

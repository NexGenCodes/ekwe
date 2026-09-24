import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { logger } from "@/core/logger";
import { getLimits } from "@/core/limits";
import {
  guardAudioDuration,
  guardAudioSize,
  guardAutoDetect,
  guardContentType,
  guardLanguageCode,
  guardMultipartSize,
  MULTIPART_OVERHEAD,
  readLimitedBody,
} from "@/core/guards";
import { hashBytes } from "@/utils/keys";
import { sniffAudioMime } from "@/utils/mime";
import { TRANSCRIBE_TOTAL_MS } from "@/core/budgets";
import {
  readTranscribeCache,
  runTranscribe,
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

  const ctGuard = guardContentType(request, "multipart");
  if (!ctGuard.allowed) return ctGuard.response;

  const sizePreGuard = guardMultipartSize(request, tier);
  if (!sizePreGuard.allowed) return sizePreGuard.response;

  let formData: FormData;
  try {
    const maxBodyBytes = getLimits(tier).maxAudioBytes + MULTIPART_OVERHEAD;
    const bodyBytes = await readLimitedBody(request, maxBodyBytes);
    if (bodyBytes === null) {
      return Response.json(
        {
          error: WORKER_ERROR_CODES.FILE_TOO_LARGE,
          message: "Audio file too large. Try a shorter recording.",
        },
        { status: 413 },
      );
    }
    formData = await new Response(bodyBytes, {
      headers: {
        "Content-Type":
          request.headers.get("Content-Type") || "multipart/form-data",
      },
    }).formData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] formData() FAILED: ${msg}`);
    return Response.json(
      {
        error: WORKER_ERROR_CODES.EKWE_TRANSCRIPTION_FAIL,
        message: "Failed to parse request body.",
      },
      { status: 500 },
    );
  }

  const file = formData.get("file") as File | null;
  const lang = formData.get("lang") as string | null;
  const durationRaw = formData.get("duration") as string | null;
  const durationMs = durationRaw ? Number(durationRaw) : undefined;
  logger.info(
    `[transcribe] file=${!!file} lang=${lang} duration=${durationMs} fileType=${file?.type} fileName=${file?.name} fileSize=${file?.size}`,
  );

  if (!file)
    return Response.json(
      { error: WORKER_ERROR_CODES.MISSING_FILE },
      { status: 400 },
    );

  if (file.size === 0)
    return Response.json(
      {
        error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT,
        message: "Audio file is empty.",
      },
      { status: 400 },
    );

  const sizeGuard = guardAudioSize(file.size, tier);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const durationGuard = guardAudioDuration(durationMs, tier);
  if (!durationGuard.allowed) return durationGuard.response;

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, "lang");
  if (!langGuard.allowed) return langGuard.response;

  let audioBuffer: ArrayBuffer;
  let mimeType: string;
  try {
    audioBuffer = await file.arrayBuffer();

    mimeType = sniffAudioMime(new Uint8Array(audioBuffer), file.type);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] file.arrayBuffer() FAILED: ${msg}`);
    return Response.json(
      {
        error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
        message: "Failed to read audio file.",
      },
      { status: 503 },
    );
  }

  let cacheKey: string | null = null;
  try {
    const audioHash = await hashBytes(audioBuffer);
    cacheKey = `transcribe:${userId}:${tier}:${audioHash}:${lang || "auto"}`;

    const cached = await readTranscribeCache(env, cacheKey);
    if (cached) return Response.json(cached);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] D1 cache lookup error (continuing): ${msg}`);
  }

  let audioBlob: Blob;
  try {
    audioBlob = new Blob([audioBuffer], { type: mimeType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] Blob creation FAILED: ${msg}`);
    return Response.json(
      {
        error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
        message: "Failed to process audio file.",
      },
      { status: 500 },
    );
  }
  const isAuto = !lang || lang === "auto";
  const effectiveLang = isAuto ? "auto" : lang;

  const result = await runTranscribe({
    audioBlob,
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

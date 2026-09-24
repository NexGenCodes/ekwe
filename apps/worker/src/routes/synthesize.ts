import {
  WORKER_ERROR_CODES,
  TRANSLATE_EXPANSION_CUSHION,
  synthesizeRequestSchema,
  synthesizeResponseSchema,
  translateResponseSchema,
  VOICE_IDS,
  getVoiceById,
  getLanguageName,
} from "@ekwe/shared";
import { logger } from "@/core/logger";
import { getProviderModule, getProviderNamesFor } from "@/providers";
import {
  SPEECH_PIPELINE_TOTAL_MS,
  SYNTHESIZE_TOTAL_MS,
  TRANSCRIBE_TOTAL_MS,
  TRANSLATE_CACHE_TTL_SECONDS,
  TRANSLATE_PER_PROVIDER_MS,
  TRANSLATE_TOTAL_MS,
} from "@/core/budgets";
import { getLimits } from "@/core/limits";
import {
  guardAudioDuration,
  guardAudioSize,
  guardAutoDetect,
  guardContentType,
  guardJsonSize,
  guardLanguageCode,
  guardMultipartSize,
  MULTIPART_OVERHEAD,
  MAX_JSON_BODY_BYTES,
  readLimitedBody,
  safeParseJSON,
} from "@/core/guards";
import { sanitizeTranslationText } from "@/core/sanitize";
import { hashBytes, hashKey } from "@/utils/keys";
import { sniffAudioMime } from "@/utils/mime";
import { bytesToBase64 } from "@/utils/base64";
import { d1Get, d1Put } from "@/services/d1-cache";
import { detectTextLanguage } from "@/services/auto-detect";
import { runProviderFailover } from "@/utils/retry";
import { isProviderDegraded, reportProviderOutcome } from "@/services/health";
import { runPreflightGate } from "@/services/preflight";
import { trackBillableSuccess } from "@/services/usage";
import {
  readTranscribeCache,
  runTranscribe,
  stripTranscriptLanguage,
  writeTranscribeCache,
} from "@/services/transcribe";
import {
  buildSpeechCacheKey,
  readSpeechCache,
  resolveEffectiveLang,
  runSpeechSynth,
  type SpeechResult,
} from "@/services/speech";
import {
  CLIENT_ABORTED,
  Env,
  Tier,
  TranslateFn,
  TranslateResult,
} from "@/core/types";

function preShrinkForTranslate(text: string, tier: Tier): string {
  const maxChars = getLimits(tier).maxTextChars;
  const limit = Math.floor(maxChars / TRANSLATE_EXPANSION_CUSHION);
  if (text.length <= limit) return text;
  logger.warn(
    `[synthesize] Pre-shrinking transcript from ${text.length} to ${limit} chars before translate`,
  );
  return text.slice(0, limit);
}

interface SpeechGateOk {
  ok: true;
  tier: Tier;
}

interface SpeechGateFail {
  ok: false;
  response: Response;
  tier: Tier;
}

type SpeechGate = SpeechGateOk | SpeechGateFail;

async function reserveSpeechGate(
  env: Env,
  ctx: ExecutionContext,
  userId: string,
  jwtTier: Tier,
  sessionId: string | null,
  chargeChars: number,
): Promise<SpeechGate> {
  const gate = await runPreflightGate(
    env,
    ctx,
    userId,
    jwtTier,
    "speech",
    sessionId,
    chargeChars,
  );
  if (!gate.ok) {
    return {
      ok: false,
      response: gate.response,
      tier: jwtTier,
    };
  }
  return {
    ok: true,
    tier: gate.preflight.throttled ? "FREE" : gate.preflight.tier_active,
  };
}

function guardVoiceEntitlement(
  voiceId: string | undefined,
  tier: Tier,
  isPreview: boolean,
): Response | null {
  if (isPreview || !voiceId || tier !== "FREE") return null;
  const voice = getVoiceById(voiceId);
  if (voice?.tier === "pro") {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.PREMIUM_FEATURE_REQUIRED,
        message: "Studio voices require Ekwe Pro.",
      },
      { status: 403 },
    );
  }
  return null;
}

interface TranslateStageOptions {
  text: string;
  sourceLang: string | undefined;
  targetLang: string;
  tier: Tier;
  userId: string;
  env: Env;
  signal: AbortSignal;
  budgetMs: number;
  ctx: ExecutionContext;
  sessionId: string | null;
}

type TranslateStageOutcome =
  { ok: true; result: TranslateResult } | { ok: false; response: Response };

async function translateStage(
  options: TranslateStageOptions,
): Promise<TranslateStageOutcome> {
  const {
    text,
    sourceLang,
    targetLang,
    tier,
    userId,
    env,
    signal,
    budgetMs,
    ctx,
    sessionId,
  } = options;

  const gate = await runPreflightGate(
    env,
    ctx,
    userId,
    tier,
    "translate",
    sessionId,
  );
  if (!gate.ok) return { ok: false, response: gate.response };
  if (signal.aborted) throw new Error(CLIENT_ABORTED);

  let cacheKey: string | null = null;
  try {
    const textHash = await hashKey(
      `${text}_${sourceLang || "auto"}_${targetLang}`,
    );
    cacheKey = `trans:${userId}:${tier}:${textHash}`;
    const cached = await d1Get(env.EKWE_D1, "cache_translation", cacheKey);
    if (cached) {
      const cachedResult = JSON.parse(cached) as TranslateResult;
      const shapeCheck = translateResponseSchema.safeParse(cachedResult);
      if (shapeCheck.success) {
        logger.info(`[synthesize] translate cache hit (${textHash})`);
        return { ok: true, result: cachedResult };
      }
      logger.warn(
        `[synthesize] translate cache entry failed validation (ignoring)`,
      );
    }
  } catch (err) {
    logger.error(`[synthesize] translate cache lookup error (continuing)`, {
      error: String(err),
    });
  }

  const pipeline = getProviderNamesFor("translate", tier);
  const limits = getLimits(tier);

  const isAuto = !sourceLang || sourceLang === "auto";
  let detectedLang: string | null = null;
  if (isAuto) {
    try {
      detectedLang = await detectTextLanguage(text, env.EKWE_D1, signal);
    } catch {
      /* noop */
    }
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
  }

  const byName = new Map(
    pipeline.map((name) => [
      name,
      getProviderModule(name)?.translate ?? (() => Promise.resolve(null)),
    ]),
  );
  const entry = (name: string): { name: string; fn: TranslateFn } => {
    const fn = byName.get(name);
    if (!fn) throw new Error(`[translate] Unknown provider: ${name}`);
    return { name, fn };
  };

  const result = await runProviderFailover<TranslateResult>({
    providers: pipeline,
    signal,
    totalMs: budgetMs,
    route: "translate",
    env,
    tier,
    attemptTimeoutMs: () => TRANSLATE_PER_PROVIDER_MS,
    shouldSkip: async (name) => {
      if (await isProviderDegraded(env, name)) {
        logger.info(`[translate] Skipping ${name} (circuit open)`);
        return true;
      }
      return false;
    },
    invoke: (name, attemptSignal) => {
      const targetName = getLanguageName(targetLang);
      const sourceName = isAuto
        ? detectedLang
          ? getLanguageName(detectedLang)
          : undefined
        : getLanguageName(sourceLang);
      return entry(name).fn(
        text,
        targetName,
        sourceName,
        env,
        attemptSignal,
        false,
      );
    },
    handleAttempt: async (name, attempt) => {
      if (!attempt) {
        await reportProviderOutcome(env, name, false);
        return false;
      }

      const shapeCheck = translateResponseSchema.safeParse(attempt);
      if (!shapeCheck.success) {
        logger.warn(`[translate] ${name} returned a malformed result`, {
          issues: shapeCheck.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return false;
      }

      logger.info(`[translate] Success: ${name}`, {
        provider: attempt.provider,
      });

      const r = attempt as unknown as Record<string, unknown>;
      if (!limits.transliterationAllowed && "transliteration" in r) {
        delete r.transliteration;
      }
      if (limits.autoDetectAllowed && detectedLang) {
        attempt.language = detectedLang;
      } else if (!limits.autoDetectAllowed && "language" in r) {
        delete r.language;
      }

      try {
        if (env.EKWE_D1 && cacheKey) {
          await d1Put(
            env.EKWE_D1,
            "cache_translation",
            cacheKey,
            userId,
            tier,
            JSON.stringify(attempt),
            TRANSLATE_CACHE_TTL_SECONDS,
          );
        }
      } catch (err) {
        logger.error(`[synthesize] translate cache write error`, {
          error: String(err),
        });
      }

      trackBillableSuccess(env, userId, "translate", ctx);

      await reportProviderOutcome(env, name, true);

      return true;
    },
    onAttemptError: (name) => reportProviderOutcome(env, name, false),
  });

  if (!result) {
    return {
      ok: false,
      response: Response.json(
        { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
        { status: 503 },
      ),
    };
  }
  return { ok: true, result };
}

interface ResponseMeta {
  sourceLang: string;
  targetLang: string;
  translated: boolean;
  voiceId: string | undefined;
}

function wavDurationMs(audio: Uint8Array): number | undefined {
  if (audio.byteLength < 44) return undefined;
  const dv = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const byteRate = dv.getUint32(28, true);
  if (!byteRate || byteRate <= 0) return undefined;
  return Math.round((audio.byteLength / byteRate) * 1000);
}

function buildSpeechResponse(
  result: SpeechResult,
  meta: ResponseMeta,
): Response {
  const response = synthesizeResponseSchema.parse({
    audioBase64: bytesToBase64(result.audio),
    mime: result.mime,
    sourceLang: meta.sourceLang,
    targetLang: meta.targetLang,
    translated: meta.translated,
    voiceId: meta.voiceId || "standard",
    durationMs: result.mime.includes("wav")
      ? wavDurationMs(result.audio)
      : undefined,
  });
  return Response.json(response);
}

interface FinishSpeechOptions {
  spokenText: string;
  spokenLang: string;
  gender: "male" | "female";
  voiceId: string | undefined;
  tier: Tier;
  jwtTier: Tier;
  env: Env;
  signal: AbortSignal;
  ctx: ExecutionContext;
  userId: string;
  sessionId: string | null;
  isPreview: boolean;
  remainingMs: () => number;
  meta: ResponseMeta;
}

async function finishSpeech(options: FinishSpeechOptions): Promise<Response> {
  const {
    spokenText,
    spokenLang,
    gender,
    voiceId,
    tier,
    jwtTier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    isPreview,
    remainingMs,
    meta,
  } = options;

  let cleanSpoken = sanitizeTranslationText(spokenText);
  if (!cleanSpoken) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }
  const maxCharsPerRequest = getLimits(jwtTier).maxTextChars;
  if (cleanSpoken.length > maxCharsPerRequest) {
    logger.warn(
      `[synthesize] Truncating speech text from ${cleanSpoken.length} to ${maxCharsPerRequest}`,
    );
    cleanSpoken = cleanSpoken.substring(0, maxCharsPerRequest);
  }

  const speechBudget = Math.min(SPEECH_PIPELINE_TOTAL_MS, remainingMs());
  if (speechBudget <= 0) {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SPEECH_UNAVAILABLE,
        message:
          "Speech generation is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }
  if (signal.aborted) throw new Error(CLIENT_ABORTED);

  let effectiveTier = tier;
  let gateError: Response | null = null;
  if (!isPreview) {
    const reserved = await reserveSpeechGate(
      env,
      ctx,
      userId,
      jwtTier,
      sessionId,
      cleanSpoken.length,
    );
    if (reserved.ok) {
      effectiveTier = reserved.tier;
    } else {
      gateError = reserved.response;
      effectiveTier = reserved.tier;
    }
  }

  const entitlementGate = guardVoiceEntitlement(
    voiceId,
    effectiveTier,
    isPreview,
  );
  if (entitlementGate) return entitlementGate;

  const cacheKey = await buildSpeechCacheKey(
    cleanSpoken,
    spokenLang,
    gender,
    voiceId,
    userId,
    effectiveTier,
  );
  const cached = await readSpeechCache(env, cacheKey);
  if (cached) {
    logger.info(`[synthesize] Speech cache hit, serving free replay`);
    return buildSpeechResponse(cached, meta);
  }

  if (gateError) return gateError;

  const result = await runSpeechSynth({
    text: cleanSpoken,
    lang: spokenLang,
    gender,
    voiceId,
    tier: effectiveTier,
    env,
    signal,
    budgetMs: speechBudget,
    cacheKey,
  });
  if (!result) {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SPEECH_UNAVAILABLE,
        message:
          "Speech generation is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }

  if (!isPreview) {
    trackBillableSuccess(env, userId, "speech", ctx, cleanSpoken.length);
  }

  return buildSpeechResponse(result, meta);
}

async function synthesizeFromText(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  sessionId: string | null,
  ctx: ExecutionContext,
  remainingMs: () => number,
): Promise<Response> {
  const ctGuard = guardContentType(request);
  if (!ctGuard.allowed) return ctGuard.response;

  const sizeGuard = guardJsonSize(request, MAX_JSON_BODY_BYTES);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const parsedJson = await safeParseJSON<unknown>(request);
  if (!parsedJson.ok) return parsedJson.response;

  const parsed = synthesizeRequestSchema.safeParse(parsedJson.data);
  if (!parsed.success) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }
  const { text, sourceLang, targetLang, gender, voiceId } = parsed.data;

  if (!text) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  const cleanText = sanitizeTranslationText(text);
  if (!cleanText) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }

  const resolvedGender = gender ?? "female";

  const { isPreview, effectiveLang } = resolveEffectiveLang(
    cleanText,
    targetLang,
  );

  if (isPreview) {
    return finishSpeech({
      spokenText: cleanText,
      spokenLang: effectiveLang,
      gender: resolvedGender,
      voiceId,
      tier,
      jwtTier: tier,
      env,
      signal,
      ctx,
      userId,
      sessionId,
      isPreview: true,
      remainingMs,
      meta: {
        sourceLang: sourceLang ?? targetLang,
        targetLang,
        translated: false,
        voiceId,
      },
    });
  }

  let spokenText = cleanText;
  let translated = false;
  let effectiveSource = sourceLang ?? targetLang;

  const needsTranslate =
    sourceLang !== undefined &&
    sourceLang !== "auto" &&
    sourceLang !== targetLang;

  if (needsTranslate) {
    const translation = await translateStage({
      text: preShrinkForTranslate(cleanText, tier),
      sourceLang,
      targetLang,
      tier,
      userId,
      env,
      signal,
      budgetMs: Math.min(TRANSLATE_TOTAL_MS, remainingMs()),
      ctx,
      sessionId,
    });
    if (!translation.ok) return translation.response;
    spokenText = translation.result.translation;
    translated = true;
    effectiveSource = sourceLang;
  } else if (sourceLang === "auto") {
    const autoGuard = guardAutoDetect(sourceLang, tier);
    if (!autoGuard.allowed) return autoGuard.response;

    let detected: string | null = null;
    try {
      detected = await detectTextLanguage(cleanText, env.EKWE_D1, signal);
    } catch (err) {
      logger.error(`[synthesize] auto-detect failed: ${String(err)}`);
    }
    if (detected && detected !== targetLang) {
      const translation = await translateStage({
        text: preShrinkForTranslate(cleanText, tier),
        sourceLang: detected,
        targetLang,
        tier,
        userId,
        env,
        signal,
        budgetMs: Math.min(TRANSLATE_TOTAL_MS, remainingMs()),
        ctx,
        sessionId,
      });
      if (!translation.ok) return translation.response;
      spokenText = translation.result.translation;
      translated = true;
      effectiveSource = detected;
    } else {
      translated = false;
      effectiveSource = detected ?? targetLang;
    }
  }

  return finishSpeech({
    spokenText,
    spokenLang: targetLang,
    gender: resolvedGender,
    voiceId,
    tier,
    jwtTier: tier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    isPreview: false,
    remainingMs,
    meta: {
      sourceLang: effectiveSource,
      targetLang,
      translated,
      voiceId,
    },
  });
}

async function synthesizeFromAudio(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  sessionId: string | null,
  ctx: ExecutionContext,
  remainingMs: () => number,
): Promise<Response> {
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
    logger.error(`[synthesize] formData() FAILED: ${msg}`);
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
  const targetLang = formData.get("targetLang") as string | null;
  const durationRaw = formData.get("duration") as string | null;
  const durationMs = durationRaw ? Number(durationRaw) : undefined;
  const genderRaw = formData.get("gender") as string | null;
  const voiceIdRaw = formData.get("voiceId") as string | null;
  logger.info(
    `[synthesize] file=${!!file} lang=${lang} targetLang=${targetLang} duration=${durationMs} fileType=${file?.type} fileName=${file?.name} fileSize=${file?.size}`,
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

  if (!targetLang || targetLang === "auto") {
    return Response.json(
      {
        error: WORKER_ERROR_CODES.INVALID_TARGET_LANGUAGE,
        message: "A concrete target language is required.",
      },
      { status: 400 },
    );
  }
  const tgtGuard = guardLanguageCode(targetLang, "targetLang");
  if (!tgtGuard.allowed) return tgtGuard.response;

  let resolvedGender: "male" | "female" = "female";
  if (genderRaw !== null && genderRaw !== "male" && genderRaw !== "female") {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }
  if (genderRaw !== null) resolvedGender = genderRaw;

  let voiceId: string | undefined;
  if (voiceIdRaw !== null) {
    if (!VOICE_IDS.includes(voiceIdRaw)) {
      return Response.json(
        { error: WORKER_ERROR_CODES.INVALID_BODY },
        { status: 400 },
      );
    }
    voiceId = voiceIdRaw;
  }

  const transcribeGate = await runPreflightGate(
    env,
    ctx,
    userId,
    tier,
    "transcribe",
    sessionId,
  );
  if (!transcribeGate.ok) return transcribeGate.response;
  if (signal.aborted) throw new Error(CLIENT_ABORTED);

  let audioBuffer: ArrayBuffer;
  let mimeType: string;
  try {
    audioBuffer = await file.arrayBuffer();
    mimeType = sniffAudioMime(new Uint8Array(audioBuffer), file.type);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[synthesize] file.arrayBuffer() FAILED: ${msg}`);
    return Response.json(
      {
        error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
        message: "Failed to read audio file.",
      },
      { status: 503 },
    );
  }

  let cacheKey: string | null = null;
  let transcript: string | null = null;
  let detectedLang: string | null = null;
  try {
    const audioHash = await hashBytes(audioBuffer);
    cacheKey = `transcribe:${userId}:${tier}:${audioHash}:${lang || "auto"}`;

    const cached = await readTranscribeCache(env, cacheKey);
    if (cached) {
      transcript = cached.text;
      detectedLang = cached.language ?? null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[synthesize] D1 cache lookup error (continuing): ${msg}`);
  }

  if (transcript === null) {
    let audioBlob: Blob;
    try {
      audioBlob = new Blob([audioBuffer], { type: mimeType });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[synthesize] Blob creation FAILED: ${msg}`);
      return Response.json(
        {
          error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL,
          message: "Failed to process audio file.",
        },
        { status: 500 },
      );
    }

    const isAuto = !lang || lang === "auto";
    const result = await runTranscribe({
      audioBlob,
      effectiveLang: isAuto ? "auto" : lang,
      isAuto,
      tier: tier,
      env,
      signal,
      budgetMs: Math.min(TRANSCRIBE_TOTAL_MS, remainingMs()),
    });
    if (!result) {
      return Response.json(
        { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
        { status: 503 },
      );
    }
    transcript = result.text;
    detectedLang = result.language ?? null;

    trackBillableSuccess(env, userId, "transcribe", ctx);

    if (cacheKey) {
      const prepared = stripTranscriptLanguage(result, tier);
      await writeTranscribeCache(env, cacheKey, userId, tier, prepared);
    }
  }

  let spokenText = sanitizeTranslationText(transcript);
  if (!spokenText) {
    return Response.json(
      { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
      { status: 400 },
    );
  }

  let translated = false;
  let effectiveSource = lang ?? targetLang;

  if (lang !== targetLang) {
    const isAuto = !lang || lang === "auto";
    let sourceCode: string | null = isAuto ? detectedLang : lang;
    if (isAuto && detectedLang && detectedLang === targetLang) {
      sourceCode = null;
    }

    if (sourceCode) {
      if (signal.aborted) throw new Error(CLIENT_ABORTED);
      const translation = await translateStage({
        text: preShrinkForTranslate(spokenText, tier),
        sourceLang: sourceCode,
        targetLang,
        tier: tier,
        userId,
        env,
        signal,
        budgetMs: Math.min(TRANSLATE_TOTAL_MS, remainingMs()),
        ctx,
        sessionId,
      });
      if (!translation.ok) return translation.response;
      spokenText = translation.result.translation;
      translated = true;
      effectiveSource = sourceCode;
    } else {
      effectiveSource = detectedLang ?? targetLang;
    }
  }

  return finishSpeech({
    spokenText,
    spokenLang: targetLang,
    gender: resolvedGender,
    voiceId,
    tier: tier,
    jwtTier: tier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    isPreview: false,
    remainingMs,
    meta: {
      sourceLang: effectiveSource,
      targetLang,
      translated,
      voiceId,
    },
  });
}

export interface SynthesizeAuthContext {
  userId: string;
  sessionId: string | null;
}

export async function handleSynthesize(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  auth: SynthesizeAuthContext,
  ctx: ExecutionContext,
): Promise<Response> {
  const start = Date.now();
  const remainingMs = () => SYNTHESIZE_TOTAL_MS - (Date.now() - start);

  const ct = request.headers.get("Content-Type") || "";
  if (ct.includes("multipart/form-data")) {
    return synthesizeFromAudio(
      request,
      env,
      tier,
      signal,
      auth.userId,
      auth.sessionId,
      ctx,
      remainingMs,
    );
  }
  return synthesizeFromText(
    request,
    env,
    tier,
    signal,
    auth.userId,
    auth.sessionId,
    ctx,
    remainingMs,
  );
}

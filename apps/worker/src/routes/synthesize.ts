import {
  WORKER_ERROR_CODES,
  TRANSLATE_EXPANSION_CUSHION,
  synthesizeRequestSchema,
  synthesizeResponseSchema,
  VOICE_SLOT_IDS,
  getStandardSlot,
  getVoiceSlot,
} from "@ekwe/shared";
import { logger } from "@/core/logger";
import { RequestTimings } from "@/core/timing";
import { pipelineTierForSlot, resolveExecutionTier } from "@/core/voices";
import {
  SPEECH_PIPELINE_TOTAL_MS,
  TRANSCRIBE_TOTAL_MS,
  TRANSLATE_TOTAL_MS,
} from "@/core/budgets";
import { getLimits } from "@/core/limits";
import {
  guardAutoDetect,
  guardLanguageCode,
  guardSupportedLanguage,
} from "@/core/guards";
import type { z } from "zod";
import { sanitizeTranslationText } from "@/core/sanitize";
import { hashKey } from "@/utils/keys";
import { signSpeechUrl } from "@/utils/speech-url";
import { ingestAudioUpload } from "@/services/audio";
import { detectTextLanguage } from "@/services/auto-detect";
import { runPreflightGate } from "@/services/preflight";
import {
  buildTranslateCacheKey,
  readTranslateCache,
  runTranslate,
  writeTranslateCache,
} from "@/services/translate";
import { releaseUsage } from "@/services/usage";
import {
  buildTranscribeCacheKey,
  readTranscribeCache,
  runTranscribe,
  stripTranscriptLanguage,
  writeTranscribeCache,
} from "@/services/transcribe";
import {
  buildSpeechCacheKey,
  readSpeechCache,
  runSpeechSynth,
  type SpeechResult,
} from "@/services/speech";
import { getProviderNamesFor } from "@/providers";
import { CLIENT_ABORTED, Env, Tier, TranslateResult } from "@/core/types";

function preShrinkForTranslate(
  text: string,
  tier: Tier,
): { text: string; truncated: boolean } {
  const maxChars = getLimits(tier).maxTextChars;
  const limit = Math.floor(maxChars / TRANSLATE_EXPANSION_CUSHION);
  if (text.length <= limit) return { text, truncated: false };
  logger.warn(
    `[synthesize] Pre-shrinking transcript from ${text.length} to ${limit} chars before translate`,
  );
  return { text: text.slice(0, limit), truncated: true };
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
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void },
): Promise<SpeechGate> {
  const skipCooldown = gateCharge.skipCooldown();
  gateCharge.markCharged();
  const gate = await runPreflightGate(
    env,
    ctx,
    userId,
    jwtTier,
    "speech",
    sessionId,
    chargeChars,
    skipCooldown,
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
  entitlementTier: Tier,
): Response | null {
  if (!voiceId || entitlementTier !== "FREE") return null;
  const slot = getVoiceSlot(voiceId);
  if (slot?.tier === "pro") {
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
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void };
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
    gateCharge,
  } = options;

  const skipCooldown = gateCharge.skipCooldown();
  gateCharge.markCharged();
  const gate = await runPreflightGate(
    env,
    ctx,
    userId,
    tier,
    "translate",
    sessionId,
    0,
    skipCooldown,
  );
  if (!gate.ok) return { ok: false, response: gate.response };
  if (signal.aborted) throw new Error(CLIENT_ABORTED);
  const pipelineTier = gate.preflight.throttled ? "FREE" : tier;

  let cacheKey: string | null = null;
  try {
    const textHash = await hashKey(
      `${text}_${sourceLang || "auto"}_${targetLang}`,
    );
    cacheKey = buildTranslateCacheKey(userId, tier, textHash);

    const cached = await readTranslateCache(env, cacheKey);
    if (cached) {
      releaseUsage(env, userId, "translate", ctx);
      return { ok: true, result: cached };
    }
  } catch (err) {
    logger.error(`[synthesize] translate cache key error (continuing)`, {
      error: String(err),
    });
  }

  const result = await runTranslate({
    env,
    tier: pipelineTier,
    signal,
    text,
    targetLang,
    sourceLang,
    // Synthesis speaks the target script, so a romanization is never wanted.
    wantTransliteration: false,
    budgetMs,
  });

  if (!result) {
    releaseUsage(env, userId, "translate", ctx);
    return {
      ok: false,
      response: Response.json(
        { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
        { status: 503 },
      ),
    };
  }

  if (cacheKey) {
    ctx.waitUntil(writeTranslateCache(env, cacheKey, userId, tier, result));
  }
  return { ok: true, result };
}

export interface ResponseMeta {
  sourceLang: string;
  targetLang: string;
  translated: boolean;
  voiceId: string | undefined;
  /** User-typed or transcribed text. */
  transcript: string;
  /** The translated text if produced, otherwise null. */
  translation: string | null;
  /** Indicates if `transcript` covers only the beginning of what was said. */
  translationTruncated: boolean;
}

function wavDurationMs(audio: Uint8Array): number | undefined {
  if (audio.byteLength < 44) return undefined;
  const dv = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const byteRate = dv.getUint32(28, true);
  if (!byteRate || byteRate <= 0) return undefined;
  return Math.round((audio.byteLength / byteRate) * 1000);
}

export async function buildSpeechResponse(
  env: Env,
  result: SpeechResult,
  meta: ResponseMeta,
  cacheKey: string,
): Promise<Response> {
  const response = synthesizeResponseSchema.parse({
    audioUrl: `/speech/${await signSpeechUrl(env, cacheKey)}`,
    mime: result.mime,
    sourceLang: meta.sourceLang,
    targetLang: meta.targetLang,
    translated: meta.translated,
    voiceId: meta.voiceId || "standard",
    durationMs: result.mime.includes("wav")
      ? wavDurationMs(result.audio)
      : undefined,
    transcript: meta.transcript,
    translation: meta.translation,
    translationTruncated: meta.translationTruncated,
  });
  return Response.json(response);
}

interface FinishSpeechOptions {
  spokenText: string;
  spokenLang: string;
  /** Undefined when the client has not chosen a gender. */
  gender: "male" | "female" | undefined;
  voiceId: string | undefined;
  jwtTier: Tier;
  env: Env;
  signal: AbortSignal;
  ctx: ExecutionContext;
  userId: string;
  sessionId: string | null;
  /** Distinguishes successive renders of identical text. */
  reroll?: number;
  remainingMs: () => number;
  timings: RequestTimings;
  meta: ResponseMeta;
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void };
}

async function finishSpeech(options: FinishSpeechOptions): Promise<Response> {
  const {
    spokenText,
    spokenLang,
    gender,
    voiceId,
    jwtTier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    reroll,
    remainingMs,
    timings,
    meta,
    gateCharge,
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

  // Execute gate reservation for entitlements and budgets.
  const slot = getVoiceSlot(voiceId) ?? getStandardSlot();
  const slotTier = pipelineTierForSlot(slot);
  let executionTier: Tier = slotTier;
  let gateError: Response | null = null;

  // Pre-fetch cache speculatively based on slot tier while waiting for entitlement gate.
  const entitlementGate = guardVoiceEntitlement(voiceId, jwtTier);
  if (entitlementGate) return entitlementGate;

  const gatePromise = reserveSpeechGate(
    env,
    ctx,
    userId,
    jwtTier,
    sessionId,
    cleanSpoken.length,
    gateCharge,
  );

  const speculative = timings
    .measure("cache", async () => {
      const key = await buildSpeechCacheKey(
        cleanSpoken,
        spokenLang,
        gender,
        voiceId,
        userId,
        slotTier,
        "user",
        reroll,
      );
      // Treat failed reads as a miss but retain cache key to allow cache population.
      const hit = await readSpeechCache(env, key).catch((err) => {
        logger.warn(
          "[synthesize] speech cache read failed, treating as a miss",
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
        return null;
      });
      return { key, hit };
    })
    // Cache key could not be built.
    .catch((err) => {
      logger.warn("[synthesize] speech cache key build failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { key: "", hit: null };
    });

  const reserved = await gatePromise;
  if (reserved.ok) {
    executionTier = resolveExecutionTier(slotTier, reserved.tier);
  } else {
    gateError = reserved.response;
    executionTier = resolveExecutionTier(slotTier, reserved.tier);
  }

  let cacheKey: string;
  let cached: SpeechResult | null;
  if (executionTier === slotTier) {
    const speculativeResult = await speculative;
    cacheKey = speculativeResult.key;
    cached = speculativeResult.hit;
  } else {
    // Pro slot downgraded by gate; invalidate speculative read and retry at new execution tier.
    const recheck = await buildSpeechCacheKey(
      cleanSpoken,
      spokenLang,
      gender,
      voiceId,
      userId,
      executionTier,
      "user",
      reroll,
    ).then((key) =>
      readSpeechCache(env, key)
        .then((hit) => ({ key, hit }))
        .catch((err: unknown) => {
          logger.warn(
            "[synthesize] speech cache recheck failed, treating as a miss",
            { error: err instanceof Error ? err.message : String(err) },
          );
          return { key, hit: null };
        }),
    );
    cacheKey = recheck.key;
    cached = recheck.hit;
  }

  if (cached) {
    logger.info(`[synthesize] Speech cache hit tier=${executionTier}`);
    if (reserved.ok) {
      releaseUsage(env, userId, "speech", ctx, cleanSpoken.length);
    }
    timings.start("encode");
    const res = await buildSpeechResponse(env, cached, meta, cacheKey);
    timings.end("encode");
    return res;
  }
  logger.info(`[synthesize] Speech cache miss tier=${executionTier}`);

  if (gateError) return gateError;

  // Checked after `executionTier` settles: a language the pool cannot speak
  // must fail as a 4xx, not drain the pipeline into a 503.
  // Same derivation `resolveVoicePool` uses, so the guard and the pool it
  // validates cannot disagree. They read from two different sources before, and
  // a module dropping `tts` would have passed the guard only to produce an
  // empty pool — reported to the client as `SPEECH_UNAVAILABLE`.
  const speechSupportGuard = guardSupportedLanguage(
    spokenLang,
    "tts",
    getProviderNamesFor("tts", executionTier),
  );
  if (!speechSupportGuard.allowed) {
    if (reserved.ok) {
      releaseUsage(env, userId, "speech", ctx, cleanSpoken.length);
    }
    return speechSupportGuard.response;
  }

  const result = await timings.measure("tts", () =>
    runSpeechSynth({
      text: cleanSpoken,
      lang: spokenLang,
      gender,
      slot,
      tier: executionTier,
      env,
      signal,
      budgetMs: speechBudget,
      cacheKey,
    }),
  );
  if (!result) {
    releaseUsage(env, userId, "speech", ctx, cleanSpoken.length);
    return Response.json(
      {
        error: WORKER_ERROR_CODES.SPEECH_UNAVAILABLE,
        message:
          "Speech generation is temporarily unavailable. Please try again shortly.",
      },
      { status: 503 },
    );
  }

  timings.start("encode");
  const res = await buildSpeechResponse(env, result, meta, cacheKey);
  timings.end("encode");
  return res;
}

export async function synthesizeFromText(
  body: z.infer<typeof synthesizeRequestSchema>,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  sessionId: string | null,
  ctx: ExecutionContext,
  remainingMs: () => number,
  timings: RequestTimings,
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void },
): Promise<Response> {
  const { text, sourceLang, targetLang, gender, voiceId, reroll } = body;

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

  const resolvedGender = gender;

  let spokenText = cleanText;
  let translated = false;
  let effectiveSource = sourceLang ?? targetLang;
  // Match reported transcript to the same text span the translation covers.
  let reportedText = cleanText;
  let translationTruncated = false;

  const needsTranslate =
    sourceLang !== undefined &&
    sourceLang !== "auto" &&
    sourceLang !== targetLang;

  if (needsTranslate) {
    const shrunk = preShrinkForTranslate(cleanText, tier);
    reportedText = shrunk.text;
    translationTruncated = shrunk.truncated;
    const translation = await translateStage({
      text: shrunk.text,
      sourceLang,
      targetLang,
      tier,
      userId,
      env,
      signal,
      budgetMs: Math.min(TRANSLATE_TOTAL_MS, remainingMs()),
      ctx,
      sessionId,
      gateCharge,
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
      detected = await detectTextLanguage(cleanText, env, signal);
    } catch (err) {
      logger.error(`[synthesize] auto-detect failed: ${String(err)}`);
    }
    if (detected && detected !== targetLang) {
      const shrunk = preShrinkForTranslate(cleanText, tier);
      reportedText = shrunk.text;
      translationTruncated = shrunk.truncated;
      const translation = await translateStage({
        text: shrunk.text,
        sourceLang: detected,
        targetLang,
        tier,
        userId,
        env,
        signal,
        budgetMs: Math.min(TRANSLATE_TOTAL_MS, remainingMs()),
        ctx,
        sessionId,
        gateCharge,
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

  const speechResponse = await finishSpeech({
    spokenText,
    spokenLang: targetLang,
    gender: resolvedGender,
    voiceId,
    jwtTier: tier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    reroll,
    remainingMs,
    timings,
    gateCharge,
    meta: {
      sourceLang: effectiveSource,
      targetLang,
      translated,
      voiceId,
      transcript: reportedText,
      translation: translated ? spokenText : null,
      translationTruncated,
    },
  });

  if (!speechResponse.ok && translated) {
    releaseUsage(env, userId, "translate", ctx);
  }

  return speechResponse;
}

export async function synthesizeFromAudio(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  sessionId: string | null,
  ctx: ExecutionContext,
  remainingMs: () => number,
  timings: RequestTimings,
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void },
): Promise<Response> {
  // Return the preflight charge on abort; a mid-pipeline disconnect otherwise
  // throws past every early return and discards paid provider calls.
  let charged = true;
  const settle = (): void => {
    if (!charged) return;
    charged = false;
    releaseUsage(env, userId, "transcribe", ctx);
  };

  try {
    return await runFromAudio();
  } catch (err) {
    settle();
    throw err;
  }

  async function runFromAudio(): Promise<Response> {
    const ingest = await ingestAudioUpload(request, tier);
    if (!ingest.ok) return ingest.response;
    const { audio, audioHash, durationMs, form, codec } = ingest.value;

    const lang = form.get("lang") as string | null;
    const targetLang = form.get("targetLang") as string | null;
    const genderRaw = form.get("gender") as string | null;
    const voiceIdRaw = form.get("voiceId") as string | null;
    logger.info(
      `[synthesize] lang=${lang} targetLang=${targetLang} duration=${durationMs} mime=${ingest.value.mimeType} codec=${codec} size=${audio.size}`,
    );

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

    // Maintain `null` gender to use provider-specific neutral defaults.
    let resolvedGender: "male" | "female" | undefined;
    if (genderRaw !== null && genderRaw !== "male" && genderRaw !== "female") {
      return Response.json(
        { error: WORKER_ERROR_CODES.INVALID_BODY },
        { status: 400 },
      );
    }
    if (genderRaw !== null) resolvedGender = genderRaw;

    let voiceId: string | undefined;
    if (voiceIdRaw !== null) {
      if (!VOICE_SLOT_IDS.includes(voiceIdRaw)) {
        return Response.json(
          { error: WORKER_ERROR_CODES.INVALID_BODY },
          { status: 400 },
        );
      }
      voiceId = voiceIdRaw;
    }

    const transcribeSkip = gateCharge.skipCooldown();
    gateCharge.markCharged();
    const transcribeGate = await timings.measure("stt.gate", () =>
      runPreflightGate(
        env,
        ctx,
        userId,
        tier,
        "transcribe",
        sessionId,
        0,
        transcribeSkip,
      ),
    );
    if (!transcribeGate.ok) return transcribeGate.response;
    if (signal.aborted) throw new Error(CLIENT_ABORTED);
    const sttPipelineTier = transcribeGate.preflight.throttled ? "FREE" : tier;

    let cacheKey: string | null = null;
    let transcript: string | null = null;
    let detectedLang: string | null = null;
    let transcribeCharged = true;
    try {
      cacheKey = buildTranscribeCacheKey({
        userId,
        tier,
        audioHash,
        lang,
      });

      const cached = await readTranscribeCache(env, cacheKey);
      if (cached) {
        transcript = cached.text;
        detectedLang = cached.language ?? null;
        releaseUsage(env, userId, "transcribe", ctx);
        transcribeCharged = false;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[synthesize] D1 cache lookup error (continuing): ${msg}`);
    }

    if (transcript === null) {
      const isAuto = !lang || lang === "auto";
      const result = await timings.measure("stt", () =>
        runTranscribe({
          audioBlob: audio,
          effectiveLang: isAuto ? "auto" : lang,
          isAuto,
          codec,
          tier: sttPipelineTier,
          env,
          signal,
          budgetMs: Math.min(TRANSCRIBE_TOTAL_MS, remainingMs()),
          durationMs: durationMs ?? 0,
        }),
      );
      if (!result) {
        releaseUsage(env, userId, "transcribe", ctx);
        return Response.json(
          { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
          { status: 503 },
        );
      }
      transcript = result.text;
      detectedLang = result.language ?? null;

      if (cacheKey) {
        const prepared = stripTranscriptLanguage(result, tier);
        ctx.waitUntil(
          writeTranscribeCache(env, cacheKey, userId, tier, prepared),
        );
      }
    }

    let spokenText = sanitizeTranslationText(transcript);
    if (!spokenText) {
      if (transcribeCharged) {
        releaseUsage(env, userId, "transcribe", ctx);
      }
      return Response.json(
        { error: WORKER_ERROR_CODES.EKWE_EMPTY_TRANSCRIPT },
        { status: 400 },
      );
    }

    let translated = false;
    let effectiveSource = lang ?? targetLang;
    let reportedTranscript = spokenText;
    let translationTruncated = false;

    if (lang !== targetLang) {
      const isAuto = !lang || lang === "auto";
      let sourceCode: string | null = isAuto ? detectedLang : lang;
      if (isAuto && detectedLang && detectedLang === targetLang) {
        sourceCode = null;
      }

      if (sourceCode) {
        if (signal.aborted) throw new Error(CLIENT_ABORTED);
        const shrunk = preShrinkForTranslate(spokenText, tier);
        reportedTranscript = shrunk.text;
        translationTruncated = shrunk.truncated;
        const translation = await timings.measure("mt", () =>
          translateStage({
            text: shrunk.text,
            sourceLang: sourceCode,
            targetLang,
            tier: tier,
            userId,
            env,
            signal,
            budgetMs: Math.min(TRANSLATE_TOTAL_MS, remainingMs()),
            ctx,
            sessionId,
            gateCharge,
          }),
        );
        if (!translation.ok) {
          if (transcribeCharged) {
            releaseUsage(env, userId, "transcribe", ctx);
          }
          return translation.response;
        }
        spokenText = translation.result.translation;
        translated = true;
        effectiveSource = sourceCode;
      } else {
        effectiveSource = detectedLang ?? targetLang;
      }
    }

    const speechResponse = await finishSpeech({
      spokenText,
      spokenLang: targetLang,
      gender: resolvedGender,
      voiceId,
      jwtTier: tier,
      env,
      signal,
      ctx,
      userId,
      sessionId,
      remainingMs,
      timings,
      gateCharge,
      meta: {
        sourceLang: effectiveSource,
        targetLang,
        translated,
        voiceId,
        transcript: reportedTranscript,
        translation: translated ? spokenText : null,
        translationTruncated,
      },
    });

    if (!speechResponse.ok) {
      if (transcribeCharged) {
        releaseUsage(env, userId, "transcribe", ctx);
      }
      if (translated) {
        releaseUsage(env, userId, "translate", ctx);
      }
    }

    return speechResponse;
  }
}

export function createGateCharge(): {
  skipCooldown: () => boolean;
  markCharged: () => void;
} {
  let charged = false;
  return {
    skipCooldown: (): boolean => charged,
    markCharged: (): void => {
      charged = true;
    },
  };
}

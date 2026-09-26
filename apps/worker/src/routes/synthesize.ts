import {
  WORKER_ERROR_CODES,
  TRANSLATE_EXPANSION_CUSHION,
  synthesizeRequestSchema,
  synthesizeResponseSchema,
  translateResponseSchema,
  VOICE_SLOT_IDS,
  getStandardSlot,
  getVoiceSlot,
  getLanguageName,
} from "@ekwe/shared";
import { logger } from "@/core/logger";
import { RequestTimings } from "@/core/timing";
import { getProviderModule, getProviderNamesFor } from "@/providers";
import { pipelineTierForSlot, resolveExecutionTier } from "@/core/voices";
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
  entitlementTier: Tier,
  isPreview: boolean,
): Response | null {
  if (isPreview || !voiceId || entitlementTier !== "FREE") return null;
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
  /**
   * The text as the user gave it to us — the typed text, or the transcript of
   * the uploaded audio. Reported back so the client can archive what it paid
   * to have understood; previously this was computed and then discarded, which
   * is why Speech Studio could not write to History at all.
   */
  transcript: string;
  /** The translated text when one was produced, otherwise null. */
  translation: string | null;
}

function wavDurationMs(audio: Uint8Array): number | undefined {
  if (audio.byteLength < 44) return undefined;
  const dv = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const byteRate = dv.getUint32(28, true);
  if (!byteRate || byteRate <= 0) return undefined;
  return Math.round((audio.byteLength / byteRate) * 1000);
}

interface SpeechDelivery {
  /** Absent when the cache key could not be built, which forces inline audio. */
  cacheKey: string;
  preferBase64: boolean;
}

/**
 * The multipart path has no JSON body to carry `preferBase64`, so it takes the
 * opt-out as a query flag instead. Anything that does not ask for it gets the
 * URL response.
 */
function wantsInlineAudio(request: Request): boolean {
  return new URL(request.url).searchParams.get("inline") === "1";
}

function buildSpeechResponse(
  result: SpeechResult,
  meta: ResponseMeta,
  delivery: SpeechDelivery,
): Response {
  // Default to the URL. Base64 inflates the body by a third and burns CPU
  // re-encoding bytes the client is about to decode again, so it is only
  // inlined when the client asked for it or when there is no key to address.
  const useUrl = !delivery.preferBase64 && delivery.cacheKey.length > 0;

  const response = synthesizeResponseSchema.parse({
    ...(useUrl
      ? { audioUrl: `/speech/${delivery.cacheKey}` }
      : { audioBase64: bytesToBase64(result.audio) }),
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
  isPreview: boolean;
  remainingMs: () => number;
  timings: RequestTimings;
  meta: ResponseMeta;
  /**
   * Set by clients that predate the URL response. When they ask for inline
   * audio the cache write can be deferred, because nothing in the response
   * depends on the object existing yet.
   */
  preferBase64: boolean;
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
    isPreview,
    remainingMs,
    timings,
    meta,
    preferBase64,
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

  // Entitlement and execution are separate facts. Entitlement comes from the
  // JWT and is never downgraded, so a throttled Pro user is never told to
  // upgrade. Execution may fall back to the free pool, in which case Studio
  // degrades to the free providers' voices instead of erroring — matching the
  // "a throttled PREMIUM request is never denied" contract in check_preflight.
  // The selected slot decides which pipeline may serve the request, so a Pro
  // user on Standard stays on the free pool. The budget gate can only
  // downgrade from there.
  // An absent voiceId means Standard. Resolved once so the tier check and the
  // pool can never disagree about which slot is in play.
  const slot = getVoiceSlot(voiceId) ?? getStandardSlot();
  const slotTier = pipelineTierForSlot(slot);
  const scope = isPreview ? "shared" : "user";
  let executionTier: Tier = slotTier;
  let gateError: Response | null = null;

  // The gate and the cache read are independent, and doing them in sequence put
  // two network round trips in front of every request. Start the gate, then read
  // the cache speculatively at the slot's tier while it is in flight.
  //
  // `resolveExecutionTier` collapses to FREE whenever the slot is FREE, so for
  // the standard slot the speculative tier is always the final tier and the
  // read is never wasted. Only a Pro slot can resolve to a different tier, and
  // that costs one extra read — still cheaper than serialising the common case.
  const gatePromise = isPreview
    ? Promise.resolve<SpeechGate>({ ok: true, tier: jwtTier })
    : reserveSpeechGate(
        env,
        ctx,
        userId,
        jwtTier,
        sessionId,
        cleanSpoken.length,
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
        scope,
      );
      // A failed read is a miss, not an absent key. Swallowing it here keeps
      // `key` so the synthesis below still populates the cache — collapsing both
      // failures into one empty key would make a transient KV blip permanently
      // uncacheable for this text.
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
    // The key itself could not be built, so there is genuinely nothing to read
    // or write. This also guards the unhandled rejection: the entitlement gate
    // below can return before this promise is awaited.
    .catch((err) => {
      logger.warn("[synthesize] speech cache key build failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return { key: "", hit: null };
    });

  const entitlementGate = guardVoiceEntitlement(voiceId, jwtTier, isPreview);
  if (entitlementGate) return entitlementGate;

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
    // Pro slot downgraded by the gate: the speculative read used the wrong tier
    // in the key, so it cannot be trusted.
    //
    // `readSpeechCache` does not swallow its own KV/R2 errors, so this path needs
    // the same guard as the speculative read above. Without it a transient cache
    // blip would surface as a 500 here while the standard-slot path degraded
    // gracefully to a miss.
    const recheck = await buildSpeechCacheKey(
      cleanSpoken,
      spokenLang,
      gender,
      voiceId,
      userId,
      executionTier,
      scope,
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
    logger.info(
      `[synthesize] Speech cache hit scope=${scope} tier=${executionTier}`,
    );
    timings.start("encode");
    const res = buildSpeechResponse(cached, meta, {
      cacheKey,
      preferBase64,
    });
    timings.end("encode");
    return res;
  }
  logger.info(
    `[synthesize] Speech cache miss scope=${scope} tier=${executionTier}`,
  );

  if (gateError) return gateError;

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
      // A URL response is only useful once the bytes are actually addressable,
      // so in that mode the write is awaited. Inline responses can keep
      // deferring it, because the caller already has the audio in hand.
      waitUntil: preferBase64 ? (promise) => ctx.waitUntil(promise) : undefined,
    }),
  );
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

  timings.start("encode");
  const res = buildSpeechResponse(result, meta, { cacheKey, preferBase64 });
  timings.end("encode");
  return res;
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
  timings: RequestTimings,
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
  // Absent means the client predates the URL response, which is the signal to
  // keep inlining the audio for it.
  const preferBase64 = parsed.data.preferBase64 === true;

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
      jwtTier: tier,
      env,
      signal,
      ctx,
      userId,
      sessionId,
      isPreview: true,
      remainingMs,
      timings,
      preferBase64,
      meta: {
        sourceLang: sourceLang ?? targetLang,
        targetLang,
        translated: false,
        voiceId,
        transcript: cleanText,
        translation: null,
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
    jwtTier: tier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    isPreview: false,
    remainingMs,
    timings,
    preferBase64,
    meta: {
      sourceLang: effectiveSource,
      targetLang,
      translated,
      voiceId,
      transcript: cleanText,
      translation: translated ? spokenText : null,
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
  timings: RequestTimings,
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

  // `null` means the client has not chosen; providers supply their own neutral
  // default, so it is passed through rather than coerced to a gender here.
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

  const transcribeGate = await timings.measure("stt.gate", () =>
    runPreflightGate(env, ctx, userId, tier, "transcribe", sessionId),
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
    const result = await timings.measure("stt", () =>
      runTranscribe({
        audioBlob,
        effectiveLang: isAuto ? "auto" : lang,
        isAuto,
        tier: tier,
        env,
        signal,
        budgetMs: Math.min(TRANSCRIBE_TOTAL_MS, remainingMs()),
      }),
    );
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
      const translation = await timings.measure("mt", () =>
        translateStage({
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
        }),
      );
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
    jwtTier: tier,
    env,
    signal,
    ctx,
    userId,
    sessionId,
    isPreview: false,
    remainingMs,
    timings,
    preferBase64: wantsInlineAudio(request),
    meta: {
      sourceLang: effectiveSource,
      targetLang,
      translated,
      voiceId,
      transcript,
      translation: translated ? spokenText : null,
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
  timings: RequestTimings = new RequestTimings(),
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
      timings,
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
    timings,
  );
}

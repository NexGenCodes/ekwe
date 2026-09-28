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
  SYNTHESIZE_TOTAL_MS,
  TRANSCRIBE_TOTAL_MS,
  TRANSLATE_TOTAL_MS,
} from "@/core/budgets";
import { getLimits } from "@/core/limits";
import {
  guardAutoDetect,
  guardContentType,
  guardJsonSize,
  guardLanguageCode,
  MAX_JSON_BODY_BYTES,
  safeParseJSON,
} from "@/core/guards";
import { sanitizeTranslationText } from "@/core/sanitize";
import { hashKey } from "@/utils/keys";
import { signSpeechUrl } from "@/utils/speech-url";
import { ingestAudioUpload } from "@/services/audio";
import { detectTextLanguage } from "@/services/auto-detect";
import { runPreflightGate } from "@/services/preflight";
import { buildTranslateCacheKey, runTranslateJob } from "@/services/translate";
import { trackBillableSuccess } from "@/services/usage";
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
  resolveEffectiveLang,
  runSpeechSynth,
  type SpeechResult,
} from "@/services/speech";
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

  let cacheKey: string | null = null;
  let textHash = "";
  try {
    textHash = await hashKey(`${text}_${sourceLang || "auto"}_${targetLang}`);
    cacheKey = buildTranslateCacheKey(userId, tier, textHash);
  } catch (err) {
    logger.error(`[synthesize] translate cache key error (continuing)`, {
      error: String(err),
    });
  }

  const result = await runTranslateJob({
    env,
    tier,
    userId,
    ctx,
    signal,
    text,
    sourceLang,
    targetLang,
    // Synthesis speaks the target script, so a romanization is never wanted.
    wantTransliteration: false,
    cacheKey,
    textHash,
    budgetMs,
    logPrefix: "[synthesize]",
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
  /** True when `transcript` covers only the opening span of what was said. */
  translationTruncated: boolean;
}

function wavDurationMs(audio: Uint8Array): number | undefined {
  if (audio.byteLength < 44) return undefined;
  const dv = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const byteRate = dv.getUint32(28, true);
  if (!byteRate || byteRate <= 0) return undefined;
  return Math.round((audio.byteLength / byteRate) * 1000);
}

async function buildSpeechResponse(
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
  isPreview: boolean;
  /** Distinguishes successive renders of identical text; absent is a normal request. */
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
    isPreview,
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
  const entitlementGate = guardVoiceEntitlement(voiceId, jwtTier, isPreview);
  if (entitlementGate) return entitlementGate;

  const gatePromise = isPreview
    ? Promise.resolve<SpeechGate>({ ok: true, tier: jwtTier })
    : reserveSpeechGate(
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
        scope,
        reroll,
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
    // or write.
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
    logger.info(
      `[synthesize] Speech cache hit scope=${scope} tier=${executionTier}`,
    );
    timings.start("encode");
    const res = await buildSpeechResponse(env, cached, meta, cacheKey);
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
      // The response points straight at this object, so the write must have
      // landed before we reply: a client that fetches the URL immediately
      // would otherwise race it.
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
  const res = await buildSpeechResponse(env, result, meta, cacheKey);
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
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void },
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
  const { text, sourceLang, targetLang, gender, voiceId, reroll } = parsed.data;

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
      gateCharge,
      meta: {
        sourceLang: sourceLang ?? targetLang,
        targetLang,
        translated: false,
        voiceId,
        transcript: cleanText,
        translation: null,
        translationTruncated: false,
      },
    });
  }

  let spokenText = cleanText;
  let translated = false;
  let effectiveSource = sourceLang ?? targetLang;
  // The transcript reported back must describe the same span the translation
  // covers, or the pair contradicts the response schema's own contract.
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
      detected = await detectTextLanguage(cleanText, env.EKWE_D1, signal);
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
  gateCharge: { skipCooldown: () => boolean; markCharged: () => void },
): Promise<Response> {
  const ingest = await ingestAudioUpload(request, tier);
  if (!ingest.ok) return ingest.response;
  const { audio, audioHash, durationMs, form } = ingest.value;

  const lang = form.get("lang") as string | null;
  const targetLang = form.get("targetLang") as string | null;
  const genderRaw = form.get("gender") as string | null;
  const voiceIdRaw = form.get("voiceId") as string | null;
  logger.info(
    `[synthesize] lang=${lang} targetLang=${targetLang} duration=${durationMs} mime=${ingest.value.mimeType} size=${audio.size}`,
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

  let cacheKey: string | null = null;
  let transcript: string | null = null;
  let detectedLang: string | null = null;
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
}

export interface SynthesizeAuthContext {
  userId: string;
  sessionId: string | null;
}

/**
 * One per request. A combined request charges the cooldown on its first gate
 * and passes `true` to the rest.
 *
 * This must never be module-level: a Worker isolate handles requests
 * concurrently, so shared state would let one request skip another's cooldown.
 */
function createGateCharge(): {
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
  const gateCharge = createGateCharge();

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
      gateCharge,
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
    gateCharge,
  );
}

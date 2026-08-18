import { WORKER_ERROR_CODES, transcribeResponseSchema } from "@ekwe/shared";
import { logger } from "../core/logger";
import * as assemblyai from "../providers/assemblyai";
import * as cloudflare from "../providers/cloudflare";
import * as cohere from "../providers/cohere";
import * as deepgram from "../providers/deepgram";
import * as gladia from "../providers/gladia";
import * as groq from "../providers/groq";
import * as witai from "../providers/witai";
import { getTranscribeProviderNames } from "../core/config";
import { getLimits } from "../core/limits";
import {
  guardAudioDuration,
  guardAudioSize,
  guardAutoDetect,
  guardContentType,
  guardLanguageCode,
  guardMultipartSize,
  MULTIPART_OVERHEAD,
  readLimitedBody,
} from "../core/guards";
import { hashBytes } from "../utils/keys";
import { sniffAudioMime } from "../utils/mime";
import { d1Get, d1Put } from "../services/d1-cache";
import { runProviderFailover } from "../utils/pipeline";
import { trackBillableSuccess } from "../services/usage";
import {
  detectTextLanguage,
  validateTranscriptLanguage,
} from "../services/autoDetect";
import { Env, Tier, TranscribeResult } from "../core/types";

interface PipelineEntry {
  name: string;
  skipOnAuto: boolean;
  supportedLanguages: ReadonlySet<string>;
  timeoutMs: number;
  fn: (
    blob: Blob,
    lang: string,
    env: Env,
    signal: AbortSignal,
  ) => Promise<TranscribeResult | null>;
}

const PROVIDER_TIMEOUT = {
  deepgram: { premium: 5_000, free: 8_000 },
  cohere: { premium: 8_000, free: 12_000 },
  gladia: { premium: 8_000, free: 12_000 },
  assemblyai: { premium: 8_000, free: 15_000 },
  witai: { premium: 10_000, free: 15_000 },
  groq: { premium: 8_000, free: 12_000 },
  cloudflare: { premium: 10_000, free: 15_000 },
} as const;

const PROVIDER_MODULES: Record<
  string,
  { supportedLanguages: ReadonlySet<string>; transcribe: PipelineEntry["fn"] }
> = {
  deepgram: {
    supportedLanguages: deepgram.supportedLanguages,
    transcribe: deepgram.transcribe,
  },
  cohere: {
    supportedLanguages: cohere.supportedLanguages,
    transcribe: cohere.transcribe,
  },
  gladia: {
    supportedLanguages: gladia.supportedLanguages,
    transcribe: gladia.transcribe,
  },
  assemblyai: {
    supportedLanguages: assemblyai.supportedLanguages,
    transcribe: assemblyai.transcribe,
  },
  witai: {
    supportedLanguages: witai.supportedLanguages,
    transcribe: witai.transcribe,
  },
  groq: {
    supportedLanguages: groq.supportedLanguages,
    transcribe: groq.transcribe,
  },
  cloudflare: {
    supportedLanguages: cloudflare.supportedLanguages,
    transcribe: cloudflare.transcribe,
  },
};

const PROVIDER_SKIP_AUTO: Record<string, boolean> = {
  deepgram: false,
  cohere: true,
  gladia: false,
  assemblyai: false,
  witai: true,
  groq: false,
  cloudflare: false,
};

function buildPipeline(
  names: readonly string[],
  tier: "free" | "premium",
): PipelineEntry[] {
  return names.map((name) => ({
    name,
    skipOnAuto: PROVIDER_SKIP_AUTO[name] ?? false,
    supportedLanguages: PROVIDER_MODULES[name]?.supportedLanguages ?? new Set(),
    timeoutMs:
      PROVIDER_TIMEOUT[name as keyof typeof PROVIDER_TIMEOUT]?.[tier] ?? 15_000,
    fn: PROVIDER_MODULES[name]?.transcribe ?? (() => Promise.resolve(null)),
  }));
}

const FREE_PIPELINE = buildPipeline(getTranscribeProviderNames("FREE"), "free");
const PREMIUM_PIPELINE = buildPipeline(
  getTranscribeProviderNames("PREMIUM"),
  "premium",
);

// Hard ceiling for the whole provider failover loop. Providers are tried
// sequentially (cheapest first), but without a total budget a full failure
// could take the sum of all per-provider timeouts (~60s+) — past the mobile
// client's 30s timeout, so the user would have given up already.
const PIPELINE_TOTAL_MS = 25_000;

export async function handleTranscribe(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
  userId: string,
  ctx?: ExecutionContext,
): Promise<Response> {
  logger.info(`[transcribe] handleTranscribe started`, { tier });

  // Reject non-multipart payloads before parsing: formData() would throw on
  // JSON/other Content-Types and surface as a confusing 500.
  const ctGuard = guardContentType(request, "multipart");
  if (!ctGuard.allowed) return ctGuard.response;

  // Reject oversized uploads BEFORE buffering the whole body into memory.
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

  // Reject empty uploads before running any provider: a 0-byte "recording"
  // wastes the whole failover pipeline and surfaces as a confusing
  // "all providers failed" to the client.
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
    // Tier is part of the key so a premium auto-detect result (which may
    // include `language`) can never be served to a downgraded FREE user who
    // isn't entitled to auto-detection.
    cacheKey = `transcribe:${userId}:${tier}:${audioHash}:${lang || "auto"}`;
    if (env.EKWE_D1) {
      const cached = await d1Get(env.EKWE_D1, "cache_transcription", cacheKey);
      if (cached) {
        const cachedResult = JSON.parse(cached) as TranscribeResult;
        const shapeCheck = transcribeResponseSchema.safeParse(cachedResult);
        if (shapeCheck.success) {
          return Response.json(cachedResult);
        }
        logger.warn(
          `[transcribe] D1 cache entry failed validation (ignoring): ${audioHash}`,
        );
      }
    }
  } catch (err) {
    // The cache is an optimization, never a dependency: any lookup failure
    // (D1 outage, corrupt/unparseable entry, hashing error) must degrade to a
    // live transcription rather than fail the request with a 503.
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

  const pipeline = tier === "FREE" ? FREE_PIPELINE : PREMIUM_PIPELINE;

  logger.info(
    `[transcribe] Starting provider pipeline, pipeline has ${pipeline.length} providers`,
  );
  const byName = new Map(pipeline.map((p) => [p.name, p]));
  // Lookup helper: names come from `pipeline` itself, so a miss is a real
  // misconfiguration — fail loudly instead of hitting `undefined.fn`.
  const entry = (name: string): PipelineEntry => {
    const e = byName.get(name);
    if (!e) throw new Error(`[transcribe] Unknown provider: ${name}`);
    return e;
  };
  const result = await runProviderFailover<TranscribeResult>({
    providers: pipeline.map((p) => p.name),
    signal,
    totalMs: PIPELINE_TOTAL_MS,
    route: "transcribe",
    attemptTimeoutMs: (name, remainingMs) =>
      Math.min(entry(name).timeoutMs, remainingMs),
    shouldSkip: (name) => {
      const e = entry(name);
      if (isAuto && e.skipOnAuto) {
        logger.info(`[transcribe] Skipping ${name} (skipOnAuto)`);
        return true;
      }
      if (!isAuto && !e.supportedLanguages.has(effectiveLang)) {
        logger.info(
          `[transcribe] Skipping ${name} (unsupported language: ${effectiveLang})`,
        );
        return true;
      }
      return false;
    },
    onTrying: (name, remainingMs) => {
      logger.info(`[transcribe] Trying ${name}`, {
        lang: effectiveLang,
        tier,
        timeoutMs: Math.min(entry(name).timeoutMs, remainingMs),
      });
    },
    invoke: (name, attemptSignal) =>
      entry(name).fn(audioBlob, effectiveLang, env, attemptSignal),
    handleAttempt: async (name, attempt) => {
      if (!attempt) {
        logger.info(`[transcribe] ${name} returned null (no result)`);
        return false;
      }

      // Schema gate: malformed provider output is a failed attempt so the
      // pipeline fails over instead of shipping garbage to the client.
      const shapeCheck = transcribeResponseSchema.safeParse(attempt);
      if (!shapeCheck.success) {
        logger.warn(`[transcribe] ${name} returned a malformed result`, {
          issues: shapeCheck.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        });
        return false;
      }

      if (
        isAuto &&
        attempt.language &&
        !validateTranscriptLanguage(attempt.text, attempt.language)
      ) {
        logger.info(`[transcribe] ${name} rejected (language mismatch)`);
        return false;
      }

      // The provider succeeded but didn't report a detected language (e.g.
      // cohere omits it on auto, deepgram can return null). Fall back to the
      // worker's own detection so the client's "Detected ·" UI and the
      // subsequent /translate call still have a concrete source language.
      if (isAuto && !attempt.language) {
        try {
          const detected = await detectTextLanguage(
            attempt.text,
            env.EKWE_D1,
            signal,
          );
          if (detected) {
            attempt = { ...attempt, language: detected };
            logger.info(
              `[transcribe] ${name} had no language — worker detected ${detected}`,
            );
          }
        } catch (err) {
          logger.error(
            `[transcribe] Language detection fallback failed: ${String(err)}`,
          );
        }
      }

      logger.info(`[transcribe] Success: ${name}`, {
        lang: attempt.language,
        provider: attempt.provider,
      });

      const limits = getLimits(tier);
      if (!limits.autoDetectAllowed && "language" in attempt) {
        attempt = { ...attempt };
        delete attempt.language;
      }

      try {
        if (cacheKey && env.EKWE_D1) {
          await d1Put(
            env.EKWE_D1,
            "cache_transcription",
            cacheKey,
            userId,
            tier,
            JSON.stringify(attempt),
            4 * 60 * 60,
          );
        }
      } catch (err) {
        logger.error(`[transcribe] D1 cache write error`, {
          error: String(err),
        });
      }

      // Billable success: counts against the user's daily transcribe quota.
      // Also invalidates the preflight gate so the next request sees the
      // freshly consumed count. Replays served from the KV cache above never
      // reach this point, so they stay free.
      trackBillableSuccess(env, userId, "transcribe", ctx);

      return true;
    },
  });
  if (result) return Response.json(result);

  logger.error(`[transcribe] ALL providers failed`);

  return Response.json(
    { error: WORKER_ERROR_CODES.EKWE_ALL_PROVIDERS_FAIL },
    { status: 503 },
  );
}

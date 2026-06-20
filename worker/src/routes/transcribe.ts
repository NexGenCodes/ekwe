import { logger } from "../logger";
import * as assemblyai from "../providers/assemblyai";
import * as cloudflare from "../providers/cloudflare";
import * as cohere from "../providers/cohere";
import * as deepgram from "../providers/deepgram";
import * as gladia from "../providers/gladia";
import * as groq from "../providers/groq";
import * as witai from "../providers/witai";
import { getTranscribeProviderNames } from "../config";
import { guardAudioSize, guardAutoDetect, guardLanguageCode } from "../security";
import { hashBytes } from "../utils/keys";
import { CLIENT_ABORTED, Env, Tier, TranscribeResult } from "../types";

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
  deepgram:    { premium: 5_000,  free: 8_000  },
  cohere:      { premium: 8_000,  free: 12_000 },
  gladia:      { premium: 8_000,  free: 12_000 },
  assemblyai:  { premium: 8_000,  free: 15_000 },
  witai:       { premium: 10_000, free: 15_000 },
  groq:        { premium: 8_000,  free: 12_000 },
  cloudflare:  { premium: 10_000, free: 15_000 },
} as const;

const PROVIDER_MODULES: Record<string, { supportedLanguages: ReadonlySet<string>; transcribe: PipelineEntry['fn'] }> = {
  deepgram:   { supportedLanguages: deepgram.supportedLanguages,   transcribe: deepgram.transcribe },
  cohere:     { supportedLanguages: cohere.supportedLanguages,     transcribe: cohere.transcribe },
  gladia:     { supportedLanguages: gladia.supportedLanguages,     transcribe: gladia.transcribe },
  assemblyai: { supportedLanguages: assemblyai.supportedLanguages, transcribe: assemblyai.transcribe },
  witai:      { supportedLanguages: witai.supportedLanguages,      transcribe: witai.transcribe },
  groq:       { supportedLanguages: groq.supportedLanguages,       transcribe: groq.transcribe },
  cloudflare: { supportedLanguages: cloudflare.supportedLanguages, transcribe: cloudflare.transcribe },
};

const PROVIDER_SKIP_AUTO: Record<string, boolean> = {
  deepgram:   false,
  cohere:     true,
  gladia:     false,
  assemblyai: false,
  witai:      true,
  groq:       false,
  cloudflare: false,
};

function buildPipeline(names: readonly string[], tier: 'free' | 'premium'): PipelineEntry[] {
  return names.map((name) => ({
    name,
    skipOnAuto: PROVIDER_SKIP_AUTO[name] ?? false,
    supportedLanguages: PROVIDER_MODULES[name]?.supportedLanguages ?? new Set(),
    timeoutMs: PROVIDER_TIMEOUT[name as keyof typeof PROVIDER_TIMEOUT]?.[tier] ?? 15_000,
    fn: PROVIDER_MODULES[name]?.transcribe ?? (async () => null),
  }));
}

const FREE_PIPELINE = buildPipeline(getTranscribeProviderNames('FREE'), 'free');
const PREMIUM_PIPELINE = buildPipeline(getTranscribeProviderNames('PREMIUM'), 'premium');

export async function handleTranscribe(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  logger.info(`[transcribe] handleTranscribe started`, { tier });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] formData() FAILED: ${msg}`);
    return Response.json(
      { error: "EKWE_TRANSCRIPTION_FAIL", message: `formData error: ${msg}` },
      { status: 500 },
    );
  }

  const file = formData.get("file") as File | null;
  const lang = formData.get("lang") as string | null;
  logger.info(`[transcribe] file=${!!file} lang=${lang} fileType=${file?.type} fileName=${file?.name} fileSize=${file?.size}`);

  if (!file) return Response.json({ error: "MISSING_FILE" }, { status: 400 });

  const sizeGuard = guardAudioSize(file.size, tier);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, "lang");
  if (!langGuard.allowed) return langGuard.response;

  let audioBuffer: ArrayBuffer;
  let mimeType: string;
  try {
    audioBuffer = await file.arrayBuffer();

    mimeType = file.type;
    const headerView = new Uint8Array(audioBuffer, 0, 4);

    if (
      headerView[0] === 0x4f &&
      headerView[1] === 0x67 &&
      headerView[2] === 0x67 &&
      headerView[3] === 0x53
    ) {
      mimeType = "audio/ogg";
    } else if (
      headerView[0] === 0x66 &&
      headerView[1] === 0x4c &&
      headerView[2] === 0x61 &&
      headerView[3] === 0x43
    ) {
      mimeType = "audio/flac";
    } else if (!mimeType || mimeType === "application/octet-stream") {
      mimeType = "audio/wav";
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] file.arrayBuffer() FAILED: ${msg}`);
    return Response.json(
      {
        error: "EKWE_ALL_PROVIDERS_FAIL",
        message: `Failed to read audio file: ${msg}`,
      },
      { status: 503 },
    );
  }

  let cacheKey: string;
  try {
    const audioHash = await hashBytes(audioBuffer);
    cacheKey = `transcribe:${audioHash}:${lang || "auto"}`;
    const cached = await env.EKWE_KV.get(cacheKey);
    if (cached) {
      return Response.json(JSON.parse(cached) as TranscribeResult);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] KV cache lookup error: ${msg}`);
    return Response.json(
      {
        error: "EKWE_ALL_PROVIDERS_FAIL",
        message: `KV cache error: ${msg}`,
      },
      { status: 503 },
    );
  }

  let audioBlob: Blob;
  try {
    audioBlob = new Blob([audioBuffer], { type: mimeType });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[transcribe] Blob creation FAILED: ${msg}`);
    return Response.json(
      { error: "EKWE_ALL_PROVIDERS_FAIL", message: `Blob error: ${msg}` },
      { status: 503 },
    );
  }
  const isAuto = !lang || lang === "auto";
  const effectiveLang = isAuto ? "auto" : lang;

  const pipeline = tier === "FREE" ? FREE_PIPELINE : PREMIUM_PIPELINE;

  logger.info(`[transcribe] Starting provider pipeline, pipeline has ${pipeline.length} providers`);
  for (const provider of pipeline) {
    if (isAuto && provider.skipOnAuto) {
      logger.info(`[transcribe] Skipping ${provider.name} (skipOnAuto)`);
      continue;
    }

    if (!isAuto && !provider.supportedLanguages.has(effectiveLang)) {
      logger.info(`[transcribe] Skipping ${provider.name} (unsupported language: ${effectiveLang})`);
      continue;
    }

    try {
      if (signal.aborted) throw new Error(CLIENT_ABORTED);
      logger.info(`[transcribe] Trying ${provider.name}`, {
        lang: effectiveLang,
        tier,
        timeoutMs: provider.timeoutMs,
      });

      const timeoutCtrl = new AbortController();
      const timeoutId = setTimeout(() => timeoutCtrl.abort(), provider.timeoutMs);
      const onClientAbort = (): void => timeoutCtrl.abort();
      signal.addEventListener('abort', onClientAbort);

      let result: TranscribeResult | null = null;
      try {
        result = await provider.fn(audioBlob, effectiveLang, env, timeoutCtrl.signal);
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener('abort', onClientAbort);
      }
      if (result) {
        logger.info(`[transcribe] Success: ${provider.name}`, {
          lang: result.language,
          provider: result.provider,
        });

        try {
          await env.EKWE_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 30 * 24 * 60 * 60,
          });
        } catch (err) {
          logger.error(`[transcribe] KV cache write error`, {
            error: String(err),
          });
        }

        return Response.json(result);
      }
      logger.info(`[transcribe] ${provider.name} returned null (no result)`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === CLIENT_ABORTED) throw e;
      logger.error(`[transcribe] ${provider.name} threw`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.error(`[transcribe] ALL providers failed`);

  return Response.json({ error: "ALL_PROVIDERS_FAILED" }, { status: 503 });
}

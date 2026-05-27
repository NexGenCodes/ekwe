import { Env, Tier, TranscribeResult } from './types';
import { logger } from './logger';
import { guardAudioSize, guardAutoDetect, guardLanguageCode } from './security';
import * as witai from './providers/witai';
import * as groq from './providers/groq';
import * as deepgram from './providers/deepgram';
import * as cloudflare from './providers/cloudflare';
import * as gladia from './providers/gladia';
import * as assemblyai from './providers/assemblyai';

// ─── Provider Pipeline Definition ─────────────────────────────────

interface PipelineEntry {
  name: string;
  skipOnAuto: boolean;
  fn: (
    blob: Blob,
    lang: string,
    env: Env,
    signal: AbortSignal,
  ) => Promise<TranscribeResult | null>;
}

interface CFFormData {
  get(name: string): string | File | null;
}

// ♾️ FREE FOREVER — zero marginal cost, sustainable for all users
const FREE_PIPELINE: PipelineEntry[] = [
  { name: 'witai', skipOnAuto: true, fn: witai.transcribe },
  { name: 'gladia', skipOnAuto: false, fn: gladia.transcribe },
  { name: 'groq', skipOnAuto: false, fn: groq.transcribe },
  { name: 'cloudflare', skipOnAuto: false, fn: cloudflare.transcribe },
];

// 💰 PREMIUM — best quality first, paid providers before free fallbacks
const PREMIUM_PIPELINE: PipelineEntry[] = [
  { name: 'deepgram', skipOnAuto: false, fn: deepgram.transcribe },
  { name: 'gladia', skipOnAuto: false, fn: gladia.transcribe },
  { name: 'assemblyai', skipOnAuto: false, fn: assemblyai.transcribe },
  { name: 'witai', skipOnAuto: true, fn: witai.transcribe },
  { name: 'groq', skipOnAuto: false, fn: groq.transcribe },
  { name: 'cloudflare', skipOnAuto: false, fn: cloudflare.transcribe },
];

async function sha256Bytes(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Orchestrator ─────────────────────────────────────────────────

export async function handleTranscribe(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  const formData = (await request.formData()) as unknown as CFFormData;
  const file = formData.get('file') as File | null;
  const lang = formData.get('lang') as string | null;

  if (!file) return Response.json({ error: 'MISSING_FILE' }, { status: 400 });

  // ── Security Guards (centralized in security.ts) ──
  const sizeGuard = guardAudioSize(file.size, tier);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, 'lang');
  if (!langGuard.allowed) return langGuard.response;

  // ── KV Cache Lookup (Fail-Closed) ──
  let cacheKey: string;
  try {
    const audioBuffer = await file.arrayBuffer();
    const audioHash = await sha256Bytes(audioBuffer);
    cacheKey = `transcribe:${audioHash}:${lang || 'auto'}`;
    const cached = await env.EKWE_KV.get(cacheKey);
    if (cached) {
      logger.info(`[transcribe] KV Cache Hit for audio hash ${audioHash}`);
      const cachedResult = JSON.parse(cached) as TranscribeResult;
      return Response.json(cachedResult);
    }
  } catch (err) {
    logger.error(`[transcribe] KV cache lookup error (Failing closed)`, {
      error: String(err),
    });
    return Response.json(
      {
        error: 'EKWE_ALL_PROVIDERS_FAIL',
        message: 'Service temporarily unavailable. Please try again later.',
      },
      { status: 503 },
    );
  }

  // ── Magic Byte Sniffer for WhatsApp / Android Edge Cases ──
  // Always sniff the first 4 bytes. React Native often assigns 'audio/m4a'
  // as a fallback for content:// URIs that lack extensions, even when the file is an Opus Ogg.
  let mimeType = file.type;

  // Read only the first 4 bytes from the stream to avoid memory exhaustion
  const headerBuffer = await file.slice(0, 4).arrayBuffer();
  const headerView = new Uint8Array(headerBuffer);

  // ASCII for 'OggS' (Opus is encapsulated in Ogg containers)
  if (
    headerView[0] === 0x4f &&
    headerView[1] === 0x67 &&
    headerView[2] === 0x67 &&
    headerView[3] === 0x53
  ) {
    mimeType = 'audio/ogg';
  } else if (!mimeType || mimeType === 'application/octet-stream') {
    mimeType = 'audio/wav'; // ultimate fallback
  }

  // Wrap the original File stream into a new File object with the correct MIME type.
  // This COMPLETELY avoids loading the 25MB file into RAM via arrayBuffer().
  const audioBlob = new File([file], file.name || 'audio.wav', {
    type: mimeType,
  });
  const isAuto = !lang || lang === 'auto';
  const effectiveLang = isAuto ? 'auto' : lang;

  // CAPPED_PREMIUM silently falls to FREE pipeline
  const pipeline = tier === 'PREMIUM' ? PREMIUM_PIPELINE : FREE_PIPELINE;

  for (const provider of pipeline) {
    if (isAuto && provider.skipOnAuto) continue;

    try {
      if (signal.aborted) throw new Error('CLIENT_ABORTED');
      logger.info(`[transcribe] Trying ${provider.name}`, {
        lang: effectiveLang,
        tier,
      });

      const result = await provider.fn(audioBlob, effectiveLang, env, signal);
      if (result) {
        logger.info(`[transcribe] Success: ${provider.name}`, {
          lang: result.language,
          provider: result.provider,
        });

        // Write to cache (Fail-Closed for security - if write fails, block return)
        try {
          await env.EKWE_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 30 * 24 * 60 * 60,
          }); // 30 days
        } catch (err) {
          logger.error(`[transcribe] KV cache write error (Failing closed)`, {
            error: String(err),
          });
          return Response.json(
            {
              error: 'EKWE_ALL_PROVIDERS_FAIL',
              message:
                'Service temporarily unavailable. Please try again later.',
            },
            { status: 503 },
          );
        }

        return Response.json(result);
      }
    } catch (e: unknown) {
      if (e instanceof Error && e.message === 'CLIENT_ABORTED') throw e;
      logger.error(`[transcribe] ${provider.name} failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({ error: 'ALL_PROVIDERS_FAILED' }, { status: 503 });
}

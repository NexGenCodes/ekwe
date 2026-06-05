import { logger } from "./logger";
import * as assemblyai from "./providers/assemblyai";
import * as cloudflare from "./providers/cloudflare";
import * as deepgram from "./providers/deepgram";
import * as gladia from "./providers/gladia";
import * as groq from "./providers/groq";
import * as witai from "./providers/witai";
import { guardAudioSize, guardAutoDetect, guardLanguageCode, getLimits } from "./security";
import { Env, Tier, TranscribeResult } from "./types";

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
  { name: "witai", skipOnAuto: true, fn: witai.transcribe },
  { name: "cloudflare", skipOnAuto: false, fn: cloudflare.transcribe },
  { name: "gladia", skipOnAuto: false, fn: gladia.transcribe },
  { name: "groq", skipOnAuto: false, fn: groq.transcribe },
];

// 💰 PREMIUM — best quality first, paid providers before free fallbacks
const PREMIUM_PIPELINE: PipelineEntry[] = [
  { name: "deepgram", skipOnAuto: false, fn: deepgram.transcribe },
  { name: "gladia", skipOnAuto: false, fn: gladia.transcribe },
  { name: "assemblyai", skipOnAuto: false, fn: assemblyai.transcribe },
  { name: "witai", skipOnAuto: true, fn: witai.transcribe },
  { name: "groq", skipOnAuto: false, fn: groq.transcribe },
  { name: "cloudflare", skipOnAuto: false, fn: cloudflare.transcribe },
];

interface StreamPipelineEntry {
  name: string;
  skipOnAuto: boolean;
  handleStream: (env: Env, lang: string, clientWs: WebSocket, signal: AbortSignal) => Promise<boolean>;
}

// 🚀 STREAMING — providers that support streaming, in order of preference
// Each handleStream(env, lang, clientWs, signal) → Promise<boolean>
// Returns true if it handled the session, false to fall through to next provider
const STREAMING_PIPELINE: StreamPipelineEntry[] = [
  { name: 'witai', skipOnAuto: true, handleStream: witai.handleStream },
  { name: 'deepgram', skipOnAuto: false, handleStream: deepgram.handleStream },
  { name: 'assemblyai', skipOnAuto: false, handleStream: assemblyai.handleStream },
  { name: 'gladia', skipOnAuto: false, handleStream: gladia.handleStream },
];

async function sha256Bytes(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── Orchestrator ─────────────────────────────────────────────────

export async function handleTranscribe(
  request: Request,
  env: Env,
  tier: Tier,
  signal: AbortSignal,
): Promise<Response> {
  logger.info(`[transcribe] handleTranscribe started`, { tier });

  let formData: CFFormData;
  try {
    formData = (await request.formData()) as unknown as CFFormData;
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

  // ── Security Guards (centralized in security.ts) ──
  const sizeGuard = guardAudioSize(file.size, tier);
  if (!sizeGuard.allowed) return sizeGuard.response;

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, "lang");
  if (!langGuard.allowed) return langGuard.response;

  // ── Read file data once, use for everything ──
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

  // ── KV Cache Lookup (Fail-Closed) ──
  let cacheKey: string;
  try {
    const audioHash = await sha256Bytes(audioBuffer);
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

  // CAPPED_PREMIUM silently falls to FREE pipeline
  const pipeline = tier === "PREMIUM" ? PREMIUM_PIPELINE : FREE_PIPELINE;

  logger.info(`[transcribe] Starting provider pipeline, pipeline has ${pipeline.length} providers`);
  for (const provider of pipeline) {
    if (isAuto && provider.skipOnAuto) {
      logger.info(`[transcribe] Skipping ${provider.name} (skipOnAuto)`);
      continue;
    }

    try {
      if (signal.aborted) throw new Error("CLIENT_ABORTED");
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

        // Write to cache (best-effort — fail-open so the user still gets their result)
        try {
          await env.EKWE_KV.put(cacheKey, JSON.stringify(result), {
            expirationTtl: 30 * 24 * 60 * 60,
          }); // 30 days
        } catch (err) {
          logger.error(`[transcribe] KV cache write error`, {
            error: String(err),
          });
        }

        return Response.json(result);
      }
      logger.info(`[transcribe] ${provider.name} returned null (no result)`);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "CLIENT_ABORTED") throw e;
      logger.error(`[transcribe] ${provider.name} threw`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  logger.error(`[transcribe] ALL providers failed`);

  return Response.json({ error: "ALL_PROVIDERS_FAILED" }, { status: 503 });
}

// ─── Streaming Transcription ────────────────────────────────────

const activeStreams = new Map<string, number>();
const MAX_CONCURRENT_STREAMS = 3;
const IDLE_TIMEOUT_MS = 30_000;

export async function handleStream(
  request: Request,
  env: Env,
  userId: string,
  tier: Tier,
): Promise<Response> {
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  if (tier === 'FREE') {
    return new Response(
      JSON.stringify({ error: 'STREAM_PRO_ONLY', message: 'Live transcription is a Pro feature.' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') || 'en';

  // Defense-in-depth: same auto-detect check as batch
  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, 'lang');
  if (!langGuard.allowed) return langGuard.response;

  // Concurrent connection limit per user
  const current = activeStreams.get(userId) ?? 0;
  if (current >= MAX_CONCURRENT_STREAMS) {
    return new Response(
      JSON.stringify({
        error: 'TOO_MANY_CONNECTIONS',
        message: `Max ${MAX_CONCURRENT_STREAMS} concurrent stream(s) per user.`,
      }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }
  activeStreams.set(userId, current + 1);

  const [client, server] = Object.values(new WebSocketPair());

  server.accept();

  try {
    const signal = new AbortController().signal;
    const maxAudioBytes = getLimits(tier).maxAudioBytes;
    let cumulativeBytes = 0;
    let limitExceeded = false;

    // Idle timeout: close if no audio received within 30s
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logger.info('[stream] Idle timeout', { userId });
        try { server.close(); } catch { /* ignore */ }
      }, IDLE_TIMEOUT_MS);
    };
    resetIdle();

    // Enforce tier audio size limit — close connection if exceeded.
    server.addEventListener('message', (event: MessageEvent) => {
      if (limitExceeded) return;
      const isAudio = event.data instanceof ArrayBuffer || event.data instanceof Blob;
      if (isAudio) {
        resetIdle();
        cumulativeBytes += event.data instanceof ArrayBuffer
          ? event.data.byteLength
          : event.data.size;
      }
      if (cumulativeBytes > maxAudioBytes) {
        limitExceeded = true;
        if (idleTimer) clearTimeout(idleTimer);
        server.send(JSON.stringify({
          error: 'FILE_TOO_LARGE',
          message: `Audio exceeds ${Math.round(maxAudioBytes / 1024 / 1024)}MB limit.`,
        }));
        server.close();
      }
    });

    server.addEventListener('close', () => {
      if (idleTimer) clearTimeout(idleTimer);
      const count = activeStreams.get(userId) ?? 1;
      if (count <= 1) {
        activeStreams.delete(userId);
      } else {
        activeStreams.set(userId, count - 1);
      }
    });

    let providerFound = false;

    for (const entry of STREAMING_PIPELINE) {
      if (entry.skipOnAuto && lang === 'auto') {
        logger.info('[stream] Skipping provider (auto-detect unsupported)', { name: entry.name });
        continue;
      }
      logger.info('[stream] Trying provider', { name: entry.name, userId });
      try {
        const handled = await entry.handleStream(env, lang, server, signal);
        if (handled) {
          providerFound = true;
          logger.info('[stream] Provider handling session', { name: entry.name, userId });
          break;
        }
      } catch (err) {
        logger.error('[stream] Provider threw', { name: entry.name, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      logger.warn('[stream] Provider unavailable, skipping', { name: entry.name });
    }

    if (!providerFound) {
      server.send(JSON.stringify({
        error: 'NO_PROVIDER_AVAILABLE',
        message: 'No transcription provider could be reached.',
      }));
      server.close();
    }
  } catch (err) {
    logger.error('[stream] Internal error', { error: err instanceof Error ? err.message : String(err) });
    try {
      server.send(JSON.stringify({ error: 'STREAM_INTERNAL_ERROR', message: 'Internal server error.' }));
    } catch { /* client may already be gone */ }
    try { server.close(); } catch { /* ignore */ }
  }

  return new Response(null, { status: 101, webSocket: client });
}

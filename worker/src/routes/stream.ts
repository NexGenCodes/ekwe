import { logger } from "../logger";
import * as assemblyai from "../providers/assemblyai";
import * as deepgram from "../providers/deepgram";
import * as gladia from "../providers/gladia";
import * as witai from "../providers/witai";
import { STREAM_STT_LANGUAGES } from "../languages";
import { getStreamingProviderNames } from "../config";
import { getLimits } from "../config";
import { guardAutoDetect, guardLanguageCode, guardStreamingAllowed } from "../security";
import { Env, Tier } from "../types";

// WebSocket close codes
const WS_CLOSE = {
  NORMAL: 1000,
  TIER_BLOCKED: 4001,
  IDLE_TIMEOUT: 4002,
  NO_PROVIDER: 4004,
  DURATION_EXCEEDED: 4005,
} as const;

interface StreamPipelineEntry {
  name: string;
  skipOnAuto: boolean;
  supportedLanguages: ReadonlySet<string>;
  handleStream: (env: Env, lang: string, clientWs: WebSocket, signal: AbortSignal) => Promise<boolean>;
}

const STREAMING_PROVIDER_MODULES: Record<string, { supportedLanguages: ReadonlySet<string>; handleStream: StreamPipelineEntry['handleStream'] }> = {
  deepgram:   { supportedLanguages: STREAM_STT_LANGUAGES.deepgram,   handleStream: deepgram.handleStream },
  witai:      { supportedLanguages: STREAM_STT_LANGUAGES.witai,      handleStream: witai.handleStream },
  assemblyai: { supportedLanguages: STREAM_STT_LANGUAGES.assemblyai, handleStream: assemblyai.handleStream },
  gladia:     { supportedLanguages: STREAM_STT_LANGUAGES.gladia,     handleStream: gladia.handleStream },
};

const STREAMING_SKIP_AUTO: Record<string, boolean> = {
  deepgram:   false,
  witai:      true,
  assemblyai: false,
  gladia:     false,
};

const STREAMING_PIPELINE: StreamPipelineEntry[] = getStreamingProviderNames().map((name) => ({
  name,
  skipOnAuto: STREAMING_SKIP_AUTO[name] ?? false,
  supportedLanguages: STREAMING_PROVIDER_MODULES[name]?.supportedLanguages ?? new Set(),
  handleStream: STREAMING_PROVIDER_MODULES[name]?.handleStream ?? (async () => false),
}));

const activeStreams = new Map<string, number>();
const MAX_CONCURRENT_STREAMS = 3;
const IDLE_TIMEOUT_MS = 60_000;
const PING_INTERVAL_MS = 15_000;
const CONFIG_NEGOTIATION_TIMEOUT_MS = 5_000;

interface StreamSession {
  startTime: number;
  cumulativeBytes: number;
  limitExceeded: boolean;
  configReceived: boolean;
}

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

  // Gate streaming access by tier
  const streamingGuard = guardStreamingAllowed(tier);
  if (!streamingGuard.allowed) {
    return streamingGuard.response;
  }

  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') || 'en';

  const autoGuard = guardAutoDetect(lang, tier);
  if (!autoGuard.allowed) return autoGuard.response;

  const langGuard = guardLanguageCode(lang, 'lang');
  if (!langGuard.allowed) return langGuard.response;

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

  const session: StreamSession = {
    startTime: Date.now(),
    cumulativeBytes: 0,
    limitExceeded: false,
    configReceived: false,
  };

  try {
    const abortController = new AbortController();
    const signal = abortController.signal;
    const limits = getLimits(tier);
    const maxAudioBytes = limits.maxAudioBytes;
    const maxDurationMs = limits.maxStreamDurationMs;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const clearTimers = (): void => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
      if (pingTimer) { clearInterval(pingTimer); pingTimer = undefined; }
    };

    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logger.info('[stream] Idle timeout', { userId });
        clearTimers();
        try { server.close(WS_CLOSE.IDLE_TIMEOUT, 'Idle timeout'); } catch { /* ignore */ }
      }, IDLE_TIMEOUT_MS);
    };
    resetIdle();

    // Ping keepalive
    pingTimer = setInterval(() => {
      try { server.send(JSON.stringify({ type: 'ping' })); } catch { clearTimers(); }
    }, PING_INTERVAL_MS);

    // Send config negotiation request
    setTimeout(() => {
      if (!session.configReceived) {
        server.send(JSON.stringify({
          type: 'config_request',
          codec: 'opus',
          sampleRate: 16000,
          frameSizeMs: 20,
        }));
      }
    }, CONFIG_NEGOTIATION_TIMEOUT_MS);

    server.addEventListener('message', (event: MessageEvent) => {
      if (session.limitExceeded) return;

      // Handle config negotiation
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'config' && msg.codec === 'opus') {
            session.configReceived = true;
            server.send(JSON.stringify({ type: 'config_ack', status: 'ready' }));
            return;
          }
          if (msg.type === 'pong') return;
        } catch { /* not JSON, treat as data */ }
      }

      const isAudio = event.data instanceof ArrayBuffer || event.data instanceof Blob;
      if (isAudio) {
        resetIdle();
        session.cumulativeBytes += event.data instanceof ArrayBuffer
          ? event.data.byteLength
          : event.data.size;

        // Check duration limit
        const elapsedMs = Date.now() - session.startTime;
        if (maxDurationMs > 0 && elapsedMs > maxDurationMs) {
          session.limitExceeded = true;
          clearTimers();
          server.send(JSON.stringify({
            error: 'STREAM_DURATION_EXCEEDED',
            message: `Stream duration limit of ${Math.round(maxDurationMs / 1000)} seconds exceeded.`,
          }));
          try { server.close(WS_CLOSE.DURATION_EXCEEDED, 'Duration exceeded'); } catch { /* ignore */ }
          return;
        }

        // Check size limit
        if (session.cumulativeBytes > maxAudioBytes) {
          session.limitExceeded = true;
          clearTimers();
          server.send(JSON.stringify({
            error: 'FILE_TOO_LARGE',
            message: `Audio exceeds ${Math.round(maxAudioBytes / 1024 / 1024)}MB limit.`,
          }));
          try { server.close(WS_CLOSE.NORMAL, 'File too large'); } catch { /* ignore */ }
        }
      }
    });

    server.addEventListener('close', () => {
      clearTimers();
      abortController.abort();
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
      if (lang !== 'auto' && !entry.supportedLanguages.has(lang)) {
        logger.info('[stream] Skipping provider (unsupported language)', { name: entry.name, lang });
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
      try { server.close(WS_CLOSE.NO_PROVIDER, 'No provider'); } catch { /* ignore */ }
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

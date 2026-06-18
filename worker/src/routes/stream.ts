import { logger } from "../logger";
import * as assemblyai from "../providers/assemblyai";
import * as deepgram from "../providers/deepgram";
import * as gladia from "../providers/gladia";
import * as witai from "../providers/witai";
import { STREAM_STT_LANGUAGES } from "../languages";
import { getStreamingProviderNames } from "../config";
import { getLimits } from "../config";
import { guardAutoDetect, guardLanguageCode } from "../security";
import { Env, Tier } from "../types";

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

  try {
    const signal = new AbortController().signal;
    const maxAudioBytes = getLimits(tier).maxAudioBytes;
    let cumulativeBytes = 0;
    let limitExceeded = false;

    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        logger.info('[stream] Idle timeout', { userId });
        try { server.close(); } catch { /* ignore */ }
      }, IDLE_TIMEOUT_MS);
    };
    resetIdle();

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

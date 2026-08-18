import { Env } from "../core/types";
import { logger } from "../core/logger";
import { decodeOpusFrame, isOpusDecoderReady } from "./opus";
import { pcmToWav } from "./wav";
import { mergePcmFrames } from "./pcm";

export async function rotateWsKeys(
  env: Env,
  prefix: string,
  buildUrl: (key: string) => string,
): Promise<WebSocket | null> {
  const keys = Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => {
      const v = env[k];
      return typeof v === "string" ? v.replace(/[^\x20-\x7E]/g, "").trim() : "";
    })
    .filter((k) => k.length > 10);

  if (keys.length === 0) return null;

  const arr = new Uint32Array(keys.length);
  crypto.getRandomValues(arr);
  const shuffled = keys
    .map((k, i) => ({ k, r: arr[i] }))
    .sort((a, b) => a.r - b.r)
    .map(({ k }) => k);

  for (const key of shuffled) {
    const url = buildUrl(key);
    const ws = await connectWithTimeout(url);
    if (ws) return ws;
  }

  return null;
}

/**
 * Normalizes a WebSocket client message to raw bytes (ArrayBuffer/Blob),
 * or null for string/other payloads.
 */
export async function clientMessageToBytes(
  event: MessageEvent,
): Promise<Uint8Array | null> {
  if (event.data instanceof ArrayBuffer) return new Uint8Array(event.data);
  if (event.data instanceof Blob) {
    return new Uint8Array(await event.data.arrayBuffer());
  }
  return null;
}

/**
 * Shared client↔provider WebSocket relay: forwards client bytes to the
 * provider, relays provider messages back via `onProviderMessage`, and closes
 * both sockets when either side closes or the client sends {"type":"stop"}.
 *
 * `handleClientBytes` lets a caller transform the stream (e.g. decode Opus to
 * PCM) before it reaches the provider; `flush` runs when either side closes so
 * buffered transforms can drain. The cleanup function removes all listeners
 * and closes both sockets.
 */
function createInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
  hooks: { handleClientBytes?: (data: Uint8Array) => void; flush?: () => void } = {},
): () => void {
  const { handleClientBytes, flush } = hooks;
  let isClosed = false;

  function closeBoth(): void {
    if (isClosed) return;
    isClosed = true;
    try {
      clientWs.close();
    } catch {
      /* ignore */
    }
    try {
      providerWs.close();
    } catch {
      /* ignore */
    }
  }

  const onClientMessage = (event: MessageEvent): void => {
    handleClientMessage(event);
  };

  const forwardBytes = (data: Uint8Array): void => {
    if (handleClientBytes) {
      handleClientBytes(data);
    } else {
      providerWs.send(data.buffer as ArrayBuffer);
    }
  };

  const handleClientMessage = (event: MessageEvent): void => {
    if (isClosed) return;
    try {
      if (event.data instanceof Blob) {
        // Blob reads are async — defer the forward to the microtask.
        void clientMessageToBytes(event).then((data) => {
          if (!data || isClosed) return;
          forwardBytes(data);
        });
      } else if (event.data instanceof ArrayBuffer) {
        forwardBytes(new Uint8Array(event.data));
      } else if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "stop") closeBoth();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };

  const drain = (): void => {
    if (flush) flush();
  };
  const onClientClose = (): void => {
    drain();
    closeBoth();
  };
  const onClientError = (): void => closeBoth();

  const onProviderMessageEvent = (event: MessageEvent): void => {
    if (isClosed) return;
    if (typeof event.data === "string") {
      try {
        onProviderMessage(event.data);
      } catch (err) {
        logger.error("[stream] Interceptor processing error", {
          error: String(err),
        });
      }
    }
  };

  const onProviderClose = (): void => {
    drain();
    closeBoth();
  };
  const onProviderError = (): void => closeBoth();

  clientWs.addEventListener("message", onClientMessage);
  clientWs.addEventListener("close", onClientClose);
  clientWs.addEventListener("error", onClientError);

  providerWs.addEventListener("message", onProviderMessageEvent);
  providerWs.addEventListener("close", onProviderClose);
  providerWs.addEventListener("error", onProviderError);

  return () => {
    drain();
    clientWs.removeEventListener("message", onClientMessage);
    clientWs.removeEventListener("close", onClientClose);
    clientWs.removeEventListener("error", onClientError);

    providerWs.removeEventListener("message", onProviderMessageEvent);
    providerWs.removeEventListener("close", onProviderClose);
    providerWs.removeEventListener("error", onProviderError);

    closeBoth();
  };
}

/**
 * Stream interceptor that decodes Opus frames to PCM before forwarding.
 * For providers that accept PCM-only (AssemblyAI) or PCM+WAV (Gladia, Wit.ai).
 * If the Opus decoder is not ready, falls back to forwarding raw data.
 */
export function createOpusDecodingInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
  wrapInWav: boolean = false,
  sampleRate: number = 16000,
): () => void {
  let pcmBuffer: Int16Array[] = [];

  const flushPcm = (): void => {
    if (pcmBuffer.length === 0) return;

    const merged = mergePcmFrames(pcmBuffer);
    pcmBuffer = [];

    if (wrapInWav) {
      const wav = pcmToWav(merged, sampleRate);
      providerWs.send(wav.buffer as ArrayBuffer);
    } else {
      providerWs.send(merged.buffer as ArrayBuffer);
    }
  };

  return createInterceptor(clientWs, providerWs, onProviderMessage, {
    handleClientBytes: (data) => {
      if (isOpusDecoderReady()) {
        const pcm = decodeOpusFrame(data, sampleRate);
        if (pcm) {
          pcmBuffer.push(pcm);

          // Flush buffer periodically (every 10 frames)
          if (pcmBuffer.length >= 10) {
            flushPcm();
          }
        }
      } else {
        // Fallback: forward raw data
        providerWs.send(data);
      }
    },
    flush: flushPcm,
  });
}

export function connectWithTimeout(
  url: string,
  protocols?: string | string[],
): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (result: WebSocket | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (ws) {
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
      }
      resolve(result);
    };
    const onOpen = (): void => cleanup(ws);
    const onError = (): void => cleanup(null);

    try {
      ws = new WebSocket(url, protocols);
      timer = setTimeout(() => {
        if (ws && ws.readyState !== WebSocket.OPEN) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          cleanup(null);
        }
      }, 5000);
      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onError);
    } catch {
      cleanup(null);
    }
  });
}

/** Forwards client bytes verbatim to the provider (Deepgram, Gladia). */
export function createStreamInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
): () => void {
  return createInterceptor(clientWs, providerWs, onProviderMessage);
}

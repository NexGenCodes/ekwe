import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { withTimeout } from "@/utils/timeout";
import { decodeOpusFrame, isOpusDecoderReady } from "@/utils/opus";
import { pcmToWav } from "@/utils/wav";
import { mergePcmFrames } from "@/utils/pcm";

const WS_OPEN_TIMEOUT_MS = 5_000;

export async function openWebSocket(
  url: string,
  protocols?: string | string[],
): Promise<WebSocket | null> {
  let ws: WebSocket | null = null;
  return withTimeout(
    WS_OPEN_TIMEOUT_MS,
    "websocket open",
    new AbortController().signal,
    () =>
      new Promise<WebSocket | null>((resolve) => {
        try {
          ws = new WebSocket(url, protocols);
        } catch {
          resolve(null);
          return;
        }
        ws.addEventListener("open", () => resolve(ws));
        ws.addEventListener("error", () => resolve(null));
        ws.addEventListener("close", () => resolve(null));
      }),
  ).catch(() => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    return null;
  });
}

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
    const ws = await openWebSocket(url);
    if (ws) return ws;
  }

  return null;
}

export async function clientMessageToBytes(
  event: MessageEvent,
): Promise<Uint8Array | null> {
  if (event.data instanceof ArrayBuffer) return new Uint8Array(event.data);
  if (event.data instanceof Blob) {
    return new Uint8Array(await event.data.arrayBuffer());
  }
  return null;
}

function createInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
  hooks: {
    handleClientBytes?: (data: Uint8Array) => void;
    flush?: () => void;
    signal?: AbortSignal;
  } = {},
): () => void {
  const { handleClientBytes, flush, signal } = hooks;
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

  function abortProviderOnly(): void {
    if (isClosed) return;
    isClosed = true;
    drain();
    clientWs.removeEventListener("message", onClientMessage);
    clientWs.removeEventListener("close", onClientClose);
    clientWs.removeEventListener("error", onClientError);
    providerWs.removeEventListener("message", onProviderMessageEvent);
    providerWs.removeEventListener("close", onProviderClose);
    providerWs.removeEventListener("error", onProviderError);
    try {
      providerWs.close();
    } catch {
      /* ignore */
    }
  }

  if (signal) {
    if (signal.aborted) {
      abortProviderOnly();
    } else {
      signal.addEventListener("abort", abortProviderOnly, { once: true });
    }
  }

  return () => {
    drain();
    clientWs.removeEventListener("message", onClientMessage);
    clientWs.removeEventListener("close", onClientClose);
    clientWs.removeEventListener("error", onClientError);

    providerWs.removeEventListener("message", onProviderMessageEvent);
    providerWs.removeEventListener("close", onProviderClose);
    providerWs.removeEventListener("error", onProviderError);

    if (signal) {
      signal.removeEventListener("abort", abortProviderOnly);
    }
    closeBoth();
  };
}

export function createOpusDecodingInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
  wrapInWav: boolean = false,
  sampleRate: number = 16000,
  signal?: AbortSignal,
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

          if (pcmBuffer.length >= 10) {
            flushPcm();
          }
        }
      } else {
        providerWs.send(data);
      }
    },
    flush: flushPcm,
    signal,
  });
}

export function createStreamInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
  signal?: AbortSignal,
): () => void {
  return createInterceptor(clientWs, providerWs, onProviderMessage, {
    signal,
  });
}

import { Env } from "../types";
import { logger } from "../logger";
import { decodeOpusFrame, isOpusDecoderReady } from "./opus";
import { pcmToWav } from "./wav";
import { mergePcmFrames } from "./pcm";

export function getFirstKey(env: Env, prefix: string): string | null {
  for (let i = 1; i <= 10; i++) {
    const key = env[`${prefix}${i}`] as string | undefined;
    if (key && typeof key === "string") return key;
  }
  return null;
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
    const ws = await connectWithTimeout(url);
    if (ws) return ws;
  }

  return null;
}

/**
 * Creates a stream interceptor that decodes Opus frames to PCM before forwarding.
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

  const onClientMessage = async (event: MessageEvent): Promise<void> => {
    if (isClosed) return;
    try {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        let data: Uint8Array;
        if (event.data instanceof ArrayBuffer) {
          data = new Uint8Array(event.data);
        } else {
          data = new Uint8Array(await event.data.arrayBuffer());
        }

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
      } else if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "stop") closeBoth();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };

  function flushPcm(): void {
    if (pcmBuffer.length === 0) return;

    const merged = mergePcmFrames(pcmBuffer);
    pcmBuffer = [];

    if (wrapInWav) {
      const wav = pcmToWav(merged, sampleRate);
      providerWs.send(wav.buffer as ArrayBuffer);
    } else {
      providerWs.send(merged.buffer as ArrayBuffer);
    }
  }

  const onClientClose = (): void => {
    flushPcm();
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
    flushPcm();
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
    flushPcm();
    clientWs.removeEventListener("message", onClientMessage);
    clientWs.removeEventListener("close", onClientClose);
    clientWs.removeEventListener("error", onClientError);

    providerWs.removeEventListener("message", onProviderMessageEvent);
    providerWs.removeEventListener("close", onProviderClose);
    providerWs.removeEventListener("error", onProviderError);

    closeBoth();
  };
}

export function connectWithTimeout(
  url: string,
  protocols?: string | string[],
): Promise<WebSocket | null> {
  return new Promise((resolve) => {
    try {
      const ws = new WebSocket(url, protocols);
      const timer = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          resolve(null);
        }
      }, 5000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        resolve(null);
      });
    } catch {
      resolve(null);
    }
  });
}

export function createStreamInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
): () => void {
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
    if (isClosed) return;
    try {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        providerWs.send(event.data);
      } else if (typeof event.data === "string") {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "stop") closeBoth();
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };

  const onClientClose = (): void => closeBoth();
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

  const onProviderClose = (): void => closeBoth();
  const onProviderError = (): void => closeBoth();

  clientWs.addEventListener("message", onClientMessage);
  clientWs.addEventListener("close", onClientClose);
  clientWs.addEventListener("error", onClientError);

  providerWs.addEventListener("message", onProviderMessageEvent);
  providerWs.addEventListener("close", onProviderClose);
  providerWs.addEventListener("error", onProviderError);

  return () => {
    clientWs.removeEventListener("message", onClientMessage);
    clientWs.removeEventListener("close", onClientClose);
    clientWs.removeEventListener("error", onClientError);

    providerWs.removeEventListener("message", onProviderMessageEvent);
    providerWs.removeEventListener("close", onProviderClose);
    providerWs.removeEventListener("error", onProviderError);

    closeBoth();
  };
}

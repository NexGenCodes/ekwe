import { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { withTimeout } from "@/utils/timeout";
import { providerKeys } from "@/utils/keys";

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
  for (const key of providerKeys(env, prefix)) {
    const ws = await openWebSocket(buildUrl(key));
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
    onProviderGone?: (reason: "close" | "error") => void;
  } = {},
): () => void {
  const { handleClientBytes, flush, signal, onProviderGone } = hooks;
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
      return;
    }
    // A view can be a window onto a larger buffer: only the window is audio.
    const wholeBuffer =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
    providerWs.send(
      (wholeBuffer ? data.buffer : data.slice().buffer) as ArrayBuffer,
    );
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
      } else if (ArrayBuffer.isView(event.data)) {
        // A client adapter replays held frames as views, not buffers.
        forwardBytes(
          new Uint8Array(
            event.data.buffer,
            event.data.byteOffset,
            event.data.byteLength,
          ),
        );
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

  /** Detaches only the provider; the client socket stays open for failover. */
  const detachProvider = (): void => {
    clientWs.removeEventListener("message", onClientMessage);
    clientWs.removeEventListener("close", onClientClose);
    clientWs.removeEventListener("error", onClientError);
    providerWs.removeEventListener("message", onProviderMessageEvent);
    providerWs.removeEventListener("close", onProviderClose);
    providerWs.removeEventListener("error", onProviderError);
    signal?.removeEventListener("abort", abortProviderOnly);
  };

  const onProviderClose = (): void => {
    drain();
    detachProvider();
    onProviderGone?.("close");
  };
  const onProviderError = (): void => {
    detachProvider();
    onProviderGone?.("error");
  };

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

/**
 * Pumps client audio to the provider and provider events back, both plain PCM16.
 * `headerPrefix` is sent once per session; per flush it would concatenate.
 */
export function createStreamInterceptor(
  clientWs: WebSocket,
  providerWs: WebSocket,
  onProviderMessage: (data: string) => void,
  options: {
    signal?: AbortSignal;
    headerPrefix?: Uint8Array;
    onProviderGone?: (reason: "close" | "error") => void;
  } = {},
): () => void {
  const { signal, headerPrefix, onProviderGone } = options;
  let headerSent = false;

  const sendAudio = (data: Uint8Array): void => {
    if (headerPrefix && !headerSent) {
      headerSent = true;
      providerWs.send(headerPrefix.buffer as ArrayBuffer);
    }
    // A view can be a window onto a larger buffer: only the window is audio.
    const wholeBuffer =
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength;
    providerWs.send(
      (wholeBuffer ? data.buffer : data.slice().buffer) as ArrayBuffer,
    );
  };

  return createInterceptor(clientWs, providerWs, onProviderMessage, {
    handleClientBytes: sendAudio,
    signal,
    // The client end may be a buffering adapter rather than a real socket.
    onProviderGone:
      onProviderGone ??
      (clientWs as { onProviderGone?: (r: "close" | "error") => void })
        .onProviderGone,
  });
}

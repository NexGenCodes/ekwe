import { Env } from "../types";
import { logger } from "../logger";

export function getFirstKey(env: Env, prefix: string): string | null {
  for (let i = 1; i <= 10; i++) {
    const key = env[`${prefix}${i}`] as string | undefined;
    if (key && typeof key === 'string') return key;
  }
  return null;
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
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve(ws);
      });
      ws.addEventListener('error', () => {
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
    try { clientWs.close(); } catch { /* ignore */ }
    try { providerWs.close(); } catch { /* ignore */ }
  }

  const onClientMessage = (event: MessageEvent): void => {
    if (isClosed) return;
    try {
      if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
        providerWs.send(event.data);
      } else if (typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'stop') closeBoth();
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  };

  const onClientClose = (): void => closeBoth();
  const onClientError = (): void => closeBoth();

  const onProviderMessageEvent = (event: MessageEvent): void => {
    if (isClosed) return;
    if (typeof event.data === 'string') {
      try {
        onProviderMessage(event.data);
      } catch (err) {
        logger.error('[stream] Interceptor processing error', { error: String(err) });
      }
    }
  };

  const onProviderClose = (): void => closeBoth();
  const onProviderError = (): void => closeBoth();

  clientWs.addEventListener('message', onClientMessage);
  clientWs.addEventListener('close', onClientClose);
  clientWs.addEventListener('error', onClientError);

  providerWs.addEventListener('message', onProviderMessageEvent);
  providerWs.addEventListener('close', onProviderClose);
  providerWs.addEventListener('error', onProviderError);

  return () => {
    clientWs.removeEventListener('message', onClientMessage);
    clientWs.removeEventListener('close', onClientClose);
    clientWs.removeEventListener('error', onClientError);

    providerWs.removeEventListener('message', onProviderMessageEvent);
    providerWs.removeEventListener('close', onProviderClose);
    providerWs.removeEventListener('error', onProviderError);

    closeBoth();
  };
}

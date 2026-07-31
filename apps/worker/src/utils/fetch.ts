import { CLIENT_ABORTED } from "../types";
import { getRandomInt } from "./keys";

export const TIMEOUT_FAST = 15_000;
export const TIMEOUT_SLOW = 25_000;

export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  clientSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onClientAbort = (): void => controller.abort();
  if (clientSignal) {
    if (clientSignal.aborted) {
      controller.abort();
    } else {
      clientSignal.addEventListener("abort", onClientAbort);
    }
  }

  try {
    return await fetch(url.toString(), { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (clientSignal) clientSignal.removeEventListener("abort", onClientAbort);
  }
}

/**
 * Like fetchWithTimeout, but the timeout is an inactivity timeout rather than
 * a total wall-clock one: it aborts only when no bytes flow (neither headers
 * nor body chunks) for `idleTimeoutMs`. Long-lived streaming sessions (e.g.
 * live dictation) keep running as long as data keeps arriving.
 */
export async function fetchWithIdleTimeout(
  url: string | URL,
  init: RequestInit,
  idleTimeoutMs: number,
  clientSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const onClientAbort = (): void => controller.abort();
  if (clientSignal) {
    if (clientSignal.aborted) {
      controller.abort();
    } else {
      clientSignal.addEventListener("abort", onClientAbort);
    }
  }

  const armIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleTimeoutMs);
  };
  const disarmIdle = (): void => {
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const cleanup = (): void => {
    disarmIdle();
    if (clientSignal) clientSignal.removeEventListener("abort", onClientAbort);
  };

  try {
    armIdle();
    const res = await fetch(url.toString(), { ...init, signal: controller.signal });
    disarmIdle();

    if (!res.body) {
      cleanup();
      return res;
    }

    const reader = res.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        armIdle();
        try {
          const { done, value } = await reader.read();
          disarmIdle();
          if (done) {
            cleanup();
            streamController.close();
            return;
          }
          streamController.enqueue(value);
        } catch (err) {
          cleanup();
          streamController.error(err);
        }
      },
      cancel() {
        cleanup();
        reader.cancel().catch(() => {});
      },
    });

    return new Response(stream, {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  } catch (err) {
    cleanup();
    throw err;
  }
}

export async function abortableDelay(
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new Error(CLIENT_ABORTED);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error(CLIENT_ABORTED));
    };
    signal.addEventListener("abort", onAbort);
  });
}

export function getUserAgent(): string {
  const randomUserAgents = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  ];
  return randomUserAgents[getRandomInt(randomUserAgents.length)];
}

export function getClientHeaders(request?: Request): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept-Language": "en-US,en;q=0.9",
  };

  if (request) {
    const forwardedFor = request.headers.get("X-Forwarded-For");
    const realIp = request.headers.get("X-Real-IP");
    if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;
    if (realIp) headers["X-Real-IP"] = realIp;
  }

  return headers;
}

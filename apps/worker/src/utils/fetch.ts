import { CLIENT_ABORTED } from "../core/types";
import { logger } from "../core/logger";

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
    const res = await fetch(url.toString(), {
      ...init,
      signal: controller.signal,
    });
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

// Neutral, honest UA. Impersonating real iPhone/Android browser UAs to third
// party providers risks ToS violations and bulk key bans; a descriptive UA is
// sufficient and defensible.
const USER_AGENT =
  "Ekwe/1.0 (voice-translation-app; https://ekwe.app; Android/iOS)";

export function getUserAgent(): string {
  return USER_AGENT;
}

export function getClientHeaders(): Record<string, string> {
  return {
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/** Reads a failed response's body as a short string, never throwing. */
export async function readErrorBody(
  res: Response | null | undefined,
): Promise<string> {
  if (!res) return "No response";
  const text = await res.text().catch(() => "No body");
  return text || "No body";
}

/**
 * Logs a provider's failed HTTP response (status + body) and returns the
 * body text. Standardizes the read-and-log block each provider used to
 * inline. `res` is optional because some callers hit non-response failures.
 */
export async function logProviderError(
  label: string,
  res: Response | null | undefined,
): Promise<string> {
  const body = await readErrorBody(res);
  logger.error(`[${label}] HTTP error`, { status: res?.status, body });
  return body;
}

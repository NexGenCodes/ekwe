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

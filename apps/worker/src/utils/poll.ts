import { fetchWithTimeout, TIMEOUT_FAST, abortableDelay } from "@/utils/fetch";

export interface PollOptions<T> {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  parse: (data: unknown) => T | null;
  isError?: (data: unknown) => Response | null;
  onPoll?: (attempt: number, data: unknown) => void;
  intervalMs?: number;
  maxPolls?: number;
  timeoutMs?: number;
}

export interface PollResult<T> {
  ok: boolean;
  value?: T;
  response?: Response;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 4;

export async function pollUntilReady<T>(
  options: PollOptions<T>,
): Promise<PollResult<T>> {
  const {
    url,
    headers,
    signal,
    parse,
    isError,
    onPoll,
    intervalMs = DEFAULT_INTERVAL_MS,
    maxPolls = DEFAULT_MAX_POLLS,
    timeoutMs = TIMEOUT_FAST,
  } = options;

  for (let i = 0; i < maxPolls; i++) {
    // Providers that return an already-finished job answer on the first poll,
    // so waiting before the first request only adds latency to the common case.
    if (i > 0) {
      await abortableDelay(intervalMs, signal);
    }

    const poll = await fetchWithTimeout(
      url,
      { headers, signal },
      timeoutMs,
      signal,
    );
    const data = await poll.json();

    if (isError) {
      const errorResponse = isError(data);
      if (errorResponse) return { ok: false, response: errorResponse };
    }

    if (onPoll) onPoll(i + 1, data);

    const value = parse(data);
    if (value !== null) return { ok: true, value };
  }

  return { ok: false, response: new Response(null, { status: 504 }) };
}

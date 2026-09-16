import { fetchWithTimeout, TIMEOUT_FAST, abortableDelay } from "./fetch";

export interface PollOptions<T> {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  /**
   * Called with each polled body. Return a value to stop polling and mark the
   * job done; return `null` to keep waiting for the next poll.
   */
  parse: (data: unknown) => T | null;
  /**
   * Optional terminal-error detector. Returned `Response` (e.g. a 5xx) aborts
   * polling immediately and is surfaced in the result.
   */
  isError?: (data: unknown) => Response | null;
  /** Optional per-poll hook (e.g. progress logging). */
  onPoll?: (attempt: number, data: unknown) => void;
  intervalMs?: number;
  maxPolls?: number;
  timeoutMs?: number;
}

export interface PollResult<T> {
  ok: boolean;
  value?: T;
  /** Terminal response when `ok` is false (provider error or timeout). */
  response?: Response;
}

const DEFAULT_INTERVAL_MS = 2000;
const DEFAULT_MAX_POLLS = 4;

/**
 * Shared async job-poll loop for providers that expose an
 * "upload → submit job → poll until done" API (AssemblyAI, Gladia).
 *
 * Polls `url` every `intervalMs` up to `maxPolls` times, honoring the client
 * `signal`. Returns the parsed value as soon as `parse` resolves it, surfaces
 * a terminal error via `isError`, and falls back to a 504 timeout response.
 */
export async function pollForJobResult<T>(
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
    await abortableDelay(intervalMs, signal);

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

/**
 * Lightweight client-side span timing for perceived-latency work.
 *
 * Distinct from the cold-start markers in `app/_layout.tsx`, which are anchored
 * to `appStartTime`. A span measures an interaction the user is waiting on, so
 * it reports both the total and the per-step breakdown.
 *
 * Dev-only: these are diagnostics, and a convert is a rare enough event that
 * one line per span is not worth production log volume.
 */
import logger from "@/utils/logger";

export interface Span {
  /** Record a step boundary. `label` is logged with its delta from the last mark. */
  mark(label: string): void;
  /** Log and return the total elapsed ms. Safe to call more than once. */
  end(note?: string): number;
}

export function startSpan(name: string): Span {
  const t0 = Date.now();
  let last = t0;
  let ended = false;

  return {
    mark(label: string): void {
      const now = Date.now();
      logger.info(`[Perf] ${name} · ${label}: +${now - last}ms`);
      last = now;
    },
    end(note?: string): number {
      const now = Date.now();
      if (!ended) {
        ended = true;
        logger.info(`[Perf] ${name}: ${now - t0}ms${note ? ` (${note})` : ""}`);
      }
      return now - t0;
    },
  };
}

/**
 * Parse a `Server-Timing` response header into `{ name: ms }`.
 *
 * Lets the client log the server-side breakdown next to its own numbers, which
 * is how you tell a slow network apart from a slow provider.
 */
export function parseServerTiming(
  header: string | null,
): Record<string, number> {
  if (!header) return {};
  const out: Record<string, number> = {};
  for (const part of header.split(",")) {
    const segments = part.split(";");
    const name = segments[0]?.trim();
    if (!name) continue;
    for (const seg of segments.slice(1)) {
      const [key, value] = seg.split("=").map((s) => s.trim());
      if (key === "dur" && value !== undefined) {
        const ms = Number(value);
        if (Number.isFinite(ms)) out[name] = ms;
      }
    }
  }
  return out;
}

/**
 * Case-insensitive header lookup.
 *
 * `expo-file-system` lowercases response header names, but the shape is not
 * guaranteed across platforms, so callers should not assume either casing.
 */
export function headerValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) return null;
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return null;
}

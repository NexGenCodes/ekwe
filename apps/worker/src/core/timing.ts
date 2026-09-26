/**
 * Per-request stage timings surfaced as a `Server-Timing` response header.
 *
 * This exists to make the synth/convert pipeline observable: without it there
 * is no way to tell whether a slow request was spent in auth, quota gating, a
 * cache miss, or the actual AI calls.
 *
 * Emission is gated on `APP_ENV !== "production"` because the stage names
 * describe our internal pipeline shape. Production latency is already captured
 * by `recordRequestEvent` into Analytics Engine, so nothing is lost by keeping
 * the header out of production responses.
 */
export class RequestTimings {
  private readonly started = new Map<string, number>();
  private readonly durations = new Map<string, number>();

  /** Mark the start of a named stage. Unpaired starts are ignored. */
  start(name: string): void {
    if (!this.started.has(name)) this.started.set(name, Date.now());
  }

  /** Mark a named stage complete, accumulating its duration. */
  end(name: string): void {
    const from = this.started.get(name);
    if (from === undefined) return;
    this.started.delete(name);
    this.durations.set(
      name,
      (this.durations.get(name) ?? 0) + (Date.now() - from),
    );
  }

  /** Time an async stage, recording it even if the stage throws. */
  async measure<T>(name: string, fn: () => Promise<T>): Promise<T> {
    this.start(name);
    try {
      return await fn();
    } finally {
      this.end(name);
    }
  }

  /**
   * Serialize as `Server-Timing`. Returns `null` when nothing was recorded so
   * callers can skip touching headers entirely.
   */
  toServerTiming(totalMs: number): string | null {
    if (this.durations.size === 0) return null;
    const parts: string[] = [`total;dur=${round(totalMs)}`];
    // Stable ordering keeps the header diffable between runs.
    for (const name of [...this.durations.keys()].sort()) {
      parts.push(`${name};dur=${round(this.durations.get(name) ?? 0)}`);
    }
    return parts.join(", ");
  }

  /** Structured copy, for structured logs. */
  toJSON(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, ms] of this.durations) out[name] = round(ms);
    return out;
  }
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

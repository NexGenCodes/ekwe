import { DurableObject } from "cloudflare:workers";
import { Env } from "../core/types";

interface WindowCounter {
  count: number;
  resetAt: number;
}

/**
 * Strongly-consistent per-key throttle counter for OTP sends.
 *
 * Replaces the KV fixed-window counter that used to live in routes/otp.ts.
 * KV had two documented failure modes for this job:
 *   - no atomic increment: two concurrent requests both read the same count
 *     and both pass, so the limit could be exceeded under parallel load;
 *   - a 1-write-per-second cap per key: a spammer's burst 429s the counter
 *     writes, so the count stops accumulating and the throttle silently never
 *     trips — exactly when it is needed most.
 * Durable Object storage is single-writer and strongly consistent: events are
 * processed one at a time, so each allow() call atomically increments the
 * current fixed-window count.
 *
 * Window rollover is tracked with a stored `resetAt` timestamp rather than a
 * storage TTL: workerd silently ignores `expirationTtl` in put options, so a
 * TTL would leave every bucket key behind forever. A periodic sweep bounds
 * storage to keys actually touched recently.
 *
 * One instance is used for all OTP throttling (getByName("otp")); the per-IP /
 * per-email counts are separate storage keys inside it.
 */
export class ThrottleBucket extends DurableObject<Env> {
  private static readonly PRUNE_INTERVAL_MS = 60_000;
  private static readonly PREFIX = "otp:throttle:";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    const limit = Number(url.searchParams.get("limit") ?? "0");
    const windowSec = Number(url.searchParams.get("windowSec") ?? "0");
    if (
      !key ||
      !Number.isInteger(limit) ||
      limit <= 0 ||
      !Number.isInteger(windowSec) ||
      windowSec <= 0
    ) {
      // Malformed params: allow rather than throttle (the caller treats a
      // failed check the same way — fail open, mirroring the old KV guard).
      return Response.json({ allowed: true }, { status: 400 });
    }
    const allowed = await this.allow(key, limit, windowSec);
    return Response.json({ allowed });
  }

  private async allow(
    key: string,
    limit: number,
    windowSec: number,
  ): Promise<boolean> {
    await this.prune();
    const storageKey = `${ThrottleBucket.PREFIX}${key}`;
    const now = Date.now();
    const raw = await this.ctx.storage.get<WindowCounter>(storageKey);
    if (!raw || now >= raw.resetAt) {
      await this.ctx.storage.put(storageKey, {
        count: 1,
        resetAt: now + windowSec * 1000,
      });
      return true;
    }
    if (raw.count >= limit) return false;
    await this.ctx.storage.put(storageKey, {
      count: raw.count + 1,
      resetAt: raw.resetAt,
    });
    return true;
  }

  /**
   * Delete window counters whose window has fully elapsed. Runs at most once
   * per minute, so storage stays bounded by keys touched in the last window
   * rather than every key ever seen (workerd ignores put `expirationTtl`).
   */
  private async prune(): Promise<void> {
    const now = Date.now();
    const lastPrune =
      (await this.ctx.storage.get<number>("otp:throttle:prune")) ?? 0;
    if (now - lastPrune < ThrottleBucket.PRUNE_INTERVAL_MS) return;
    const entries = await this.ctx.storage.list<WindowCounter>({
      prefix: ThrottleBucket.PREFIX,
    });
    const stale: string[] = [];
    for (const [key, value] of entries) {
      if (value.resetAt < now) stale.push(key);
    }
    if (stale.length > 0) await this.ctx.storage.delete(stale);
    await this.ctx.storage.put("otp:throttle:prune", now);
  }
}

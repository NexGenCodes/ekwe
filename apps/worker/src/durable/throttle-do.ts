import { DurableObject } from "cloudflare:workers";
import { Env } from "@/core/types";

interface WindowCounter {
  count: number;
  resetAt: number;
}

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
      return Response.json({ allowed: false }, { status: 400 });
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
    return this.ctx.blockConcurrencyWhile(async () => {
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
    });
  }

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

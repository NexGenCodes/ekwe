/**
 * CloudSync — mirrors the server's history into the local database.
 *
 * Pull pages ascend on `(updated_at, id)` and include tombstones, so a deletion
 * on another device reaches this one. The cursor is opaque and stored per user
 * and tier; a tier change uses a different cursor, which forces a fresh pull so
 * rows the narrower window had pruned come back.
 */

import { batch, observable } from "@legendapp/state";

import { historyLocalTtlDays } from "@/constants/retention";
import { apiJson } from "@/services/backend";
import { Db } from "@/services/db";
import { history$ } from "@/store";
import { mmkv as storage } from "@/services/mmkv";
import logger from "@/utils/logger";

import { MAX_HISTORY_CACHE } from "./shared";
import {
  syncPullResponseSchema,
  wireRowToEntry,
  wireRowToLocal,
} from "./wireRows";

const DAY_MS = 24 * 60 * 60 * 1000;
const PULL_TIMEOUT_MS = 20_000;

export class CloudSync {
  pullError = observable<string | null>(null);
  private inflight: { userId: string; promise: Promise<void> } | null = null;

  private cursorKey(userId: string, isPro: boolean): string {
    return `sync.cursor.${userId}.${isPro ? "pro" : "free"}`;
  }

  pullFromCloud(userId: string, isPro: boolean): Promise<void> {
    if (this.inflight?.userId === userId) return this.inflight.promise;
    const promise = this.runPull(userId, isPro).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { userId, promise };
    return promise;
  }

  private async runPull(userId: string, isPro: boolean): Promise<void> {
    try {
      this.pullError.set(null);

      const key = this.cursorKey(userId, isPro);
      let cursor = storage.getString(key) ?? null;
      const cutoffMs = Date.now() - historyLocalTtlDays(isPro) * DAY_MS;
      let applied = 0;

      for (;;) {
        const raw = await apiJson("/sync/pull", {
          method: "POST",
          body: cursor ? { cursor } : {},
          timeoutMs: PULL_TIMEOUT_MS,
        });
        const page = syncPullResponseSchema.parse(raw);

        this.applyPage(userId, page.rows, cutoffMs);
        applied += page.rows.length;

        if (page.nextCursor) {
          cursor = page.nextCursor;
          storage.set(key, cursor);
        }
        if (!page.hasMore) break;
      }

      if (applied > 0) {
        this.trimHistoryWindow();
        logger.info("[Sync] Pulled", applied, "row(s)");
      }
    } catch (err) {
      this.pullError.set(err instanceof Error ? err.message : String(err));
      logger.error("[Sync] pullFromCloud failed", err);
    }
  }

  clearSyncCursor(userId: string): void {
    storage.remove(this.cursorKey(userId, false));
    storage.remove(this.cursorKey(userId, true));
  }

  private applyPage(
    userId: string,
    rows: ReturnType<typeof syncPullResponseSchema.parse>["rows"],
    cutoffMs: number,
  ): void {
    batch(() => {
      for (const row of rows) {
        // A local write that has not been acknowledged yet is the newer truth.
        if (Db.isHistoryDirty(row.id)) continue;

        if (row.deletedAt != null) {
          Db.insertHistory(wireRowToLocal(row, userId));
          history$[row.id].delete();
          continue;
        }

        if (row.createdAt < cutoffMs) continue;

        Db.insertHistory(wireRowToLocal(row, userId));
        history$[row.id].set(wireRowToEntry(row));
      }
    });
  }

  private trimHistoryWindow(): void {
    const allKeys = Object.keys(history$.get() || {});
    if (allKeys.length <= MAX_HISTORY_CACHE) return;

    const sorted = allKeys
      .map((key) => ({ key, ts: history$[key].timestamp.get() || 0 }))
      .sort((a, b) => b.ts - a.ts);
    for (const { key } of sorted.slice(MAX_HISTORY_CACHE)) {
      history$[key].delete();
    }
  }
}

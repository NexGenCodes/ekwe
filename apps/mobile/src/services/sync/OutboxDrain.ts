/**
 * OutboxDrain — pushes queued local writes to the worker.
 *
 * Each outbox payload is the full wire row, so a delete is just a row with
 * `deletedAt` set and an Undo is the same row with `restore: true` and the
 * tombstone's revision. Push batches are chunked by both the row cap and the
 * body cap, and chunks are spaced past the server's push cooldown.
 */

import * as Crypto from "expo-crypto";

import { observable } from "@legendapp/state";

import { ApiError, apiJson } from "@/services/backend";
import { Db } from "@/services/db";
import { parseOutboxRow, serializeOutboxRow } from "@/services/outboxPayload";
import { auth$, history$ } from "@/store";
import { SYNC_PUSH_ROWS_FREE, MAX_HISTORY_BATCH_BYTES } from "@ekwe/shared";
import logger from "@/utils/logger";
import { checkIsOnline } from "@/utils/connectivity";

import {
  DRAIN_BASE_DELAY_MS,
  DRAIN_MAX_BACKOFF_MS,
  DRAIN_TIMEOUT_MS,
  PUSH_BODY_HEADROOM_BYTES,
  PUSH_CHUNK_GAP_MS,
  PUSH_RATE_LIMIT_BACKOFF_MS,
  PUSH_RATE_LIMIT_RETRIES,
} from "./shared";
import {
  syncPushResponseSchema,
  wireRowToEntry,
  wireRowToLocal,
  type SyncedRow,
  type SyncPushResponse,
  type SyncPushResult,
} from "./wireRows";
import type { HistoryRow as WireHistoryRow } from "@ekwe/shared";

interface QueuedRow {
  outboxId: string;
  row: WireHistoryRow;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** UTF-8 length, used to keep a push under the worker's body limit. */
function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      // Surrogate pair: one four-byte character.
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** Splits queued rows into requests the worker will accept. */
function chunkQueuedRows(
  items: QueuedRow[],
  maxRows: number,
  maxBytes: number,
): QueuedRow[][] {
  const chunks: QueuedRow[][] = [];
  let current: QueuedRow[] = [];
  let bytes = 0;

  for (const item of items) {
    const size = utf8ByteLength(JSON.stringify(item.row)) + 1;
    const full = current.length >= maxRows;
    const overBudget = current.length > 0 && bytes + size > maxBytes;

    if (current.length > 0 && (full || overBudget)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }

    current.push(item);
    bytes += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

export class OutboxDrain {
  private drainQueue: Promise<void> = Promise.resolve();
  private drainTimeout: NodeJS.Timeout | null = null;
  /** Consecutive drain failures; drives exponential backoff on scheduleDrain. */
  private drainConsecutiveFailures = 0;

  private pushRows: number | null = null;
  private pushBytes = MAX_HISTORY_BATCH_BYTES - PUSH_BODY_HEADROOM_BYTES;

  deadCount = observable(0);

  refreshDeadCount(): void {
    this.deadCount.set(Db.countDeadOutbox(auth$.user.get()?.id ?? ""));
  }

  retryDeadOutbox(): Promise<void> {
    const revived = Db.reviveDeadOutbox();
    if (revived > 0) {
      logger.info("[Sync] Retrying", revived, "dead outbox rows");
    }
    return this.drain().finally(() => this.refreshDeadCount());
  }

  scheduleDrain(): void {
    if (this.drainTimeout) clearTimeout(this.drainTimeout);
    const base =
      DRAIN_BASE_DELAY_MS *
      Math.pow(2, Math.min(this.drainConsecutiveFailures, 10));
    const capped = Math.min(base, DRAIN_MAX_BACKOFF_MS);
    const jitter = capped * (0.5 + Math.random() * 0.5);
    const wait = Math.round(jitter);

    this.drainTimeout = setTimeout(() => {
      this.drainTimeout = null;
      this.drain()
        .then(() => {
          this.drainConsecutiveFailures = 0;
        })
        .catch((err) => {
          this.drainConsecutiveFailures++;
          logger.error("[Sync] Scheduled drain failed", err);
        });
    }, wait);
  }

  drain(): Promise<void> {
    const next = this.drainQueue.then(
      () => this.runDrain(),
      () => this.runDrain(),
    );
    this.drainQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async runDrain(): Promise<void> {
    const userId = auth$.user.peek()?.id;
    if (!userId) return;
    if (!(await checkIsOnline())) return;

    const entries = Db.getPendingOutbox(userId);
    if (entries.length === 0) return;

    const queued: QueuedRow[] = [];
    for (const entry of entries) {
      Db.markOutboxInFlight(entry.id);
      const row = parseOutboxRow(entry.payload);
      if (!row) {
        logger.error("[Sync] Invalid outbox payload", entry.id);
        Db.incrementOutboxRetry(entry.id);
        continue;
      }
      queued.push({ outboxId: entry.id, row });
    }

    try {
      if (queued.length > 0) {
        const limits = await this.pushLimits();
        const chunks = chunkQueuedRows(queued, limits.maxRows, limits.maxBytes);

        for (let index = 0; index < chunks.length; index++) {
          if (index > 0) await delay(PUSH_CHUNK_GAP_MS);
          await this.pushChunk(chunks[index], userId);
        }
      }
    } finally {
      this.refreshDeadCount();
    }

    const remaining = Db.getPendingOutbox(userId);
    if (remaining.length > 0) {
      logger.info("[Sync] Outbox still queued after drain:", remaining.length);
    }
  }

  private async pushChunk(chunk: QueuedRow[], userId: string): Promise<void> {
    const rows = chunk.map((item) => item.row);
    let attempt = 0;

    for (;;) {
      try {
        const raw = await apiJson("/sync/push", {
          method: "POST",
          body: { rows },
          timeoutMs: DRAIN_TIMEOUT_MS,
          retries: 1,
        });
        this.applyResults(chunk, syncPushResponseSchema.parse(raw), userId);
        return;
      } catch (err) {
        if (
          err instanceof ApiError &&
          err.status === 429 &&
          attempt < PUSH_RATE_LIMIT_RETRIES
        ) {
          attempt++;
          await delay(PUSH_RATE_LIMIT_BACKOFF_MS);
          continue;
        }

        for (const item of chunk) Db.incrementOutboxRetry(item.outboxId);
        logger.error("[Sync] Push chunk failed", err);
        return;
      }
    }
  }

  private applyResults(
    chunk: QueuedRow[],
    response: SyncPushResponse,
    userId: string,
  ): void {
    const byId = new Map(response.results.map((result) => [result.id, result]));

    for (const item of chunk) {
      const result = byId.get(item.row.id);
      if (!result) {
        Db.incrementOutboxRetry(item.outboxId);
        logger.warn("[Sync] No push result for", item.row.id);
        continue;
      }

      switch (result.status) {
        case "ok":
          if (typeof result.revision === "number") {
            Db.setHistoryRevision(item.row.id, result.revision);
          }
          Db.deleteOutbox(item.outboxId);
          break;

        case "deleted":
          Db.applyRemoteDeletion(
            item.row.id,
            result.revision ?? item.row.revision,
          );
          history$[item.row.id].delete();
          Db.deleteOutbox(item.outboxId);
          break;

        case "conflict":
          if (item.row.deletedAt != null) {
            this.requeueDelete(item, result, userId);
          } else if (result.row) {
            this.adoptServerRow(result.row, userId);
          } else if (typeof result.revision === "number") {
            Db.setHistoryRevision(item.row.id, result.revision);
          }
          Db.deleteOutbox(item.outboxId);
          break;

        case "not_found":
          logger.warn("[Sync] Server has no row for", item.row.id);
          Db.deleteOutbox(item.outboxId);
          break;
      }
    }
  }

  /**
   * A delete whose base revision was stale is re-queued against the revision
   * the server just reported. If the revision did not move, the server's copy
   * wins so a conflicting delete cannot loop.
   */
  private requeueDelete(
    item: QueuedRow,
    result: SyncPushResult,
    userId: string,
  ): void {
    const revision = result.revision ?? result.row?.revision;
    if (typeof revision !== "number" || revision === item.row.revision) {
      if (result.row) this.adoptServerRow(result.row, userId);
      return;
    }

    Db.setHistoryRevision(item.row.id, revision);
    Db.insertOutbox({
      id: Crypto.randomUUID(),
      payload: serializeOutboxRow({
        ...item.row,
        revision,
        deletedAt: item.row.deletedAt ?? Date.now(),
        restore: false,
      }),
      userId,
      createdAt: new Date().toISOString(),
    });
  }

  /** Adopts the server's row when a local push is refused as stale. */
  private adoptServerRow(row: SyncedRow, userId: string): void {
    Db.insertHistory(wireRowToLocal(row, userId));
    if (row.deletedAt != null) {
      history$[row.id].delete();
    } else {
      history$[row.id].set(wireRowToEntry(row));
    }
  }

  /**
   * Row and byte caps for a push. The worker publishes both on `/config`, so a
   * paid worker is not chunked at the Free row cap.
   */
  private async pushLimits(): Promise<{ maxRows: number; maxBytes: number }> {
    if (this.pushRows === null) {
      try {
        const config = await apiJson<{
          syncPushRows?: unknown;
          maxHistoryBatchBytes?: unknown;
        }>("/config", { auth: false, retries: 1, timeoutMs: 10_000 });

        if (
          typeof config.syncPushRows === "number" &&
          Number.isInteger(config.syncPushRows) &&
          config.syncPushRows > 0
        ) {
          this.pushRows = config.syncPushRows;
        }
        if (
          typeof config.maxHistoryBatchBytes === "number" &&
          config.maxHistoryBatchBytes > PUSH_BODY_HEADROOM_BYTES
        ) {
          this.pushBytes =
            config.maxHistoryBatchBytes - PUSH_BODY_HEADROOM_BYTES;
        }
      } catch (err) {
        logger.warn(
          "[Sync] /config unavailable; using default push limits",
          err,
        );
      }
    }

    return {
      maxRows: this.pushRows ?? SYNC_PUSH_ROWS_FREE,
      maxBytes: this.pushBytes,
    };
  }
}

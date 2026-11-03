/**
 * HistoryPush — pushes dirty local rows to the worker.
 *
 * The row itself is the queue entry: every local mutation sets `dirty`, and a
 * successful push clears it. There is no second table to keep in sync.
 */

import { ApiError, apiJson } from "@/services/backend";
import { Db } from "@/services/db";
import { auth$, history$ } from "@/store";
import { SYNC_PUSH_ROWS_FREE, MAX_HISTORY_BATCH_BYTES } from "@ekwe/shared";
import logger from "@/utils/logger";
import { checkIsOnline } from "@/utils/connectivity";

import {
  PUSH_DEBOUNCE_MS,
  PUSH_TIMEOUT_MS,
  PUSH_BODY_HEADROOM_BYTES,
  PUSH_CHUNK_GAP_MS,
  PUSH_RATE_LIMIT_BACKOFF_MS,
  PUSH_RATE_LIMIT_RETRIES,
} from "./shared";
import {
  localRowToWireRow,
  syncPushResponseSchema,
  wireRowToEntry,
  wireRowToLocal,
  type SyncedRow,
  type SyncPushResponse,
  type SyncPushResult,
} from "./wireRows";
import type { HistoryRow as WireHistoryRow } from "@ekwe/shared";

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
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function chunkRows(
  rows: WireHistoryRow[],
  maxRows: number,
  maxBytes: number,
): WireHistoryRow[][] {
  const chunks: WireHistoryRow[][] = [];
  let current: WireHistoryRow[] = [];
  let bytes = 0;

  for (const row of rows) {
    const size = utf8ByteLength(JSON.stringify(row)) + 1;
    const full = current.length >= maxRows;
    const overBudget = current.length > 0 && bytes + size > maxBytes;

    if (current.length > 0 && (full || overBudget)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }

    current.push(row);
    bytes += size;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}
export class HistoryPush {
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;

  private pushRows: number | null = null;
  private pushBytes = MAX_HISTORY_BATCH_BYTES - PUSH_BODY_HEADROOM_BYTES;

  schedulePush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.push().catch((err) =>
        logger.error("[Sync] Scheduled push failed", err),
      );
    }, PUSH_DEBOUNCE_MS);
  }

  push(): Promise<void> {
    const next = this.queue.then(
      () => this.runPush(),
      () => this.runPush(),
    );
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async runPush(): Promise<void> {
    const userId = auth$.user.peek()?.id;
    if (!userId) return;
    if (!(await checkIsOnline())) return;

    const rows = Db.getDirtyHistory(userId);
    if (rows.length === 0) return;

    const limits = await this.pushLimits();
    const chunks = chunkRows(
      rows.map(localRowToWireRow),
      limits.maxRows,
      limits.maxBytes,
    );

    for (let index = 0; index < chunks.length; index++) {
      if (index > 0) await delay(PUSH_CHUNK_GAP_MS);
      await this.pushChunk(chunks[index], userId);
    }
  }

  private async pushChunk(
    rows: WireHistoryRow[],
    userId: string,
  ): Promise<void> {
    let attempt = 0;

    for (;;) {
      try {
        const raw = await apiJson("/sync/push", {
          method: "POST",
          body: { rows },
          timeoutMs: PUSH_TIMEOUT_MS,
          retries: 1,
        });
        this.applyResults(rows, syncPushResponseSchema.parse(raw), userId);
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

        logger.error("[Sync] Push chunk failed", err);
        return;
      }
    }
  }

  private applyResults(
    rows: WireHistoryRow[],
    response: SyncPushResponse,
    userId: string,
  ): void {
    const byId = new Map(response.results.map((result) => [result.id, result]));

    for (const row of rows) {
      const result = byId.get(row.id);
      if (!result) {
        logger.warn("[Sync] No push result for", row.id);
        continue;
      }

      switch (result.status) {
        case "ok":
          Db.markHistoryClean(row.id, result.revision ?? row.revision);
          break;

        case "deleted":
          Db.applyRemoteDeletion(row.id, result.revision ?? row.revision);
          history$[row.id].delete();
          break;

        case "conflict":
          this.applyConflict(row, result, userId);
          break;

        case "not_found":
          if (row.deletedAt != null) {
            Db.applyRemoteDeletion(row.id, row.revision);
            history$[row.id].delete();
          } else {
            logger.warn("[Sync] Server has no row for", row.id);
          }
          break;
      }
    }
  }

  private applyConflict(
    row: WireHistoryRow,
    result: SyncPushResult,
    userId: string,
  ): void {
    const revision = result.revision ?? result.row?.revision;

    // A delete whose base revision is stale is retried against the newer
    // revision. If the revision did not move, the server's copy wins so a
    // conflicting delete cannot loop.
    if (row.deletedAt != null && typeof revision === "number") {
      if (revision !== row.revision) {
        Db.setHistoryRevision(row.id, revision);
        return;
      }
      if (result.row) {
        this.adoptServerRow(result.row, userId);
        return;
      }
      Db.markHistoryClean(row.id, revision);
      return;
    }

    if (result.row) {
      this.adoptServerRow(result.row, userId);
    } else if (typeof revision === "number") {
      Db.markHistoryClean(row.id, revision);
    }
  }

  private adoptServerRow(row: SyncedRow, userId: string): void {
    Db.insertHistory(wireRowToLocal(row, userId));
    if (row.deletedAt != null) {
      history$[row.id].delete();
    } else {
      history$[row.id].set(wireRowToEntry(row));
    }
  }

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

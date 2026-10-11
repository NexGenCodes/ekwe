/**
 * OutboxDrain — serialises outbox entries and pushes them to the cloud.
 *
 * Owns: scheduleDrain, drain, runDrain, retryDeadOutbox, refreshDeadCount.
 * Includes an exponential-backoff circuit breaker on `scheduleDrain`.
 */

import { observable } from "@legendapp/state";

import { Db, type OutboxRow } from "@/services/db";
import { buildDeleteOutboxPayload } from "@/services/outboxPayload";

import { historyOutboxPayloadSchema } from "@ekwe/shared";

import { supabase } from "@/services/supabase";
import { auth$, history$ } from "@/store";
import { logger } from "@/utils";
import { checkIsOnline } from "@/utils/connectivity";

import {
  type CloudRow,
  type HistoryUpsertResult,
  type HistoryDeleteResult,
  toError,
  DRAIN_TIMEOUT_MS,
  DRAIN_BASE_DELAY_MS,
  DRAIN_MAX_BACKOFF_MS,
} from "./shared";
import { cloudRowToEntry } from "@/services/historyMapper";

export class OutboxDrain {
  private drainQueue: Promise<void> = Promise.resolve();
  private drainTimeout: NodeJS.Timeout | null = null;
  /** Consecutive drain failures; drives exponential backoff on scheduleDrain. */
  private drainConsecutiveFailures = 0;

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
    const delay = Math.round(jitter);
    if (this.drainConsecutiveFailures > 0) {
      logger.info(
        `[Sync] Drain backoff: attempt ${this.drainConsecutiveFailures + 1}, delay ${delay}ms`,
      );
    }
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
    }, delay);
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
    let entries: OutboxRow[] = [];
    const attempted = new Set<string>();
    /** Track unparsed payloads to preserve them in the retry/dead-letter queue. */
    const unparsed = new Set<string>();
    /** Track entries successfully processed or definitively refused by the server. */
    const settled = new Set<string>();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DRAIN_TIMEOUT_MS);

    try {
      const userId = auth$.user.get()?.id;
      if (!userId) return;

      const online = await checkIsOnline();
      if (!online) return;

      entries = Db.getPendingOutbox(userId);
      if (entries.length === 0) return;

      logger.info(
        "[Sync] Draining",
        entries.length,
        "pending entries (batching)",
      );

      const toUpsert = [];
      const toDelete = [];
      const deleteAllIds: string[] = [];
      /** Target history id -> the outbox row ids that ask for it. */
      const deleteEntriesByTarget = new Map<string, string[]>();
      let deleteAll = false;

      for (const entry of entries) {
        Db.markOutboxInFlight(entry.id);
        try {
          const parsed = historyOutboxPayloadSchema.safeParse(
            JSON.parse(entry.payload),
          );
          if (!parsed.success) {
            throw new Error(
              `Invalid outbox payload: ${
                parsed.error.issues[0]?.message ?? "unknown validation error"
              }`,
            );
          }
          const payload = parsed.data;
          attempted.add(entry.id);
          if (payload.action === "delete_all") {
            deleteAll = true;
            deleteAllIds.push(entry.id);
          } else if (payload.action === "delete") {
            const targetId = payload.id || entry.id;
            toDelete.push({
              id: targetId,
              base_revision: payload.base_revision ?? null,
            });
            const existing = deleteEntriesByTarget.get(targetId);
            if (existing) existing.push(entry.id);
            else deleteEntriesByTarget.set(targetId, [entry.id]);
          } else {
            toUpsert.push({
              id: entry.id,
              user_id: entry.userId,
              type: payload.type,
              capture_id: payload.capture_id ?? null,
              origin: payload.origin ?? "echo",
              input: payload.input ?? "audio",
              source_lang: payload.source_lang,
              target_lang: payload.target_lang,
              transcript: payload.transcript,
              translation_text: payload.translation_text,
              transliteration_text: payload.transliteration_text,
              duration: payload.duration,
              source_app: payload.source_app ?? "",
              voice_id: payload.voice_id ?? null,
              stt_provider: payload.stt_provider ?? "",
              mt_provider: payload.mt_provider ?? null,
              created_at: payload.created_at,
              base_revision: payload.base_revision ?? null,
              restore: payload.restore ?? false,
            });
          }
        } catch (e) {
          logger.error("[Sync] Invalid payload in outbox", entry.id, e);
          unparsed.add(entry.id);
          Db.incrementOutboxRetry(entry.id);
        }
      }

      if (deleteAll) {
        const { data, error } = await supabase
          .rpc("history_delete_all")
          .abortSignal(controller.signal);
        if (error) throw toError(error);
        const wiped = typeof data === "number" ? data : 0;
        logger.info("[Sync] Tombstoned", wiped, "row(s) for delete_all");
        for (const id of deleteAllIds) settled.add(id);
      }

      if (toDelete.length > 0) {
        const { data, error } = await supabase
          .rpc("history_delete_if_fresh", { p_rows: toDelete })
          .abortSignal(controller.signal);
        if (error) throw toError(error);

        for (const result of (data ?? []) as HistoryDeleteResult[]) {
          for (const entryId of deleteEntriesByTarget.get(result.id) ?? []) {
            settled.add(entryId);
          }
          if (result.outcome === "conflict") {
            logger.warn(
              "[Sync] Refused stale delete for",
              result.id,
              "; retrying against the current revision",
            );
            this.requeueDelete(result.id, userId, result.revision);
          }
        }
      }

      if (toUpsert.length > 0) {
        const { data, error } = await supabase
          .rpc("history_upsert_if_fresh", { p_rows: toUpsert })
          .abortSignal(controller.signal);
        if (error) throw toError(error);

        const conflicts: string[] = [];
        const remotelyDeleted: string[] = [];
        for (const result of (data ?? []) as HistoryUpsertResult[]) {
          settled.add(result.id);

          if (result.outcome === "conflict") {
            if (result.server_row)
              this.adoptServerRow(result.server_row as CloudRow);
            conflicts.push(result.id);
            continue;
          }

          if (result.outcome === "deleted") {
            this.forgetDeletedRow(result.id);
            remotelyDeleted.push(result.id);
            continue;
          }

          if (typeof result.revision === "number") {
            Db.setHistoryRevision(result.id, result.revision);
          }
        }
        if (conflicts.length > 0) {
          logger.warn(
            "[Sync] Refused stale writes for",
            conflicts.length,
            "row(s); adopted the server copy:",
            conflicts,
          );
        }
        if (remotelyDeleted.length > 0) {
          logger.info(
            "[Sync] Dropped local copy of",
            remotelyDeleted.length,
            "row(s) deleted elsewhere:",
            remotelyDeleted,
          );
        }
      }

      for (const entry of entries) {
        if (unparsed.has(entry.id) || !settled.has(entry.id)) continue;
        Db.deleteOutbox(entry.id);
      }
      logger.info(
        "[Sync] Batch pushed",
        toUpsert.length,
        "upserts,",
        toDelete.length,
        "deletes.",
      );

      const remaining = Db.getPendingOutbox(userId).filter(
        (row) => !unparsed.has(row.id),
      );
      if (remaining.length > 0) {
        logger.info(
          "[Sync] Outbox still queued after drain:",
          remaining.map((row) => row.id),
        );
      }
    } catch (rawErr) {
      const err = toError(rawErr);
      const isTimeout = err.name === "AbortError";
      logger.error(
        isTimeout
          ? "[Sync] Batch drain timed out, reverting in-flight rows"
          : "[Sync] Batch drain failed",
        err,
      );
      for (const id of attempted) {
        Db.incrementOutboxRetry(id);
      }
    } finally {
      clearTimeout(timeoutId);
      this.refreshDeadCount();
    }
  }

  /** Removes a row reported as deleted by the authoritative server. */
  private forgetDeletedRow(id: string): void {
    Db.deleteHistory(id);
    Db.deleteOutboxForHistory(id);
    history$[id].delete();
  }

  /** Re-queues a stale delete request against the server's current revision. */
  private requeueDelete(
    id: string,
    userId: string,
    revision: number | null,
  ): void {
    Db.insertOutbox({
      id,
      payload: buildDeleteOutboxPayload(id, revision),
      userId,
      createdAt: new Date().toISOString(),
    });
  }

  /** Adopts the server's row data when a local push is refused as stale. */
  private adoptServerRow(row: CloudRow): void {
    const entry = cloudRowToEntry(row);
    const revision = row.revision ?? null;

    Db.insertHistory({
      id: row.id,
      userId: row.user_id,
      captureId: entry.captureId,
      origin: entry.origin,
      input: entry.input,
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      transcript: entry.transcript,
      translationText: entry.translation,
      transliterationText: entry.transliteration,
      duration: entry.duration,
      sourceApp: entry.sourceApp ?? "",
      voiceId: entry.voiceId,
      sttProvider: entry.sttProvider,
      mtProvider: entry.mtProvider,
      createdAt: row.created_at,
      entryType: entry.type ?? "transcription",
      revision: revision ?? 0,
    });

    history$[row.id].set(entry);
  }
}

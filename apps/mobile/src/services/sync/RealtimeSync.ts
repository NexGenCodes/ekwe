/**
 * RealtimeSync — manages the channel lifecycle and retries for realtime sync.
 */

import { supabase } from "@/services/supabase";
import {
  type RealtimeChannel,
  REALTIME_SUBSCRIBE_STATES,
} from "@supabase/supabase-js";
import { history$ } from "@/store";
import { Db } from "@/services/db";
import { cloudRowToEntry } from "@/services/historyMapper";
import { logger } from "@/utils";
import { addSentryBreadcrumb } from "@/utils/logger";
import { isDefinitelyOffline } from "@/utils/connectivity";

import {
  type CloudRow,
  isDeleteAllPayload,
  isDeletePayloadFor,
  REALTIME_RETRY_BASE_MS,
  REALTIME_RETRY_MAX_MS,
  REALTIME_MAX_RETRIES,
  REALTIME_RETRY_JITTER,
} from "./shared";

export class RealtimeSync {
  private realtimeChannel: RealtimeChannel | null = null;
  private realtimeRetryTimeout: ReturnType<typeof setTimeout> | null = null;
  private realtimeRetryAttempt = 0;
  private realtimeUserId: string | null = null;
  /** Tracks the current realtime connection generation to ignore stale callbacks. */
  private realtimeGeneration = 0;

  async startRealtimeListener(userId: string): Promise<void> {
    this.clearRealtimeRetry();
    this.realtimeRetryAttempt = 0;
    await this.joinRealtime(userId);
  }

  stopRealtimeListener(): void {
    this.clearRealtimeRetry();
    this.realtimeGeneration += 1;
    this.realtimeUserId = null;
    this.realtimeRetryAttempt = 0;
    void this.teardownRealtimeChannel();
  }

  private async joinRealtime(userId: string): Promise<void> {
    const generation = ++this.realtimeGeneration;

    this.realtimeUserId = userId;

    const detached = this.teardownRealtimeChannel();
    if (detached) await detached;
    if (!this.isCurrentRealtimeJoin(userId, generation)) return;

    const { data } = await supabase.auth.getSession();
    if (!this.isCurrentRealtimeJoin(userId, generation)) {
      logger.info("[Sync] Realtime join cancelled — signed out mid-handshake");
      return;
    }

    const token = data.session?.access_token;
    if (!token) {
      logger.info(
        "[Sync] Skipping realtime subscribe — no session yet for",
        userId,
      );
      return;
    }

    await supabase.realtime.setAuth(token);
    if (!this.isCurrentRealtimeJoin(userId, generation)) return;

    this.realtimeChannel = supabase
      .channel(`history:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "history",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as CloudRow;
          if (Db.hasPendingOutboxRow(userId, row.id)) return;
          if (row.deleted_at) return;

          const entry = cloudRowToEntry(row);
          Db.insertHistory({
            id: entry.id,
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
          });

          history$[row.id].set(entry);
          logger.info("[Sync] Realtime INSERT received", row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "history",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as CloudRow;
          if (Db.hasPendingOutboxRow(userId, row.id)) return;

          if (row.deleted_at) {
            Db.deleteHistory(row.id);
            history$[row.id].delete();
            logger.info("[Sync] Realtime tombstone received", row.id);
            return;
          }

          const entry = cloudRowToEntry(row);
          const existing = history$[row.id].get();
          history$[row.id].set({
            ...entry,
            origin: existing?.origin ?? entry.origin,
            captureId: existing?.captureId ?? entry.captureId,
            timestamp: existing?.timestamp ?? entry.timestamp,
          });

          Db.updateCaptureRow(row.id, {
            transcript: entry.transcript,
            translation_text: entry.translation,
            transliteration_text: entry.transliteration ?? null,
            duration: entry.duration,
            source_app: entry.sourceApp,
            voice_id: entry.voiceId,
            stt_provider: entry.sttProvider,
            mt_provider: entry.mtProvider,
            origin: entry.origin,
            input: entry.input,
          });
          logger.info("[Sync] Realtime UPDATE received", row.id);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "history",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const oldRow = payload.old as { id?: string };
          if (!oldRow.id) return;
          const deletedId = oldRow.id;
          const pending = Db.getUnacknowledgedOutbox(userId);
          if (
            pending.some(
              (p) =>
                p.id === deletedId ||
                isDeleteAllPayload(p.payload) ||
                isDeletePayloadFor(p.payload, deletedId),
            )
          ) {
            return;
          }
          Db.deleteHistory(deletedId);
          history$[deletedId].delete();
          logger.info("[Sync] Realtime DELETE received", deletedId);
        },
      )
      .subscribe((status, err) => {
        if (generation !== this.realtimeGeneration) {
          logger.info(
            "[Sync] Ignoring status from superseded realtime channel:",
            status,
          );
          return;
        }
        logger.info("[Sync] Realtime subscription status:", status);
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          this.realtimeRetryAttempt = 0;
          this.clearRealtimeRetry();
          return;
        }
        if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
          status === REALTIME_SUBSCRIBE_STATES.CLOSED
        ) {
          // Expected on a mobile network, and handled below by a backed-off
          // resubscribe, so it must not be captured as an error. `logger.warn`
          // compiles out of release builds, so the breadcrumb is what keeps
          // this measurable in production.
          addSentryBreadcrumb("sync.realtime", "subscribe_failed", {
            status,
            reason: err instanceof Error ? err.message : String(err ?? ""),
          });
          logger.warn(
            "[Sync] Realtime subscribe failed, scheduling retry:",
            status,
            err instanceof Error ? err.message : String(err ?? ""),
          );
          this.scheduleRealtimeRetry();
        }
      });
  }

  private isCurrentRealtimeJoin(userId: string, generation: number): boolean {
    return (
      this.realtimeUserId === userId && this.realtimeGeneration === generation
    );
  }

  private teardownRealtimeChannel(): Promise<void> | null {
    const channel = this.realtimeChannel;
    this.realtimeChannel = null;
    if (!channel) return null;
    return Promise.resolve(supabase.removeChannel(channel)).catch((err) => {
      logger.warn("[Sync] removeChannel failed, continuing", err);
    }) as Promise<void>;
  }

  private clearRealtimeRetry(): void {
    if (this.realtimeRetryTimeout) {
      clearTimeout(this.realtimeRetryTimeout);
      this.realtimeRetryTimeout = null;
    }
  }

  private scheduleRealtimeRetry(): void {
    if (this.realtimeRetryTimeout) return;
    const userId = this.realtimeUserId;
    if (!userId) return;

    if (isDefinitelyOffline()) {
      logger.info(
        "[Sync] Offline — holding realtime retry until reconnect rather than spending the budget",
      );
      return;
    }

    this.realtimeRetryAttempt += 1;
    if (this.realtimeRetryAttempt > REALTIME_MAX_RETRIES) {
      logger.error(
        "[Sync] Realtime gave up after",
        REALTIME_MAX_RETRIES,
        "attempts — history will sync on next sign-in or pull",
      );
      return;
    }

    const base = Math.min(
      REALTIME_RETRY_BASE_MS * 2 ** (this.realtimeRetryAttempt - 1),
      REALTIME_RETRY_MAX_MS,
    );
    const delay = Math.round(
      base *
        (1 - REALTIME_RETRY_JITTER + Math.random() * REALTIME_RETRY_JITTER),
    );
    logger.info("[Sync] Retrying realtime subscribe in", delay, "ms");
    this.realtimeRetryTimeout = setTimeout(() => {
      this.realtimeRetryTimeout = null;
      if (this.realtimeUserId !== userId) return;
      this.joinRealtime(userId).catch((err) =>
        logger.error("[Sync] Realtime retry failed", err),
      );
    }, delay);
  }
}

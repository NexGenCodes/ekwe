/**
 * SyncOrchestrator — coordinates the Sync subsystem.
 */

import { auth$, history$ } from "@/store";
import { logger } from "@/utils";
import { subscribeToNetwork } from "@/utils/connectivity";
import { resetUserScopedState } from "@/store/resetUserScoped";
import { Db } from "@/services/db";
import { HISTORY_LOCAL_TTL_DAYS } from "@/constants/retention";
import type { Observable } from "@legendapp/state";

import { OutboxDrain } from "./OutboxDrain";
import { CloudSync } from "./CloudSync";
import { HistoryRepository } from "./HistoryRepository";
import { RealtimeSync } from "./RealtimeSync";
import { LOCAL_CLEANUP_INTERVAL_MS } from "./shared";

class SyncOrchestrator {
  public outbox = new OutboxDrain();
  public cloud = new CloudSync();
  public history = new HistoryRepository(() => this.outbox.scheduleDrain());
  public realtime = new RealtimeSync();

  private unsubscribeNetInfo: (() => void) | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private loadedUserId: string | null = null;

  // Expose observables directly for easy access

  get pullError(): Observable<string | null> {
    return this.cloud.pullError;
  }

  get deadCount(): Observable<number> {
    return this.outbox.deadCount;
  }

  // Forward CRUD methods for backward compatibility
  writeHistory = this.history.writeHistory.bind(this.history);
  deleteHistory = this.history.deleteHistory.bind(this.history);
  restoreHistory = this.history.restoreHistory.bind(this.history);
  purgeLocalHistory = this.history.purgeLocalHistory.bind(this.history);
  clearAllHistory = this.history.clearAllHistory.bind(this.history);
  clearSyncCursor = this.cloud.clearSyncCursor.bind(this.cloud);
  fetchOlderHistory = this.cloud.fetchOlderHistory.bind(this.cloud);
  pullFromCloud = this.cloud.pullFromCloud.bind(this.cloud);

  // Forward Drain methods
  drain = this.outbox.drain.bind(this.outbox);
  retryDeadOutbox = this.outbox.retryDeadOutbox.bind(this.outbox);

  // Observable initialization (internal)
  loadInitialHistory = this.history.loadInitialHistory.bind(this.history);

  async start(): Promise<void> {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    this.clearCleanupTimer();

    resetUserScopedState();
    this.runLocalCleanup();

    const currentUserId = auth$.user.get()?.id;
    this.loadedUserId = currentUserId ?? null;
    this.loadInitialHistory(currentUserId);

    const revived = Db.reviveInFlight();
    this.outbox.refreshDeadCount();
    if (revived > 0) {
      logger.info(
        "[Sync] Revived",
        revived,
        "in-flight outbox rows (crash recovery)",
      );
      this.outbox.scheduleDrain();
    }

    this.unsubscribeNetInfo = subscribeToNetwork((isOnline) => {
      if (!isOnline) return;
      this.outbox.scheduleDrain();
      const userId = this.loadedUserId;
      if (userId) {
        this.realtime
          .startRealtimeListener(userId)
          .catch((err) =>
            logger.error("[Sync] Realtime join after reconnect failed", err),
          );
      }
    });

    this.cleanupTimer = setInterval(() => {
      this.runLocalCleanup();
    }, LOCAL_CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    this.clearCleanupTimer();
    this.realtime.stopRealtimeListener();
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }

  onUserSignedIn(userId: string): void {
    if (this.loadedUserId && this.loadedUserId !== userId) {
      resetUserScopedState();
    }
    this.loadedUserId = userId;

    this.loadInitialHistory(userId);
    this.realtime
      .startRealtimeListener(userId)
      .catch((err) =>
        logger.error("[Sync] onUserSignedIn realtime subscribe failed", err),
      );
    this.cloud
      .pullFromCloud(userId)
      .catch((err) =>
        logger.error("[Sync] onUserSignedIn pullFromCloud failed", err),
      );
    this.outbox
      .drain()
      .catch((err) => logger.error("[Sync] onUserSignedIn drain failed", err));
  }

  onUserSignedOut(): void {
    this.loadedUserId = null;
    this.realtime.stopRealtimeListener();
    this.outbox.deadCount.set(0);
  }

  private clearCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private pruneObservableExpired(days: number): void {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const record = history$.get() || {};
    for (const key of Object.keys(record)) {
      if (record[key].timestamp < cutoff) {
        history$[key].delete();
      }
    }
  }

  private runLocalCleanup(): void {
    const userId = auth$.user.get()?.id;
    const expired = Db.cleanupExpiredHistory(HISTORY_LOCAL_TTL_DAYS, userId);
    if (expired > 0) {
      logger.info("[Sync] Cleaned up", expired, "expired local history rows");
      this.pruneObservableExpired(HISTORY_LOCAL_TTL_DAYS);
    }
  }
}

export const SyncService = new SyncOrchestrator();

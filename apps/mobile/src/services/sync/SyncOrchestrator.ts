/**
 * SyncOrchestrator — wires the local repository, pull and push together.
 *
 * There is no realtime channel: the app pulls on launch, on sign-in, on
 * reconnect and whenever it returns to the foreground, and pushes dirty rows
 * through the push service.
 */

import { AppState } from "react-native";
import type { Observable } from "@legendapp/state";
import { HISTORY_TOMBSTONES_RETENTION_DAYS } from "@ekwe/shared/retention";

import { historyLocalTtlDays } from "@/constants/retention";
import { Db } from "@/services/db";
import { auth$, history$ } from "@/store";
import { resetUserScopedState } from "@/store/resetUserScoped";
import logger from "@/utils/logger";
import { subscribeToNetwork } from "@/utils/connectivity";

import { HistoryPush } from "./HistoryPush";
import { CloudSync } from "./CloudSync";
import { HistoryRepository } from "./HistoryRepository";
import { LOCAL_CLEANUP_INTERVAL_MS } from "./shared";

class SyncOrchestrator {
  public push = new HistoryPush();
  public cloud = new CloudSync();
  public history = new HistoryRepository(() => this.push.schedulePush());

  private unsubscribeNetInfo: (() => void) | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private loadedUserId: string | null = null;

  get pullError(): Observable<string | null> {
    return this.cloud.pullError;
  }

  writeHistory = this.history.writeHistory.bind(this.history);
  deleteHistory = this.history.deleteHistory.bind(this.history);
  restoreHistory = this.history.restoreHistory.bind(this.history);
  purgeLocalHistory = this.history.purgeLocalHistory.bind(this.history);
  clearAllHistory = this.history.clearAllHistory.bind(this.history);
  clearSyncCursor = this.cloud.clearSyncCursor.bind(this.cloud);
  pushPending = this.push.push.bind(this.push);
  loadInitialHistory = this.history.loadInitialHistory.bind(this.history);

  pullFromCloud = (userId: string): Promise<void> =>
    this.cloud.pullFromCloud(userId, auth$.isPro.peek());

  async start(): Promise<void> {
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.clearCleanupTimer();

    resetUserScopedState();
    this.runLocalCleanup();

    const currentUserId = auth$.user.get()?.id;
    this.loadedUserId = currentUserId ?? null;
    this.loadInitialHistory(currentUserId);
    this.push.schedulePush();

    this.unsubscribeNetInfo = subscribeToNetwork((isOnline) => {
      if (!isOnline) return;
      this.push.schedulePush();
      this.pullOnResume();
    });

    this.appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      this.push.schedulePush();
      this.pullOnResume();
    });

    this.cleanupTimer = setInterval(() => {
      this.runLocalCleanup();
    }, LOCAL_CLEANUP_INTERVAL_MS);
  }

  stop(): void {
    this.clearCleanupTimer();
    this.appStateSubscription?.remove();
    this.appStateSubscription = null;
    this.unsubscribeNetInfo?.();
    this.unsubscribeNetInfo = null;
  }

  onUserSignedIn(userId: string): void {
    if (this.loadedUserId && this.loadedUserId !== userId) {
      resetUserScopedState();
    }
    this.loadedUserId = userId;

    this.loadInitialHistory(userId);
    this.pullFromCloud(userId).catch((err) =>
      logger.error("[Sync] onUserSignedIn pull failed", err),
    );
    this.push
      .push()
      .catch((err) => logger.error("[Sync] onUserSignedIn push failed", err));
  }

  onUserSignedOut(): void {
    this.loadedUserId = null;
  }

  private pullOnResume(): void {
    const userId = this.loadedUserId;
    if (!userId) return;
    this.pullFromCloud(userId).catch((err) =>
      logger.error("[Sync] pull on resume failed", err),
    );
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
    const ttlDays = historyLocalTtlDays(auth$.isPro.peek());

    const expired = Db.cleanupExpiredHistory(ttlDays, userId);
    if (expired > 0) {
      logger.info("[Sync] Cleaned up", expired, "expired local history rows");
      this.pruneObservableExpired(ttlDays);
    }

    const tombstones = Db.purgeExpiredTombstones(
      HISTORY_TOMBSTONES_RETENTION_DAYS,
    );
    if (tombstones > 0) {
      logger.info("[Sync] Purged", tombstones, "expired local tombstones");
    }
  }
}

export const SyncService = new SyncOrchestrator();

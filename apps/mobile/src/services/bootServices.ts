/**
 * Centralised boot sequence for deferred service imports.
 *
 * The dynamic imports are intentional: they defer module evaluation until
 * after the first frame is painted, keeping startup fast. Call these loaders
 * from a useEffect, never during render.
 *
 * This module is the single place to look when debugging the boot order.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { UpdateManifest, UpdateChannel } from "@/services/otaUpdates";

export interface BootedServices {
  initAuth: () => Promise<void>;
  cleanupAuth: () => void;
  initializeMMKV: () => Promise<void>;
  SyncService: { start: () => Promise<void>; stop: () => void };
  silentUpdateCheck: () => Promise<void>;
  checkForApkUpdate: () => Promise<UpdateManifest | null>;
  resolveUpdateChannel: () => Promise<UpdateChannel>;
  update$: {
    channel: { set: (v: UpdateChannel) => void };
    manifest: { set: (v: UpdateManifest | null) => void };
  };
  AppAlert: {
    info: (
      title: string,
      message: string,
      buttons: Array<{ text: string; style?: string; onPress?: () => void }>,
    ) => void;
  };
  Linking: { openURL: (url: string) => Promise<void> };
  registerForPushNotifications: () => void;
  setupNotificationTapListener: () => () => void;
}

/** Load every deferred service in a single call. */
export function loadBootServices(): BootedServices {
  const { initAuth, cleanupAuth } = require("@/services/auth");
  const { initializeMMKV } = require("@/services/mmkv");
  const { SyncService } = require("@/services/syncService");
  const {
    silentUpdateCheck,
    checkForApkUpdate,
    resolveUpdateChannel,
  } = require("@/services/otaUpdates");
  const { update$ } = require("@/store/update");
  const { AppAlert } = require("@/utils/alert");
  const { Linking } = require("react-native");
  const {
    registerForPushNotifications,
    setupNotificationTapListener,
  } = require("@/services/notifications");

  return {
    initAuth,
    cleanupAuth,
    initializeMMKV,
    SyncService,
    silentUpdateCheck,
    checkForApkUpdate,
    resolveUpdateChannel,
    update$,
    AppAlert,
    Linking,
    registerForPushNotifications,
    setupNotificationTapListener,
  };
}

/**
 * Deferred cache sweep — called 4 seconds after boot to avoid startup jank.
 */
export function runDeferredCacheSweep(): void {
  const { sweepStaleAudioCache } = require("@/utils/audioCache");
  const { clearStalePreviewCache } = require("@/utils/voicePreviewCache");
  void sweepStaleAudioCache();
  void clearStalePreviewCache();
}

/**
 * Deferred HistoryService loader — called after session is loaded to import
 * shared echo history. Separate from the main boot services because it fires
 * conditionally, not at startup.
 */
export function loadHistoryService(): {
  importSharedEchoHistory: (session: unknown) => Promise<void>;
} {
  const { HistoryService } = require("@/services/historyService");
  return HistoryService;
}

/* eslint-enable @typescript-eslint/no-require-imports */

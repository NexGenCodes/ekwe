import * as Updates from "expo-updates";
import Constants from "expo-constants";

import logger from "@/utils/logger";
import { isIOS } from "@/utils/platform";

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || "";

/**
 * Check for and apply OTA updates silently.
 *
 * - Runs on app load
 * - Downloads in the background
 * - Applies on next cold start
 * - User never sees a modal or prompt
 * - Only shows a brief reload indicator if the update is critical
 */
export async function silentUpdateCheck(): Promise<void> {
  try {
    if (__DEV__) {
      logger.debug("[OTA] Skipping update check in development");
      return;
    }

    const update = await Updates.checkForUpdateAsync();

    if (!update.isAvailable) {
      logger.debug("[OTA] No update available");
      return;
    }

    logger.info("[OTA] Update available, downloading...");

    await Updates.fetchUpdateAsync();

    // Reload the app to apply the update silently
    // The user sees a brief blank frame — indistinguishable from a cold start
    await Updates.reloadAsync();
  } catch (error) {
    // Never block the app for OTA failures — silently continue
    logger.warn("[OTA] Update check failed (non-blocking):", error);
  }
}

interface UpdateManifest {
  latest_version: string;
  latest_version_code: number;
  download_url: string;
}

/**
 * The release pipeline publishes a single universal APK, so the manifest's
 * `download_url` is always the right file to install regardless of CPU ABI.
 */
export function resolveApkDownloadUrl(manifest: UpdateManifest): string {
  return manifest.download_url;
}

/**
 * Check for a new APK version from the server manifest.
 * Returns the manifest if an update is available, null otherwise.
 */
export async function checkForApkUpdate(): Promise<UpdateManifest | null> {
  if (__DEV__) {
    return null;
  }

  // The manifest describes a universal Android APK. iOS has no APK to install —
  // OTA updates there run through expo-updates (silentUpdateCheck), so an APK
  // version-code comparison would falsely report an update every time.
  if (isIOS) {
    return null;
  }

  if (!WORKER_URL) {
    logger.warn("[Update] WORKER_URL not configured");
    return null;
  }

  try {
    const response = await fetch(`${WORKER_URL}/update/manifest`);
    if (!response.ok) return null;

    const manifest: UpdateManifest = await response.json();
    const currentVersionCode = Constants.expoConfig?.android?.versionCode || 0;

    // Compare version codes (more reliable than semver strings)
    if (manifest.latest_version_code > currentVersionCode) {
      return manifest;
    }

    return null;
  } catch (error) {
    logger.warn("[Update] Failed to check for APK update:", error);
    return null;
  }
}

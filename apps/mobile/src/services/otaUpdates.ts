import * as Updates from "expo-updates";
import Constants from "expo-constants";
import { Platform } from "react-native";

import EkweNativeModule from "../../modules/ekwe-native";

import logger from "@/utils/logger";

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
  download_urls?: Record<string, string>;
}

/**
 * The device's primary CPU ABI ("arm64-v8a" | "armeabi-v7a"), read from the
 * native module. Falls back to arm64-v8a if the native module is unavailable
 * (e.g. on iOS, where no APK downloads are offered).
 */
function getDeviceAbi(): string {
  try {
    const abi = EkweNativeModule.getDeviceAbi();
    if (abi === "armeabi-v7a" || abi === "arm64-v8a") return abi;
  } catch {
    // Native module not available on this platform — default below.
  }
  return Platform.OS === "android" ? "arm64-v8a" : "";
}

/**
 * Resolve the correct per-ABI APK URL for this device, falling back to the
 * legacy armv7 `download_url` (works on both archs) when the manifest has no
 * per-ABI map.
 */
export function resolveApkDownloadUrl(manifest: UpdateManifest): string {
  const abi = getDeviceAbi();
  const url = abi && manifest.download_urls?.[abi];
  return url || manifest.download_url;
}

/**
 * Check for a new APK version from the server manifest.
 * Returns the manifest if an update is available, null otherwise.
 */
export async function checkForApkUpdate(): Promise<UpdateManifest | null> {
  if (__DEV__) {
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

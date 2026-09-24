import * as Updates from "expo-updates";
import Constants from "expo-constants";

import EkweNative from "../../modules/ekwe-native";
import logger from "@/utils/logger";
import { isIOS } from "@/utils/platform";

const WORKER_URL = process.env.EXPO_PUBLIC_WORKER_URL || "";

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

    await Updates.reloadAsync();
  } catch (error) {
    logger.warn("[OTA] Update check failed (non-blocking):", error);
  }
}

export type UpdateChannel = "store" | "apk-sideload";

let cachedChannel: UpdateChannel | null = null;

export async function resolveUpdateChannel(): Promise<UpdateChannel> {
  if (cachedChannel) return cachedChannel;

  try {
    const source = await EkweNative.getInstallerSource();
    cachedChannel = source === "store" ? "store" : "apk-sideload";
  } catch (error) {
    logger.warn(
      "[OTA] Installer source read failed, assuming sideload:",
      error,
    );
    cachedChannel = "apk-sideload";
  }

  return cachedChannel;
}

export interface UpdateManifest {
  latest_version: string;
  latest_version_code: number;
  download_url: string;
  force_update?: boolean;
}

export function resolveApkDownloadUrl(manifest: UpdateManifest): string {
  return manifest.download_url;
}

export async function checkForApkUpdate(): Promise<UpdateManifest | null> {
  if (__DEV__) {
    return null;
  }

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

    if (manifest.latest_version_code > currentVersionCode) {
      return manifest;
    }

    return null;
  } catch (error) {
    logger.warn("[Update] Failed to check for APK update:", error);
    return null;
  }
}

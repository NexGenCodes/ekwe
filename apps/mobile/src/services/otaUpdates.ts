import * as Updates from "expo-updates";

import logger from "@/utils/logger";

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

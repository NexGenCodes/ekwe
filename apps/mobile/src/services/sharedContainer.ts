/**
 * iOS-only bridge for the native share extension.
 *
 * The share extension runs in its own process with no JS runtime, so it can't
 * read the app's MMKV store (where the Supabase session lives, in the app
 * sandbox). To let the native extension authenticate against the Worker
 * without a deep-link handoff, we mirror the session + UI preferences into the
 * shared App Group container that BOTH the app and the extension have
 * entitlements for (`group.com.ekwe.app`).
 */
import { File, Paths, type Directory } from "expo-file-system";

import type { Session } from "@supabase/supabase-js";

import { isIOS } from "@/utils";
import logger from "@/utils/logger";
import EkweNative from "../../modules/ekwe-native";

// App Group identifier — must match the entitlements in app.plugin.js and
// targets/share/expo-target.config.js.
const APP_GROUP_ID = "group.com.ekwe.app";

// Files the extension reads on launch.
const SESSION_FILE = "shared-session.json";
const SETTINGS_FILE = "shared-settings.json";

export interface SharedPreferences {
  selectedLanguages: string[];
  autoCopy: boolean;
  autoDetectAllowed: boolean;
}

function containerGroup(): Directory | null {
  if (!isIOS) return null;
  return Paths.appleSharedContainers?.[APP_GROUP_ID] ?? null;
}

/**
 * Mirrors the fresh Supabase session into the shared container. Returns false
 * (non-fatally) when the container isn't available — the extension then shows
 * its signed-out state.
 */
export function mirrorSessionToSharedContainer(
  session: Session | null,
  prefs?: SharedPreferences,
): void {
  const dir = containerGroup();
  if (!dir) return;
  try {
    if (session) {
      const content = JSON.stringify(session);
      // Hardened write: applies NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication
      // and sets isExcludedFromBackup = true via the native module on iOS. This
      // is the ONLY write path for the refresh token — no plaintext fallback, so
      // a failed hardened write surfaces as signed-out state in the extension
      // rather than writing the token unprotected to disk.
      void EkweNative.writeSharedFile(SESSION_FILE, content).then(
        (ok) => {
          if (!ok) {
            logger.error(
              "[SharedContainer] hardened write of session file failed (returned false)",
            );
          }
        },
        (err: unknown) => {
          logger.error("[SharedContainer] hardened write of session file failed", err);
        },
      );
    } else {
      const file = new File(dir, SESSION_FILE);
      if (file.exists) file.delete();
    }
    // The extension's auto-detect card is tier-gated via the JWT's is_pro, so
    // re-mirror settings whenever the session changes too — otherwise a user
    // who upgrades/downgrades mid-session keeps a stale auto-detect flag.
    if (prefs) mirrorSettingsToShared(prefs);
    logger.debug("[SharedContainer] mirrored session state");
  } catch (err) {
    logger.error("[SharedContainer] failed to mirror session", err);
  }
}

/**
 * Mirrors settings the native extension needs: selected languages (for the
 * language grid), auto-copy, and the tier-gated auto-detect permission. Called
 * on demand; callers re-mirror whenever the settings store changes or the
 * session (and thus `isPro`) refreshes.
 */
export function mirrorSettingsToShared(prefs: SharedPreferences): void {
  if (!isIOS) return;
  const dir = containerGroup();
  if (!dir) return;
  try {
    const content = JSON.stringify(prefs);
    void EkweNative.writeSharedFile(SETTINGS_FILE, content).then(
      (ok) => {
        if (!ok) {
          logger.error(
            "[SharedContainer] hardened write of settings file failed (returned false)",
          );
        }
      },
      (err: unknown) => {
        logger.error("[SharedContainer] hardened write of settings file failed", err);
      },
    );
  } catch (err) {
    logger.error("[SharedContainer] failed to mirror settings", err);
  }
}
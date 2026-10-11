import { File, Paths, type Directory } from "expo-file-system";

import type { Session } from "@supabase/supabase-js";

import { isIOS } from "@/utils/platform";
import logger from "@/utils/logger";
import EkweNative from "../../modules/ekwe-native";

const APP_GROUP_ID = "group.com.ekwe.app";

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

export function mirrorSessionToSharedContainer(
  session: Session | null,
  prefs?: SharedPreferences,
): void {
  const dir = containerGroup();
  if (!dir) return;
  try {
    if (session) {
      const content = JSON.stringify(session);
      void EkweNative.writeSharedFile(SESSION_FILE, content).then(
        (ok: boolean) => {
          if (!ok) {
            logger.error(
              "[SharedContainer] hardened write of session file failed (returned false)",
            );
          }
        },
        (err: unknown) => {
          logger.error(
            "[SharedContainer] hardened write of session file failed",
            err,
          );
        },
      );
    } else {
      const file = new File(dir, SESSION_FILE);
      if (file.exists) file.delete();
    }
    if (prefs) mirrorSettingsToShared(prefs);
    logger.debug("[SharedContainer] mirrored session state");
  } catch (err) {
    logger.error("[SharedContainer] failed to mirror session", err);
  }
}

export function mirrorSettingsToShared(prefs: SharedPreferences): void {
  if (!isIOS) return;
  const dir = containerGroup();
  if (!dir) return;
  try {
    const content = JSON.stringify(prefs);
    void EkweNative.writeSharedFile(SETTINGS_FILE, content).then(
      (ok: boolean) => {
        if (!ok) {
          logger.error(
            "[SharedContainer] hardened write of settings file failed (returned false)",
          );
        }
      },
      (err: unknown) => {
        logger.error(
          "[SharedContainer] hardened write of settings file failed",
          err,
        );
      },
    );
  } catch (err) {
    logger.error("[SharedContainer] failed to mirror settings", err);
  }
}

import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useEffect } from "react";
import { AppState } from "react-native";

import logger from "@/utils/logger";

export const useEchoLifecycle = (onDismiss: () => void): void => {
  useEffect(() => {
    activateKeepAwakeAsync("echoSession").catch((err: unknown) =>
      logger.debug("[EchoFlow] activateKeepAwakeAsync failed", err),
    );
    return (): void => {
      deactivateKeepAwake("echoSession")?.catch?.(() => {});
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        logger.info(
          "[EchoFlow] App state changed to background/inactive, dismissing echo...",
        );
        onDismiss();
      }
    });
    return (): void => {
      subscription.remove();
    };
  }, [onDismiss]);
};

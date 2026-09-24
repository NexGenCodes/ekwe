import * as Haptics from "expo-haptics";
import { AlertButton } from "react-native";

import { triggerHaptic } from "@/utils/haptics";
import { sanitizeErrorMessage } from "@/utils/errorSafe";
import logger from "@/utils/logger";

import { appAlertActions } from "@/store/appAlert";

export interface AppAlertOptions {
  haptics?: boolean | Haptics.NotificationFeedbackType;

  cancelable?: boolean;
}

export const AppAlert = {
  info: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AppAlertOptions,
  ): void => {
    if (options?.haptics !== false) {
      triggerHaptic();
    }

    appAlertActions.show({
      type: "info",
      title,
      message,
      buttons: buttons || [{ text: "OK", style: "default" }],
      cancelable: options?.cancelable ?? true,
    });
  },

  error: (
    title: string,
    error?: unknown,
    buttons?: AlertButton[],
    options?: AppAlertOptions,
  ): void => {
    const message =
      sanitizeErrorMessage(error) ?? "An unexpected error occurred.";

    logger.warn(`[AppAlert Error] ${title} - ${message}`);

    if (options?.haptics !== false) {
      triggerHaptic(Haptics.NotificationFeedbackType.Error);
    }

    appAlertActions.show({
      type: "error",
      title,
      message,
      buttons: buttons || [{ text: "Dismiss", style: "cancel" }],
      cancelable: options?.cancelable ?? true,
    });
  },

  success: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AppAlertOptions,
  ): void => {
    if (options?.haptics !== false) {
      triggerHaptic(Haptics.NotificationFeedbackType.Success);
    }

    appAlertActions.show({
      type: "success",
      title,
      message,
      buttons: buttons || [{ text: "Great", style: "default" }],
      cancelable: options?.cancelable ?? true,
    });
  },

  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: {
      confirmText?: string;
      cancelText?: string;
      isDestructive?: boolean;
    } & AppAlertOptions,
  ): void => {
    if (options?.haptics !== false) {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    }

    appAlertActions.show({
      type: "confirm",
      title,
      message,
      buttons: [
        {
          text: options?.cancelText || "Cancel",
          style: "cancel",
        },
        {
          text: options?.confirmText || "Confirm",
          style: options?.isDestructive ? "destructive" : "default",
          onPress: onConfirm,
        },
      ],
      cancelable: options?.cancelable ?? true,
    });
  },
};

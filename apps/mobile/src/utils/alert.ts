import * as Haptics from "expo-haptics";
import { AlertButton } from "react-native";

import { triggerHaptic } from "./haptics";
import { sanitizeErrorMessage } from "./errorSafe";
import logger from "./logger";

import { appAlertActions } from "@/store/appAlert";

export interface AppAlertOptions {
  /**
   * Automatically play haptic feedback when the alert is shown.
   * Defaults to true for Success/Error, false for generic info.
   */
  haptics?: boolean | Haptics.NotificationFeedbackType;
  /**
   * Is the alert cancelable?
   * On Android, this determines if clicking outside the alert closes it.
   */
  cancelable?: boolean;
}

/**
 * Reusable Alert system for standardizing native prompts across Ekwe.
 * Wraps React Native's `Alert` with built-in styling patterns, logging,
 * and intelligent Haptics to keep the codebase clean.
 */
export const AppAlert = {
  /**
   * Display a standard informational alert.
   */
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

  /**
   * Display an Error alert. Extracts error message automatically if an Error object is passed.
   */
  error: (
    title: string,
    error?: unknown,
    buttons?: AlertButton[],
    options?: AppAlertOptions,
  ): void => {
    // Raw error internals (Supabase URLs/project refs, provider details) are
    // logged for diagnostics but the user only ever sees sanitized plain text.
    const message =
      sanitizeErrorMessage(error) ?? "An unexpected error occurred.";

    logger.error(`[AppAlert Error] ${title} - ${message}`);

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

  /**
   * Display a Success alert.
   */
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

  /**
   * Standardized confirmation dialog for destructive or critical actions.
   */
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

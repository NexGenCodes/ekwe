import * as Haptics from 'expo-haptics';
import { Alert, AlertButton } from 'react-native';

import logger from './logger';

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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    Alert.alert(title, message, buttons || [{ text: 'OK', style: 'default' }], {
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
    // Determine the safest string to display
    let message = 'An unexpected error occurred.';
    if (typeof error === 'string') {
      message = error;
    } else if (error instanceof Error) {
      message = error.message;
    } else if (error && typeof error === 'object' && 'message' in error) {
      message = String(error.message);
    }

    logger.error(`[AppAlert Error] ${title} - ${message}`);

    if (options?.haptics !== false) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    Alert.alert(
      title,
      message,
      buttons || [{ text: 'Dismiss', style: 'cancel' }],
      { cancelable: options?.cancelable ?? true },
    );
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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    Alert.alert(
      title,
      message,
      buttons || [{ text: 'Great', style: 'default' }],
      { cancelable: options?.cancelable ?? true },
    );
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
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    Alert.alert(
      title,
      message,
      [
        {
          text: options?.cancelText || 'Cancel',
          style: 'cancel',
        },
        {
          text: options?.confirmText || 'Confirm',
          style: options?.isDestructive ? 'destructive' : 'default',
          onPress: onConfirm,
        },
      ],
      { cancelable: options?.cancelable ?? true },
    );
  },
};

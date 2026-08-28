import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";

import { triggerHaptic } from "./haptics";
import { sanitizeErrorMessage } from "./errorSafe";
import logger from "./logger";

export interface AppToastOptions {
  /** Description text to show below the title */
  description?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Play haptics? Defaults to true */
  haptics?: boolean | Haptics.NotificationFeedbackType;
  /** Optional action button rendered on the toast */
  action?: { label: string; onClick: () => void };
}

/**
 * Reusable Toast system wrapping sonner-native.
 * Automatically adds Haptics and standardized durations.
 */
export const AppToast = {
  info: (title: string, options?: AppToastOptions): void => {
    if (options?.haptics !== false) {
      triggerHaptic();
    }
    toast(title, {
      description: options?.description,
      duration: options?.duration || 3000,
      richColors: true,
      action: options?.action,
    });
  },

  warning: (title: string, options?: AppToastOptions): void => {
    if (options?.haptics !== false) {
      triggerHaptic(Haptics.NotificationFeedbackType.Warning);
    }
    toast.warning(title, {
      description: options?.description,
      duration: options?.duration || 3500,
      richColors: true,
      action: options?.action,
    });
  },

  success: (title: string, options?: AppToastOptions): void => {
    if (options?.haptics !== false) {
      triggerHaptic(Haptics.NotificationFeedbackType.Success);
    }
    toast.success(title, {
      description: options?.description,
      duration: options?.duration || 3000,
      richColors: true,
      action: options?.action,
    });
  },

  error: (
    title: string,
    options?: AppToastOptions & { error?: unknown },
  ): void => {
    let description = options?.description;
    const error = options?.error;

    // Raw errors are logged verbatim for diagnosis but the UI only ever sees
    // sanitized plain text (URLs/project refs collapse to fallback copy).
    if (error) {
      const safe = sanitizeErrorMessage(error);
      if (safe !== null) description = safe;
      else if (!description) description = "Something went wrong.";
    }

    if (description || error) {
      logger.error(
        `[AppToast Error] ${title} - ${description || "Unknown error"}`,
      );
    }

    if (options?.haptics !== false) {
      triggerHaptic(Haptics.NotificationFeedbackType.Error);
    }

    toast.error(title, {
      description,
      duration: options?.duration || 4000,
      richColors: true,
      action: options?.action,
    });
  },
};

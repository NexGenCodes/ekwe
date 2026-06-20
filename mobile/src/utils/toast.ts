import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";

import { triggerHaptic } from "./haptics";
import logger from "./logger";

export interface AppToastOptions {
  /** Description text to show below the title */
  description?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Play haptics? Defaults to true */
  haptics?: boolean | Haptics.NotificationFeedbackType;
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
    });
  },

  error: (
    title: string,
    options?: AppToastOptions & { error?: unknown },
  ): void => {
    let description = options?.description;
    const error = options?.error;

    if (error) {
      if (typeof error === "string") {
        description = error;
      } else if (error instanceof Error) {
        description = error.message;
      } else if (typeof error === "object" && "message" in error) {
        description = String(error.message);
      }
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
    });
  },
};

import * as Haptics from "expo-haptics";
import { toast } from "sonner-native";

import { triggerHaptic } from "@/utils/haptics";
import { sanitizeErrorMessage } from "@/utils/errorSafe";
import logger from "@/utils/logger";

export interface AppToastOptions {
  description?: string;

  duration?: number;

  haptics?: boolean | Haptics.NotificationFeedbackType;

  action?: { label: string; onClick: () => void };
}

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

    if (error) {
      const safe = sanitizeErrorMessage(error);
      if (safe !== null) description = safe;
      else if (!description) description = "Something went wrong.";
    }

    if (description || error) {
      logger.warn(
        `[AppToast Error] ${title} - ${description || "Unknown error"}`,
      );
      if (error instanceof Error) {
        logger.error(`[AppToast] ${title}`, error);
      }
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

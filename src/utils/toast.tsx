import * as Haptics from "expo-haptics";
import { AlertCircle, CheckCircle, Info } from "lucide-react-native";
import { toast } from "sonner-native";

import logger from "./logger";

import { iconSize } from "@/constants/sizes";
import { triggerHaptic } from "@/utils/haptics";

export interface AppToastOptions {
  /** Description text to show below the title */
  description?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Play haptics? Defaults to true */
  haptics?: boolean | Haptics.NotificationFeedbackType;
  /** Action button for error toasts */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Reusable Toast system wrapping sonner-native.
 * Automatically adds Haptics, rich colors, and per-type icons.
 */
export const AppToast = {
  info: (title: string, options?: AppToastOptions): void => {
    if (options?.haptics !== false) {
      triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
    }
    toast(title, {
      icon: <Info size={iconSize.sm} />,
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
      icon: <CheckCircle size={iconSize.sm} />,
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
      icon: <AlertCircle size={iconSize.sm} />,
      description,
      duration: options?.duration || 4000,
      richColors: true,
      action: options?.action,
    });
  },
};

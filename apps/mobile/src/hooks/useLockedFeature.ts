import { useCallback } from "react";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";

import { pushOnce } from "@/utils/navigation";
import { triggerHaptic } from "@/utils/haptics";
import { AppToast } from "@/utils/toast";

export interface UseLockedFeatureOptions {
  navigateToBilling?: boolean;

  message?: string;
}

export function useLockedFeature(
  options: UseLockedFeatureOptions = {},
): () => void {
  const { navigateToBilling = false, message } = options;
  const router = useRouter();

  const handleLockedPress = useCallback((): void => {
    triggerHaptic(Haptics.NotificationFeedbackType.Warning);
    AppToast.info(message ?? "Paid feature — upgrade to unlock", {
      duration: 2500,
      haptics: false,
      action: navigateToBilling
        ? {
            label: "Upgrade",
            onClick: (): void => pushOnce(router, "/billing"),
          }
        : undefined,
    });
  }, [message, navigateToBilling, router]);

  return handleLockedPress;
}

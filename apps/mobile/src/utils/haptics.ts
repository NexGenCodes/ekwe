import * as Haptics from "expo-haptics";

import { settings$ } from "@/store/settings";

type HapticType =
  Haptics.ImpactFeedbackStyle | Haptics.NotificationFeedbackType | "selection";

export const triggerHaptic = async (
  type: HapticType = Haptics.ImpactFeedbackStyle.Light,
): Promise<void> => {
  const isEnabled = settings$.hapticsEnabled.get();
  if (!isEnabled) return;

  if (type === "selection") {
    await Haptics.selectionAsync();
  } else if (
    type === Haptics.NotificationFeedbackType.Success ||
    type === Haptics.NotificationFeedbackType.Warning ||
    type === Haptics.NotificationFeedbackType.Error
  ) {
    await Haptics.notificationAsync(type);
  } else {
    await Haptics.impactAsync(type as Haptics.ImpactFeedbackStyle);
  }
};

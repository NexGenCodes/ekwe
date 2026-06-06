import * as Haptics from "expo-haptics";

import { settings$ } from "@/store";

/**
 * Triggers a haptic feedback effect, respecting the global user settings.
 * If settings$.hapticsEnabled is false, this does nothing.
 *
 * @param type The type of haptic feedback to play. Defaults to Light impact.
 */
export const triggerHaptic = async (
  type: Haptics.ImpactFeedbackStyle | Haptics.NotificationFeedbackType = Haptics
    .ImpactFeedbackStyle.Light,
): Promise<void> => {
  const isEnabled = settings$.hapticsEnabled.get();
  if (!isEnabled) return;

  if (
    type === Haptics.NotificationFeedbackType.Success ||
    type === Haptics.NotificationFeedbackType.Warning ||
    type === Haptics.NotificationFeedbackType.Error
  ) {
    await Haptics.notificationAsync(type);
  } else {
    await Haptics.impactAsync(type as Haptics.ImpactFeedbackStyle);
  }
};

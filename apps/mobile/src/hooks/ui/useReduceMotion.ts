import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export const useReduceMotion = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setEnabled(value);
      })
      .catch(() => {
        if (mounted) setEnabled(false);
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (value) => {
        if (mounted) setEnabled(value);
      },
    );

    return (): void => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
};

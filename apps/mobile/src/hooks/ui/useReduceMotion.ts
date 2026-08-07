import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Resolves the OS accessibility "Reduce Motion" preference so animations can be
 * disabled/diminished for users who request it (ui-ux-pro-max: Reduced Motion).
 */
export const useReduceMotion = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setEnabled);
  }, []);

  return enabled;
};
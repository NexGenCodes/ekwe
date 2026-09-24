import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export const useReduceMotion = (): boolean => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setEnabled);
  }, []);

  return enabled;
};

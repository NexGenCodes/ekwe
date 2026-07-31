import React, { forwardRef, useMemo } from "react";
import {
  Switch as RNSwitch,
  type SwitchProps as RNSwitchProps,
  type View,
} from "react-native";

import { useTokens } from "@/hooks/ui/useTokens";

export type SwitchProps = RNSwitchProps;

export const Switch = React.memo(
  forwardRef<View, SwitchProps>(({ trackColor, thumbColor, ...props }, ref) => {
    const { color, isDark } = useTokens();

    const track = useMemo(
      () => trackColor ?? { true: color.brand, false: color.border },
      [trackColor, color.brand, color.border],
    );

    const thumb = useMemo(
      () => thumbColor ?? (isDark ? color.background : color.card),
      [thumbColor, isDark, color.background, color.card],
    );

    return (
      <RNSwitch
        ref={ref}
        trackColor={track}
        thumbColor={thumb}
        accessibilityRole="switch"
        {...props}
      />
    );
  }),
);

Switch.displayName = "Switch";

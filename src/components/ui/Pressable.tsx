import React, { forwardRef } from "react";
import {
  Pressable as RNPressable,
  type PressableProps as RNPressableProps,
  type View,
  type ViewStyle,
} from "react-native";

import { opacity } from "@/constants/sizes";

export type PressableProps = RNPressableProps & {
  feedback?: "opacity" | "scale" | "none";
};

export const Pressable = React.memo(
  forwardRef<View, PressableProps>(
    ({ feedback = "opacity", style, ...props }, ref) => {
      const pressStyle =
        feedback === "opacity"
          ? ({ pressed }: { pressed: boolean }): ViewStyle[] => [
              typeof style === "function"
                ? (style as Function)({ pressed })
                : (style as ViewStyle),
              pressed && { opacity: opacity.inactive },
            ]
          : feedback === "scale"
            ? ({ pressed }: { pressed: boolean }): ViewStyle[] => [
                typeof style === "function"
                  ? (style as Function)({ pressed })
                  : (style as ViewStyle),
                pressed && { transform: [{ scale: 0.95 }] },
              ]
            : style;

      return (
        <RNPressable
          ref={ref}
          accessibilityRole="button"
          style={pressStyle}
          {...props}
        />
      );
    },
  ),
);

Pressable.displayName = "Pressable";

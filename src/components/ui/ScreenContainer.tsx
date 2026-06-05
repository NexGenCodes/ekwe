import React from "react";
import type { ViewStyle } from "react-native";

import { SafeArea } from "./SafeArea";
import { ScrollArea, type ScrollAreaProps } from "./ScrollArea";

export interface ScreenContainerProps extends ScrollAreaProps {
  children: React.ReactNode;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
}

export const ScreenContainer = React.memo(function ScreenContainer({
  children,
  style,
  contentContainerStyle,
  ...props
}: ScreenContainerProps) {
  return (
    <SafeArea style={style}>
      <ScrollArea contentContainerStyle={contentContainerStyle} {...props}>
        {children}
      </ScrollArea>
    </SafeArea>
  );
});

import React from "react";
import type { ViewStyle } from "react-native";

import { Box } from "./Box";
import { SafeArea } from "./SafeArea";
import { ScrollArea, type ScrollAreaProps } from "./ScrollArea";

export interface ScreenContainerProps extends ScrollAreaProps {
  children: React.ReactNode;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
  scroll?: boolean;
  footer?: React.ReactNode;
}

export const ScreenContainer = React.memo(function ScreenContainer({
  children,
  style,
  contentContainerStyle,
  scroll = true,
  footer,
  ...props
}: ScreenContainerProps) {
  return (
    <SafeArea style={style}>
      {scroll ? (
        <Box style={{ flex: 1 }}>
          <ScrollArea contentContainerStyle={contentContainerStyle} {...props}>
            {children}
          </ScrollArea>
          {footer}
        </Box>
      ) : (
        <Box style={{ flex: 1 }}>{children}</Box>
      )}
    </SafeArea>
  );
});
